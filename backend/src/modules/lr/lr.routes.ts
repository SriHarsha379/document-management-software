import { Router, type Request, type Response } from 'express';
import nodemailer from 'nodemailer';
import * as path from 'path';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../auth/auth.routes.js';
import { requirePermission, buildScopeWhere } from '../rbac/rbac.middleware.js';
import { ALLOWED_SOURCES, ALLOWED_LR_STATUSES } from '../rbac/permissions.js';
import { lrRepo, type LrCreateInput, type LrUpdateInput, type LrFilters } from './lr.repo.js';
import { syncLrRecordsFromDocuments, buildCombinedPdf } from '../../services/documentService.js';
import { db } from '../../lib/db.js';
import { upload } from '../../middleware/upload.js';

const router = Router();

const LR_DOCUMENT_CATEGORIES = [
  'LR_GENERATED',
  'ACKNOWLEDGED_INVOICE',
  'ACKNOWLEDGED_LR_COPY',
  'DEPOT_PLANT_WEIGHMENT_SLIP',
  'SITE_WEIGHMENT_SLIP',
  'TOLL_RECEIPT',
  'ADDITIONAL_ATTACHMENT_1',
  'ADDITIONAL_ATTACHMENT_2',
] as const;

type LrDocumentCategory = typeof LR_DOCUMENT_CATEGORIES[number];

const LR_DOCUMENT_CATEGORY_ORDER: LrDocumentCategory[] = [...LR_DOCUMENT_CATEGORIES];

const LR_DOCUMENT_TYPE_MAP: Record<LrDocumentCategory, 'LR' | 'INVOICE' | 'RECEIVING' | 'WEIGHMENT_PARTY' | 'WEIGHMENT_SITE' | 'TOLL' | 'EWAYBILL' | 'UNKNOWN'> = {
  LR_GENERATED: 'LR',
  ACKNOWLEDGED_INVOICE: 'INVOICE',
  ACKNOWLEDGED_LR_COPY: 'RECEIVING',
  DEPOT_PLANT_WEIGHMENT_SLIP: 'WEIGHMENT_PARTY',
  SITE_WEIGHMENT_SLIP: 'WEIGHMENT_SITE',
  TOLL_RECEIPT: 'TOLL',
  ADDITIONAL_ATTACHMENT_1: 'EWAYBILL',
  ADDITIONAL_ATTACHMENT_2: 'UNKNOWN',
};

const DOCUMENT_TYPE_CATEGORY_MAP: Partial<Record<
  'LR' | 'INVOICE' | 'TOLL' | 'WEIGHMENT' | 'WEIGHMENT_PARTY' | 'WEIGHMENT_SITE' | 'EWAYBILL' | 'RECEIVING' | 'UNKNOWN',
  LrDocumentCategory
>> = {
  LR: 'LR_GENERATED',
  INVOICE: 'ACKNOWLEDGED_INVOICE',
  RECEIVING: 'ACKNOWLEDGED_LR_COPY',
  WEIGHMENT: 'DEPOT_PLANT_WEIGHMENT_SLIP',
  WEIGHMENT_PARTY: 'DEPOT_PLANT_WEIGHMENT_SLIP',
  WEIGHMENT_SITE: 'SITE_WEIGHMENT_SLIP',
  TOLL: 'TOLL_RECEIPT',
  EWAYBILL: 'ADDITIONAL_ATTACHMENT_1',
  UNKNOWN: 'ADDITIONAL_ATTACHMENT_2',
};

const DOCUMENT_TYPE_CATEGORY_KEYS = Object.keys(DOCUMENT_TYPE_CATEGORY_MAP) as Array<keyof typeof DOCUMENT_TYPE_CATEGORY_MAP>;

// ── Rate limiters ─────────────────────────────────────────────────────────────

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Apply rate limiting and auth to all LR routes
router.use(readLimiter);
router.use(requireAuth);

// ── GET /api/lrs/branches ─────────────────────────────────────────────────────
// Returns the branches accessible to the calling user as {id, name}[].
// Super-admins get all company branches; regular users get only their allowed ones.

router.get(
  '/branches',
  requirePermission('lr.read'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const where = user.isSuperAdmin
        ? { companyId: user.companyId }
        : { id: { in: user.branchIds }, companyId: user.companyId };
      const branches = await db.branch.findMany({
        where,
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      res.json(branches);
    } catch (err) {
      handleRouteError(err, res, '[lr] GET /lrs/branches');
    }
  }
);

// ── GET /api/lrs/summary ──────────────────────────────────────────────────────
// Dashboard stats: LR count vs Invoice count for pie chart.

router.get(
  '/summary',
  requirePermission('lr.read'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const stats = await lrRepo.summary(user.companyId);
      res.json(stats);
    } catch (err) {
      handleRouteError(err, res, '[lr] GET /lrs/summary');
    }
  }
);

