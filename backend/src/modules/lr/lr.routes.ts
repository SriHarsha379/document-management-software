import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../auth/auth.routes.js';
import { requirePermission, buildScopeWhere } from '../rbac/rbac.middleware.js';
import { ALLOWED_SOURCES, ALLOWED_LR_STATUSES } from '../rbac/permissions.js';
import { lrRepo, type LrCreateInput, type LrUpdateInput } from './lr.repo.js';
import { syncLrRecordsFromDocuments } from '../../services/documentService.js';

const router = Router();

// ── Rate limiters ─────────────────────────────────────────────────────────────

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
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

// ── GET /api/lrs/summary ──────────────────────────────────────────────────────
// Dashboard stats: LR count vs Invoice count for pie chart.

router.get(
  '/summary',
  readLimiter,
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
  readLimiter,
  requirePermission('lr.read'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const where = buildScopeWhere(user);

      const limit  = parsePaginationInt(req.query.limit,  50, 200);
      const offset = parsePaginationInt(req.query.offset, 0,  Infinity);

      const { rows, total } = await lrRepo.findMany({ where, limit, offset });
      res.json({ data: rows, total, limit, offset });
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
        driverBillNo:       body.driverBillNo?.trim(),
        billDate:           body.billDate?.trim(),
        billNo:             body.billNo?.trim(),
        billAmount:         toFloat(body.billAmount),
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

      if (body.status && !(ALLOWED_LR_STATUSES as readonly string[]).includes(body.status)) {
        res.status(400).json({ error: `status must be one of: ${ALLOWED_LR_STATUSES.join(', ')}` });
        return;
      }

      const updateData: LrUpdateInput = {
        lrNo:               body.lrNo?.trim(),
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
        driverBillNo:       body.driverBillNo?.trim(),
        billDate:           body.billDate?.trim(),
        billNo:             body.billNo?.trim(),
        billAmount:         toFloat(body.billAmount),
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