router.get(
  '/:id/documents',
  requirePermission('lr.read'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const lr = await getScopedLrWithDocuments(req, String(req.params.id));
      if (!lr) {
        res.status(404).json({ error: 'LR not found' });
        return;
      }

      const documents = (await listLrRelatedDocuments(lr))
        .slice()
        .sort((a, b) => compareLrDocuments(a.lrDocumentCategory, b.lrDocumentCategory, a.uploadedAt, b.uploadedAt))
        .map(formatLrDocument);

      const recipientSuggestions = await resolveLrRecipientSuggestions(lr.id, lr.companyId);

      res.json({
        lr: {
          id: lr.id,
          lrNo: lr.lrNo,
          lrDate: lr.lrDate ?? lr.date,
          billToParty: lr.billToParty,
          shipToParty: lr.shipToParty,
        },
        documents,
        recipientSuggestions,
      });
    } catch (err) {
      handleRouteError(err, res, '[lr] GET /lrs/:id/documents');
    }
  }
);

// ── GET /api/lrs/:id/combined-pdf ────────────────────────────────────────────
// Merges every document belonging to this LR into a single PDF, in the same
// order as the Documents/Bundle table columns (LR_DOCUMENT_CATEGORY_ORDER),
// for the "View" button at the end of each row.

router.get(
  '/:id/combined-pdf',
  requirePermission('lr.read'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const lr = await getScopedLrWithDocuments(req, String(req.params.id));
      if (!lr) {
        res.status(404).json({ error: 'LR not found' });
        return;
      }

      const documents = (await listLrRelatedDocuments(lr))
        .slice()
        .sort((a, b) => compareLrDocuments(a.lrDocumentCategory, b.lrDocumentCategory, a.uploadedAt, b.uploadedAt));

      if (documents.length === 0) {
        res.status(404).json({ error: 'No documents found for this LR' });
        return;
      }

      const pdfBytes = await buildCombinedPdf(
        documents.map((d) => ({ rawFilePath: d.rawFilePath, mimeType: d.mimeType })),
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="LR-${lr.lrNo}-combined.pdf"`);
      res.send(pdfBytes);
    } catch (err) {
      handleRouteError(err, res, '[lr] GET /lrs/:id/combined-pdf');
    }
  }
);

router.post(
  '/:id/documents',
  writeLimiter,
  requirePermission('document.upload'),
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const lr = await getScopedLr(req, String(req.params.id));
      if (!lr) {
        res.status(404).json({ error: 'LR not found' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const category = String(req.body.category ?? '') as LrDocumentCategory;
      if (!LR_DOCUMENT_CATEGORIES.includes(category)) {
        res.status(400).json({ error: `category must be one of: ${LR_DOCUMENT_CATEGORIES.join(', ')}` });
        return;
      }

      let groupId: string | undefined;
      const vehicleNo = lr.vehicleNo?.trim().toUpperCase().replace(/\s+/g, '') || null;
      const date = (lr.lrDate ?? lr.date)?.trim() || null;
      if (vehicleNo && date) {
        const group = await db.documentGroup.upsert({
          where: { vehicleNo_date: { vehicleNo, date } },
          update: {},
          create: { vehicleNo, date },
          select: { id: true },
        });
        groupId = group.id;
      }

      const document = await db.document.create({
        data: {
          lrId: lr.id,
          lrDocumentCategory: category,
          type: LR_DOCUMENT_TYPE_MAP[category],
          status: 'SAVED',
          originalFilename: req.file.originalname,
          rawFilePath: req.file.path,
          mimeType: req.file.mimetype,
          uploadedById: req.user!.id,
          ...(groupId ? { groupId } : {}),
        },
        include: {
          uploadedBy: { select: { id: true, name: true, email: true } },
        },
      });

      res.status(201).json({
        message: 'Document uploaded successfully',
        document: formatLrDocument(document),
      });
    } catch (err) {
      handleRouteError(err, res, '[lr] POST /lrs/:id/documents');
    }
  }
);

router.delete(
  '/:id/documents/:documentId',
  writeLimiter,
  requirePermission('document.delete'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const lr = await getScopedLr(req, String(req.params.id));
      if (!lr) {
        res.status(404).json({ error: 'LR not found' });
        return;
      }

      const document = await db.document.findFirst({
        where: {
          id: String(req.params.documentId),
          lrId: lr.id,
          lrDocumentCategory: { not: null },
        },
      });
      if (!document) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      await db.bundleItem.deleteMany({ where: { documentId: document.id } });
      await db.document.delete({ where: { id: document.id } });
      res.status(204).send();
    } catch (err) {
      handleRouteError(err, res, '[lr] DELETE /lrs/:id/documents/:documentId');
    }
  }
);

router.post(
  '/:id/send-email',
  writeLimiter,
  requirePermission('communication.send'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const lr = await getScopedLrWithDocuments(req, String(req.params.id));
      if (!lr) {
        res.status(404).json({ error: 'LR not found' });
        return;
      }

      const to = normalizeEmailList((req.body as { to?: unknown }).to);
      const cc = normalizeEmailList((req.body as { cc?: unknown }).cc);
      const bcc = normalizeEmailList((req.body as { bcc?: unknown }).bcc);

      if (to.length === 0) {
        res.status(400).json({ error: 'At least one recipient is required' });
        return;
      }

      const invalid = [...to, ...cc, ...bcc].filter((email) => !isValidEmail(email));
      if (invalid.length > 0) {
        res.status(400).json({ error: `Invalid email address(es): ${invalid.join(', ')}` });
        return;
      }

      const attachments = (await listLrRelatedDocuments(lr))
        .slice()
        .sort((a, b) => compareLrDocuments(a.lrDocumentCategory, b.lrDocumentCategory, a.uploadedAt, b.uploadedAt))
        .map((document) => ({
          filename: document.originalFilename,
          path: resolveStoredFilePath(document.rawFilePath),
        }));

      if (attachments.length === 0) {
        res.status(400).json({ error: 'No uploaded documents available to send' });
        return;
      }

      const smtp = await sendLrEmail({
        to,
        cc,
        bcc,
        subject: `Documents for LR ${lr.lrNo}${lr.lrDate ?? lr.date ? ` - ${lr.lrDate ?? lr.date}` : ''}`,
        text: buildLrEmailBody(lr),
        attachments,
      });

      res.json({
        message: 'Email sent successfully',
        smtp,
      });
    } catch (err) {
      handleRouteError(err, res, '[lr] POST /lrs/:id/send-email');
    }
  }
);

// ── GET /api/lrs/filter-values ────────────────────────────────────────────────
// Returns distinct dropdown option values for the dashboard filter panel.

router.get(
  '/filter-values',
  requirePermission('lr.read'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const values = await lrRepo.filterValues(user.companyId);
      res.json(values);
    } catch (err) {
      handleRouteError(err, res, '[lr] GET /lrs/filter-values');
    }
  }
);

// ── POST /api/lrs/sync-from-documents ────────────────────────────────────────
// Scans all saved LR-type documents and auto-creates LR records from their
// OCR-extracted data, then re-runs auto-linking for any unlinked documents.
// Safe to call repeatedly — existing LR records are never duplicated.

router.post(
  '/sync-from-documents',
  writeLimiter,
  requirePermission('lr.create'),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await syncLrRecordsFromDocuments();
      res.json({
        message: 'Sync complete',
        processed: result.processed,
        created: result.created,
        linked: result.linked,
        backfilled: result.backfilled,
      });
    } catch (err) {
      handleRouteError(err, res, '[lr] POST /lrs/sync-from-documents');
    }
  }
);

// ── GET /api/lrs ───────────────────────────────────────────────────────────────
// Returns LR records scoped to the calling user's company/branch/source.
// Protected by lr.read permission.

router.get(
  '/',
  requirePermission('lr.read'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const where = buildScopeWhere(user);

      const limit  = parsePaginationInt(req.query.limit,  50, 200);
      const offset = parsePaginationInt(req.query.offset, 0,  Infinity);
      const q      = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined;

      const filters: LrFilters = {
        principalCompany: firstQueryString(req.query.principalCompany) || undefined,
        branchId:         firstQueryString(req.query.branchId) || undefined,
        lrDate:           firstQueryString(req.query.lrDate) || undefined,
        invoiceDate:      firstQueryString(req.query.invoiceDate) || undefined,
        invoiceNo:        firstQueryString(req.query.invoiceNo) || undefined,
        lrNo:             firstQueryString(req.query.lrNo) || undefined,
        vehicleNo:        firstQueryString(req.query.vehicleNo) || undefined,
        driverName:       firstQueryString(req.query.driverName) || undefined,
        productName:      firstQueryString(req.query.productName) || undefined,
        tptCode:          firstQueryString(req.query.tptCode) || undefined,
        workingCenter:    firstQueryString(req.query.workingCenter) || undefined,
        depotPlantCode:   firstQueryString(req.query.depotPlantCode) || undefined,
      };

      const sortBy  = firstQueryString(req.query.sortBy) || undefined;
      const sortDir = firstQueryString(req.query.sortDir) === 'desc' ? 'desc' : 'asc';

      const { rows, total } = await lrRepo.findMany({ where, limit, offset, q, filters, sortBy, sortDir });
      res.json({
        data: rows.map((row) => ({
          ...row,
          uploadedDocuments: row.uploadedDocuments?.map((document) => formatLrDocument(document)) ?? [],
        })),
        total,
        limit,
        offset,
      });
    } catch (err) {
      handleRouteError(err, res, '[lr] GET /lrs');
    }
  }
);

// ── POST /api/lrs ──────────────────────────────────────────────────────────────
// Creates a new LR record within the user's company scope.
// Protected by lr.create permission.

router.post(
  '/',
  writeLimiter,
  requirePermission('lr.create'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const body = req.body as Partial<LrCreateInput & { status?: string }>;

      const { lrNo, branchId, source } = body;

      if (!lrNo?.trim() || !branchId?.trim()) {
        res.status(400).json({ error: 'lrNo and branchId are required' });
        return;
      }

      if (source && !(ALLOWED_SOURCES as readonly string[]).includes(source)) {
        res.status(400).json({ error: `source must be one of: ${ALLOWED_SOURCES.join(', ')}` });
        return;
      }

      // Enforce that the branchId is within the user's allowed branches
      if (!user.isSuperAdmin && !user.branchIds.includes(branchId.trim())) {
        res.status(403).json({ error: 'Forbidden: branch not in scope' });
        return;
      }

      const lr = await lrRepo.create({
        lrNo:               lrNo.trim(),
        companyId:          user.companyId,
        branchId:           branchId.trim(),
        source:             source ?? 'INTERNAL',
        createdBy:          user.id,
        // Legacy
        consignor:          body.consignor?.trim(),
        consignee:          body.consignee?.trim(),
        invoiceNo:          body.invoiceNo?.trim(),
        date:               body.date?.trim(),
        // Extended
        principalCompany:   body.principalCompany?.trim(),
        lrDate:             body.lrDate?.trim(),
        loadingSlipNo:      body.loadingSlipNo?.trim(),
        companyInvoiceDate: body.companyInvoiceDate?.trim(),
        companyInvoiceNo:   body.companyInvoiceNo?.trim(),
        companyEwayBillNo:  body.companyEwayBillNo?.trim(),
        billToParty:        body.billToParty?.trim(),
        shipToParty:        body.shipToParty?.trim(),
        deliveryDestination: body.deliveryDestination?.trim(),
        tpt:                body.tpt?.trim(),
        orderType:          body.orderType?.trim(),
        productName:        body.productName?.trim(),
        vehicleNo:          body.vehicleNo?.trim(),
        quantityInBags:     toFloat(body.quantityInBags),
        quantityInMt:       toFloat(body.quantityInMt),
        tollCharges:        toFloat(body.tollCharges),
        weighmentCharges:   toFloat(body.weighmentCharges),
        unloadingAtSite:    toFloat(body.unloadingAtSite),
        driverBhatta:       toFloat(body.driverBhatta),
        dayOpeningKm:       toFloat(body.dayOpeningKm),
        dayClosingKm:       toFloat(body.dayClosingKm),
        totalRunningKm:     toFloat(body.totalRunningKm),
        fuelPerKm:          toFloat(body.fuelPerKm),
        fuelAmount:         toFloat(body.fuelAmount),
        grandTotal:         toFloat(body.grandTotal),
        tptCode:            body.tptCode?.trim(),
        transporterName:    body.transporterName?.trim(),
        driverName:         body.driverName?.trim(),
        driverCellNo:       body.driverCellNo?.trim(),
        driverBillNo:       body.driverBillNo?.trim(),
        billDate:           body.billDate?.trim(),
        billNo:             body.billNo?.trim(),
        billAmount:         toFloat(body.billAmount),
        // Additional logistics fields
        ewayBillDate:         body.ewayBillDate?.trim(),
        approvedDestination:  body.approvedDestination?.trim(),
        orderNo:              body.orderNo?.trim(),
        workingCenter:        body.workingCenter?.trim(),
        depotPlantCode:       body.depotPlantCode?.trim(),
      });

      res.status(201).json({ data: lr });
    } catch (err) {
      handleRouteError(err, res, '[lr] POST /lrs');
    }
  }
);

// ── PATCH /api/lrs/:id ────────────────────────────────────────────────────────
// Updates an existing LR record.  Row is fetched WITH the scope filter so a
// record from another branch/company returns 404 (existence does not leak).
// Protected by lr.update permission.

router.patch(
  '/:id',
  writeLimiter,
  requirePermission('lr.update'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const scopeWhere = buildScopeWhere(user);

      // Fetch with scope — returns null if the row exists but is out-of-scope
      const lr = await lrRepo.findFirst({ where: { ...scopeWhere, id: String(req.params.id) } });
      if (!lr) {
        res.status(404).json({ error: 'LR not found' });
        return;
      }

      const body = req.body as Partial<LrUpdateInput>;
      const branchId =
        typeof body.branchId === 'string' ? body.branchId.trim() : undefined;

      if (body.branchId !== undefined && !branchId) {
        res.status(400).json({ error: 'branchId cannot be empty' });
        return;
      }

      if (branchId) {
        if (!user.isSuperAdmin && !user.branchIds.includes(branchId)) {
          res.status(403).json({ error: 'Forbidden: branch not in scope' });
          return;
        }

        const branch = await db.branch.findUnique({
          where: { id: branchId },
          select: { id: true, companyId: true },
        });

        if (!branch || branch.companyId !== lr.companyId) {
          res.status(400).json({ error: 'Invalid branchId for this LR' });
          return;
        }
      }

      if (body.status && !(ALLOWED_LR_STATUSES as readonly string[]).includes(body.status)) {
        res.status(400).json({ error: `status must be one of: ${ALLOWED_LR_STATUSES.join(', ')}` });
        return;
      }

      const updateData: LrUpdateInput = {
        branchId,
        lrNo:               body.lrNo?.trim(),
        source:             body.source?.trim() || undefined,
        status:             body.status,
        consignor:          body.consignor?.trim(),
        consignee:          body.consignee?.trim(),
        vehicleNo:          body.vehicleNo?.trim(),
        date:               body.date?.trim(),
        invoiceNo:          body.invoiceNo?.trim(),
        principalCompany:   body.principalCompany?.trim(),
        lrDate:             body.lrDate?.trim(),
        loadingSlipNo:      body.loadingSlipNo?.trim(),
        companyInvoiceDate: body.companyInvoiceDate?.trim(),
        companyInvoiceNo:   body.companyInvoiceNo?.trim(),
        companyEwayBillNo:  body.companyEwayBillNo?.trim(),
        billToParty:        body.billToParty?.trim(),
        shipToParty:        body.shipToParty?.trim(),
        deliveryDestination: body.deliveryDestination?.trim(),
        tpt:                body.tpt?.trim(),
        orderType:          body.orderType?.trim(),
        productName:        body.productName?.trim(),
        quantityInBags:     toFloat(body.quantityInBags),
        quantityInMt:       toFloat(body.quantityInMt),
        tollCharges:        toFloat(body.tollCharges),
        weighmentCharges:   toFloat(body.weighmentCharges),
        unloadingAtSite:    toFloat(body.unloadingAtSite),
        driverBhatta:       toFloat(body.driverBhatta),
        dayOpeningKm:       toFloat(body.dayOpeningKm),
        dayClosingKm:       toFloat(body.dayClosingKm),
        totalRunningKm:     toFloat(body.totalRunningKm),
        fuelPerKm:          toFloat(body.fuelPerKm),
        fuelAmount:         toFloat(body.fuelAmount),
        grandTotal:         toFloat(body.grandTotal),
        tptCode:            body.tptCode?.trim(),
        transporterName:    body.transporterName?.trim(),
        driverName:         body.driverName?.trim(),
        driverCellNo:       body.driverCellNo?.trim(),
        driverBillNo:       body.driverBillNo?.trim(),
        billDate:           body.billDate?.trim(),
        billNo:             body.billNo?.trim(),
        billAmount:         toFloat(body.billAmount),
        // Additional logistics fields
        ewayBillDate:         body.ewayBillDate?.trim(),
        approvedDestination:  body.approvedDestination?.trim(),
        orderNo:              body.orderNo?.trim(),
        workingCenter:        body.workingCenter?.trim(),
        depotPlantCode:       body.depotPlantCode?.trim(),
      };

      const updated = await lrRepo.update(lr.id, updateData);
      res.json({ data: updated });
    } catch (err) {
      handleRouteError(err, res, '[lr] PATCH /lrs/:id');
    }
  }
);

// ── DELETE /api/lrs/:id ───────────────────────────────────────────────────────
// Deletes an LR record.  Same scoped-fetch pattern as PATCH.
// Protected by lr.delete permission.

router.delete(
  '/:id',
  writeLimiter,
  requirePermission('lr.delete'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const scopeWhere = buildScopeWhere(user);

      const lr = await lrRepo.findFirst({ where: { ...scopeWhere, id: String(req.params.id) } });
      if (!lr) {
        res.status(404).json({ error: 'LR not found' });
        return;
      }

      await lrRepo.delete(lr.id);
      res.status(204).send();
    } catch (err) {
      handleRouteError(err, res, '[lr] DELETE /lrs/:id');
    }
  }
);

export default router;

// ── Shared helpers ────────────────────────────────────────────────────────────

// Parse a pagination query parameter with clamping — never return NaN or negative.
function parsePaginationInt(
  value: unknown,
  defaultValue: number,
  max: number,
): number {
  const n = parseInt(String(value ?? ''), 10);
  if (isNaN(n) || n < 0) return defaultValue;
  return Math.min(n, max);
}

// Convert unknown input to float, returning undefined if falsy/invalid.
function toFloat(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = parseFloat(String(value));
  return isNaN(n) ? undefined : n;
}

// Log the real error server-side; send a generic message in production.
function handleRouteError(err: unknown, res: Response, context: string): void {
  console.error(`${context}:`, err);
  const message =
    process.env.NODE_ENV !== 'production' && err instanceof Error
      ? err.message
      : 'An unexpected error occurred';
  res.status(500).json({ error: message });
}

// Extract the first string value from an Express query param (may be string | string[] | object).
function firstQueryString(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0] || undefined;
  return undefined;
}

async function getScopedLr(req: Request, lrId: string) {
  const scopeWhere = buildScopeWhere(req.user!);
  return db.lr.findFirst({
    where: { ...scopeWhere, id: lrId },
  });
}

async function getScopedLrWithDocuments(req: Request, lrId: string) {
  const scopeWhere = buildScopeWhere(req.user!);
  return db.lr.findFirst({
    where: { ...scopeWhere, id: lrId },
    include: {
      uploadedDocuments: {
        include: {
          uploadedBy: { select: { id: true, name: true, email: true } },
          extractedData: true,
        },
      },
      // Confirmed document<->LR matches — the real source of truth, see
      // listLrRelatedDocuments below.
      documentLinks: {
        include: {
          document: {
            include: {
              uploadedBy: { select: { id: true, name: true, email: true } },
              extractedData: true,
            },
          },
        },
      },
    },
  });
}

async function listLrRelatedDocuments(lr: Awaited<ReturnType<typeof getScopedLrWithDocuments>>) {
  if (!lr) return [];

  const merged = new Map<string, typeof lr.uploadedDocuments[number]>();
  for (const document of lr.uploadedDocuments) {
    merged.set(document.id, document);
  }

  // Confirmed matches from the auto-link pipeline (lrNo / invoiceNo /
  // vehicleNo+date within tolerance, or a manual link) — this is scoped to
  // THIS LR specifically. We deliberately do NOT fall back to "every
  // document in the shared vehicle+date DocumentGroup": that group can
  // legitimately contain documents from a different LR entirely (e.g. the
  // same truck making two separate trips close together), and showing them
  // here would silently attach one LR's paperwork to another.
  for (const link of lr.documentLinks) {
    if (merged.has(link.document.id)) continue;
    merged.set(link.document.id, {
      ...link.document,
      lrDocumentCategory: link.document.lrDocumentCategory ?? deriveLrDocumentCategory(link.document.type),
    });
  }

  return Array.from(merged.values());
}

function compareLrDocuments(
  categoryA: string | null,
  categoryB: string | null,
  uploadedAtA: Date,
  uploadedAtB: Date,
): number {
  const orderA = categoryA ? LR_DOCUMENT_CATEGORY_ORDER.indexOf(categoryA as LrDocumentCategory) : Number.MAX_SAFE_INTEGER;
  const orderB = categoryB ? LR_DOCUMENT_CATEGORY_ORDER.indexOf(categoryB as LrDocumentCategory) : Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  return uploadedAtB.getTime() - uploadedAtA.getTime();
}

function deriveLrDocumentCategory(type: string): LrDocumentCategory | null {
  if (!isDocumentTypeCategoryKey(type)) return null;
  return DOCUMENT_TYPE_CATEGORY_MAP[type] ?? null;
}

function formatLrDocument(document: {
  id: string;
  type: string;
  status: string;
  originalFilename: string;
  mimeType: string;
  rawFilePath: string;
  uploadedAt: Date;
  updatedAt: Date;
  groupId: string | null;
  sourceDocumentId?: string | null;
  pageNumber?: number | null;
  lrId?: string | null;
  lrDocumentCategory?: string | null;
  uploadedById?: string | null;
  uploadedBy?: { id: string; name: string; email: string } | null;
  extractedData?: {
    id: string;
    lrNo: string | null;
    invoiceNo: string | null;
    vehicleNo: string | null;
    quantity: string | null;
    date: string | null;
    partyNames: string | null;
    tollAmount: string | null;
    weightInfo: string | null;
    confidence: number | null;
    rawOcrResponse: string;
    ocrProcessedAt: Date;
    userReviewed: boolean;
    reviewedAt: Date | null;
    userEdits: string | null;
    billToParty: string | null;
    shipToParty: string | null;
    principalCompany: string | null;
    branchName: string | null;
    loadingSlipNo: string | null;
    companyInvoiceNo: string | null;
    companyInvoiceDate: string | null;
    companyEwayBillNo: string | null;
    ewayBillDate: string | null;
    approvedDestination: string | null;
    deliveryDestination: string | null;
    orderNo: string | null;
    productName: string | null;
    transporterName: string | null;
    orderType: string | null;
    tptCode: string | null;
    quantityInMt: number | null;
    quantityInBags: number | null;
    driverName: string | null;
    driverCellNo: string | null;
    workingCenter: string | null;
    depotPlantCode: string | null;
    source: string | null;
  } | null;
}) {
  const formatted = {
    id: document.id,
    type: document.type,
    status: document.status,
    originalFilename: document.originalFilename,
    mimeType: document.mimeType,
    filePath: path.basename(document.rawFilePath),
    uploadedAt: document.uploadedAt,
    updatedAt: document.updatedAt,
    groupId: document.groupId,
    sourceDocumentId: document.sourceDocumentId ?? null,
    pageNumber: document.pageNumber ?? null,
    lrId: document.lrId ?? null,
    lrDocumentCategory: document.lrDocumentCategory ?? null,
    uploadedById: document.uploadedById ?? null,
    uploadedBy: document.uploadedBy ?? null,
  };

  if (document.extractedData) {
    const ed = document.extractedData;
    const ocrMetadata = parseStoredOcrResponse(ed.rawOcrResponse, ed.confidence);
    return {
      ...formatted,
      extractedData: {
        id: ed.id,
        lrNo: ed.lrNo,
        invoiceNo: ed.invoiceNo,
        vehicleNo: ed.vehicleNo,
        quantity: ed.quantity,
        date: ed.date,
        partyNames: safeJsonParse(ed.partyNames, null as string[] | null),
        tollAmount: ed.tollAmount,
        weightInfo: ed.weightInfo,
        confidence: ed.confidence,
        classificationConfidence: ocrMetadata.classificationConfidence,
        ocrConfidence: ocrMetadata.ocrConfidence,
        appliedRotation: ocrMetadata.appliedRotation,
        imageQuality: ocrMetadata.imageQuality,
        processingNotes: ocrMetadata.processingNotes,
        fieldConfidence: ocrMetadata.fieldConfidence,
        validationIssues: ocrMetadata.validationIssues,
        ocrProcessedAt: ed.ocrProcessedAt,
        userReviewed: ed.userReviewed,
        reviewedAt: ed.reviewedAt,
        userEdits: safeJsonParse(ed.userEdits, null as Record<string, unknown> | null),
        billToParty: ed.billToParty,
        shipToParty: ed.shipToParty,
        principalCompany: ed.principalCompany,
        branchName: ed.branchName,
        loadingSlipNo: ed.loadingSlipNo,
        companyInvoiceNo: ed.companyInvoiceNo,
        companyInvoiceDate: ed.companyInvoiceDate,
        companyEwayBillNo: ed.companyEwayBillNo,
        ewayBillDate: ed.ewayBillDate,
        approvedDestination: ed.approvedDestination,
        deliveryDestination: ed.deliveryDestination,
        orderNo: ed.orderNo,
        productName: ed.productName,
        transporterName: ed.transporterName,
        orderType: ed.orderType,
        tptCode: ed.tptCode,
        quantityInMt: ed.quantityInMt,
        quantityInBags: ed.quantityInBags,
        driverName: ed.driverName,
        driverCellNo: ed.driverCellNo,
        workingCenter: ed.workingCenter,
        depotPlantCode: ed.depotPlantCode,
        source: ed.source,
      },
    };
  }

  return formatted;
}

function isDocumentTypeCategoryKey(value: string): value is keyof typeof DOCUMENT_TYPE_CATEGORY_MAP {
  return DOCUMENT_TYPE_CATEGORY_KEYS.includes(value as keyof typeof DOCUMENT_TYPE_CATEGORY_MAP);
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseStoredOcrResponse(rawOcrResponse: string, fallbackConfidence: number | null) {
  try {
    const parsed = JSON.parse(rawOcrResponse) as {
      providerResponse?: string;
      metadata?: {
        classificationConfidence?: number;
        ocrConfidence?: number;
        appliedRotation?: number;
        imageQuality?: 'HIGH' | 'MEDIUM' | 'LOW';
        processingNotes?: string[];
        fieldConfidence?: Record<string, number>;
        validationIssues?: string[];
      };
    };

    return {
      classificationConfidence: parsed.metadata?.classificationConfidence ?? fallbackConfidence,
      ocrConfidence: parsed.metadata?.ocrConfidence ?? fallbackConfidence,
      appliedRotation: parsed.metadata?.appliedRotation ?? 0,
      imageQuality: parsed.metadata?.imageQuality ?? null,
      processingNotes: parsed.metadata?.processingNotes ?? [],
      fieldConfidence: parsed.metadata?.fieldConfidence ?? {},
      validationIssues: parsed.metadata?.validationIssues ?? [],
    };
  } catch {
    return {
      classificationConfidence: fallbackConfidence,
      ocrConfidence: fallbackConfidence,
      appliedRotation: 0,
      imageQuality: null,
      processingNotes: [],
      fieldConfidence: {},
      validationIssues: [],
    };
  }
}

async function resolveLrRecipientSuggestions(lrId: string, companyId: string) {
  const lr = await db.lr.findUnique({
    where: { id: lrId },
    select: {
      billToParty: true,
      shipToParty: true,
    },
  });

  const [executive, billToParty, shipToParty] = await Promise.all([
    db.officer.findFirst({
      where: { companyId, isActive: true, email: { not: null } },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, email: true },
    }),
    lr?.billToParty
      ? db.party.findFirst({
          where: {
            companyId,
            isActive: true,
            isBillToParty: true,
            email: { not: null },
            name: { contains: lr.billToParty.trim() },
          },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve(null),
    lr?.shipToParty
      ? db.party.findFirst({
          where: {
            companyId,
            isActive: true,
            isShipToParty: true,
            email: { not: null },
            name: { contains: lr.shipToParty.trim() },
          },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve(null),
  ]);

  const suggestions = [
    executive?.email ? { type: 'EXECUTIVE_EMAIL', label: 'Executive Email', value: executive.email, sourceName: executive.name } : null,
    billToParty?.email ? { type: 'BILL_TO_PARTY_EMAIL', label: 'Bill To Party Email', value: billToParty.email, sourceName: billToParty.name } : null,
    shipToParty?.email ? { type: 'SHIP_TO_PARTY_EMAIL', label: 'Ship To Party Email', value: shipToParty.email, sourceName: shipToParty.name } : null,
  ].filter((item): item is { type: string; label: string; value: string; sourceName: string } => item !== null);

  return {
    suggestedTo: Array.from(new Set(suggestions.map((item) => item.value))),
    suggestions,
  };
}

function normalizeEmailList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function isValidEmail(email: string): boolean {
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  return parts[0]!.length > 0 && parts[1]!.includes('.');
}

function resolveStoredFilePath(rawFilePath: string): string {
  return path.isAbsolute(rawFilePath) ? rawFilePath : path.resolve(process.cwd(), rawFilePath);
}

function buildLrEmailBody(lr: {
  lrNo: string;
  lrDate: string | null;
  date: string | null;
  vehicleNo: string | null;
  billToParty: string | null;
  shipToParty: string | null;
}) {
  return [
    'Dear Team,',
    '',
    `Please find attached the uploaded documents for LR ${lr.lrNo}.`,
    lr.lrDate ?? lr.date ? `LR Date: ${lr.lrDate ?? lr.date}` : null,
    lr.vehicleNo ? `Vehicle Number: ${lr.vehicleNo}` : null,
    lr.billToParty ? `Bill To Party: ${lr.billToParty}` : null,
    lr.shipToParty ? `Ship To Party: ${lr.shipToParty}` : null,
    '',
    'Regards,',
    'Logistics DMS',
  ].filter((line): line is string => line !== null).join('\n');
}

async function sendLrEmail(opts: {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  attachments: Array<{ filename: string; path: string }>;
}) {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? user ?? 'noreply@logistics-dms.local';

  if (!host || !user || !pass) {
    throw new Error('Email not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS environment variables.');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const info = await transporter.sendMail({
    from,
    to: opts.to,
    cc: opts.cc,
    bcc: opts.bcc,
    subject: opts.subject,
    text: opts.text,
    attachments: opts.attachments,
  });

  return {
    messageId: typeof info.messageId === 'string' ? info.messageId : '',
    accepted: Array.isArray((info as { accepted?: unknown }).accepted) ? (info as { accepted: string[] }).accepted : [],
    rejected: Array.isArray((info as { rejected?: unknown }).rejected) ? (info as { rejected: string[] }).rejected : [],
    response: typeof (info as { response?: unknown }).response === 'string'
      ? (info as { response: string }).response
      : undefined,
  };
}