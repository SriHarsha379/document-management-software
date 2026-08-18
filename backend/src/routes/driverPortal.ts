import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import * as path from 'path';
import * as fs from 'fs';
import rateLimit from 'express-rate-limit';
import { upload } from '../middleware/upload.js';
import { requireDriverAuth, signDriverToken } from '../middleware/driverAuth.js';
import type { DriverTokenPayload } from '../middleware/driverAuth.js';
import { prisma, saveOcrResults } from '../services/documentService.js';
import { processDocumentOcr } from '../services/ocrService.js';
import type { DocumentType } from '../types/index.js';

const router = Router();

type DriverUploadDocType = 'LR' | 'TOLL' | 'WEIGHMENT_SLIP' | 'WEIGHMENT_PARTY' | 'WEIGHMENT_SITE' | 'PARTY_ACK';

const DRIVER_TO_DOCUMENT_TYPE_MAP: Record<DriverUploadDocType, DocumentType> = {
  LR: 'LR',
  TOLL: 'TOLL',
  WEIGHMENT_SLIP: 'WEIGHMENT',
  WEIGHMENT_PARTY: 'WEIGHMENT_PARTY',
  WEIGHMENT_SITE: 'WEIGHMENT_SITE',
  // DocumentType has no PARTY_ACK enum; RECEIVING is used so party acknowledgement uploads
  // are grouped with delivery/receipt completion documents in downstream admin workflows.
  PARTY_ACK: 'RECEIVING',
};

function mapDriverDocTypeToDocumentType(docType: DriverUploadDocType): DocumentType {
  return DRIVER_TO_DOCUMENT_TYPE_MAP[docType];
}

// Rate limiter for login: max 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
});

// Rate limiter for uploads: max 30 per hour per IP
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Upload rate limit exceeded. Please try again later.' },
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/driver/login
// Authenticate with phone + password. Validates expiry and isRevoked.
// Body: { phone: string, password: string }
// ──────────────────────────────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, password } = req.body as { phone?: string; password?: string };

    if (!phone || !password) {
      res.status(400).json({ error: 'phone and password are required' });
      return;
    }

    const access = await prisma.temporaryDriverAccess.findUnique({ where: { phone: phone.trim() } });

    if (!access) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (access.isRevoked) {
      res.status(403).json({ error: 'Access Expired', code: 'ACCESS_EXPIRED' });
      return;
    }

    if (access.expiresAt < new Date()) {
      res.status(403).json({ error: 'Access Expired', code: 'ACCESS_EXPIRED' });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, access.passwordHash);
    if (!passwordMatch) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Update lastLoginAt
    await prisma.temporaryDriverAccess.update({
      where: { id: access.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: DriverTokenPayload = {
      driverAccessId: access.id,
      phone: access.phone,
      expiresAt: access.expiresAt.toISOString(),
    };

    const token = signDriverToken(payload);

    res.json({
      token,
      expiresAt: access.expiresAt,
      phone: access.phone,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Login failed';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/driver/status
// Check if the current session is still valid.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/status', requireDriverAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const driver = (req as Request & { driver: DriverTokenPayload }).driver;

    const access = await prisma.temporaryDriverAccess.findUnique({
      where: { id: driver.driverAccessId },
      include: { _count: { select: { uploadedDocs: true } } },
    });

    if (!access || access.isRevoked || access.expiresAt < new Date()) {
      res.status(403).json({ error: 'Access Expired', code: 'ACCESS_EXPIRED' });
      return;
    }

    res.json({
      phone: access.phone,
      expiresAt: access.expiresAt,
      uploadCount: access._count.uploadedDocs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get status';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/driver/upload
// Upload a document. Requires auth. Runs OCR and auto-links.
// Form fields: file (multipart), docType (LR | TOLL | WEIGHMENT_PARTY | WEIGHMENT_SITE | PARTY_ACK)
// ──────────────────────────────────────────────────────────────────────────────
router.post(
  '/upload',
  loginLimiter,
  uploadLimiter,
  requireDriverAuth,
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const driver = (req as Request & { driver: DriverTokenPayload }).driver;

      // Double-check expiry at upload time (defence-in-depth)
      const access = await prisma.temporaryDriverAccess.findUnique({
        where: { id: driver.driverAccessId },
      });

      if (!access || access.isRevoked || access.expiresAt < new Date()) {
        res.status(403).json({ error: 'Access Expired', code: 'ACCESS_EXPIRED' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const { docType } = req.body as { docType?: string };
      const validDocTypes: DriverUploadDocType[] = ['LR', 'TOLL', 'WEIGHMENT_SLIP', 'WEIGHMENT_PARTY', 'WEIGHMENT_SITE', 'PARTY_ACK'];
      if (!docType || !validDocTypes.includes(docType as (typeof validDocTypes)[number])) {
        res.status(400).json({ error: `docType must be one of: ${validDocTypes.join(', ')}` });
        return;
      }
      const selectedDocType = docType as DriverUploadDocType;

      // Create initial DB record
      const driverDoc = await prisma.driverUploadDocument.create({
        data: {
          docType: selectedDocType,
          storageKey: req.file.path,
          originalFilename: req.file.originalname,
          mimeType: req.file.mimetype,
          status: 'PENDING_OCR',
          tempDriverAccessId: driver.driverAccessId,
        },
      });

      // ── Toll receipts: OCR temporarily disabled ────────────────────────
      // Same as the admin-side OCR route — skip the vision-model call
      // entirely, keep the file viewable, don't attempt auto-link (there's
      // no extracted data to link with). Remove this block to re-enable.
      if (selectedDocType === 'TOLL') {
        const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? './uploads');
        const resolvedFilePath = path.resolve(req.file.path);

        const adminDoc = resolvedFilePath.startsWith(uploadDir + path.sep)
          ? await prisma.document.create({
              data: {
                type: 'TOLL',
                status: 'SAVED',
                originalFilename: req.file.originalname,
                rawFilePath: resolvedFilePath,
                mimeType: req.file.mimetype,
              },
            })
          : null;

        // 'UNLINKED' is reused here to mean "not auto-linked to a group" —
        // there is no DriverUploadStatus value for "OCR intentionally
        // skipped", and this is the closest honest fit without a schema change.
        const updated = await prisma.driverUploadDocument.update({
          where: { id: driverDoc.id },
          data: { status: 'UNLINKED' },
        });

        res.status(201).json({
          message: 'Toll receipt saved. OCR is currently disabled for toll receipts.',
          document: {
            id: updated.id,
            docType: updated.docType,
            status: updated.status,
            originalFilename: updated.originalFilename,
            uploadedAt: updated.uploadedAt,
            vehicleNumber: updated.vehicleNumber,
            documentDate: updated.documentDate,
            linkedGroupId: updated.linkedGroupId,
            adminDocumentId: adminDoc?.id ?? null,
          },
        });
        return;
      }

      // Run OCR asynchronously (fire and forget) but wait for result
      let ocrText: string | null = null;
      let vehicleNumber: string | null = null;
      let documentDate: string | null = null;
      let linkedGroupId: string | null = null;
      let finalStatus: 'PROCESSED' | 'UNLINKED' = 'UNLINKED';

      try {
        // Validate that the file is within the configured upload directory
        const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? './uploads');
        const resolvedFilePath = path.resolve(req.file.path);
        if (!resolvedFilePath.startsWith(uploadDir + path.sep)) {
          throw new Error('File path outside upload directory');
        }

        const ocrResult = await processDocumentOcr(resolvedFilePath, req.file.mimetype);

        ocrText = ocrResult.fields.lrNo ?? null;
        vehicleNumber = ocrResult.fields.vehicleNo ?? null;
        documentDate = ocrResult.fields.date ?? null;

        const linkedDocumentType = mapDriverDocTypeToDocumentType(selectedDocType);

        // Create a Document record in the main system so the upload is visible
        // to admins in the Documents view and participates in auto-linking to
        // Lr records and DocumentGroups (via saveOcrResults).
        const adminDoc = await prisma.document.create({
          data: {
            type:             linkedDocumentType,
            status:           'PENDING_OCR',
            originalFilename: req.file.originalname,
            rawFilePath:      resolvedFilePath,
            mimeType:         req.file.mimetype,
          },
        });

        // saveOcrResults updates the Document type/status, stores ExtractedData,
        // and calls autoLinkDocument + autoLinkDocumentToGroup.
        await saveOcrResults(adminDoc.id, ocrResult.fields, linkedDocumentType, ocrResult.rawResponse);

        // Fetch the groupId that autoLinkDocumentToGroup set on the Document.
        const updatedAdminDoc = await prisma.document.findUnique({
          where: { id: adminDoc.id },
          select: { groupId: true },
        });

        linkedGroupId = updatedAdminDoc?.groupId ?? null;
        finalStatus = linkedGroupId ? 'PROCESSED' : 'UNLINKED';

        // Update with OCR results
        await prisma.driverUploadDocument.update({
          where: { id: driverDoc.id },
          data: {
            status: finalStatus,
            ocrText: typeof ocrResult.fields.lrNo === 'string' ? ocrResult.fields.lrNo : null,
            ocrData: ocrResult.rawResponse,
            vehicleNumber: vehicleNumber,
            documentDate: documentDate,
            linkedGroupId: linkedGroupId,
          },
        });
      } catch (ocrErr) {
        // OCR failed — leave as PENDING_OCR, don't fail the upload
        console.error('OCR error during driver upload:', ocrErr instanceof Error ? ocrErr.message : ocrErr);
      }

      const updated = await prisma.driverUploadDocument.findUnique({ where: { id: driverDoc.id } });

      res.status(201).json({
        message: 'Document uploaded successfully',
        document: {
          id: updated?.id,
          docType: updated?.docType,
          status: updated?.status,
          originalFilename: updated?.originalFilename,
          uploadedAt: updated?.uploadedAt,
          vehicleNumber: updated?.vehicleNumber,
          documentDate: updated?.documentDate,
          linkedGroupId: updated?.linkedGroupId,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      res.status(500).json({ error: message });
    }
  }
);

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/driver/uploads
// List the current driver's uploads.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/uploads', requireDriverAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const driver = (req as Request & { driver: DriverTokenPayload }).driver;

    const docs = await prisma.driverUploadDocument.findMany({
      where: { tempDriverAccessId: driver.driverAccessId },
      include: { linkedGroup: true },
      orderBy: { uploadedAt: 'desc' },
    });

    res.json({ uploads: docs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch uploads';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/driver/uploads/:id/file
// Lets a driver view a file they uploaded themselves — scoped strictly to
// their own tempDriverAccessId, never any other driver's or any admin
// document. This is what backs the "View" button in the driver portal's
// upload history, so a driver can confirm what they actually sent (this
// matters more than ever for toll receipts, since those now skip OCR
// entirely and have no other feedback to show).
// ──────────────────────────────────────────────────────────────────────────────
router.get('/uploads/:id/file', requireDriverAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const driver = (req as Request & { driver: DriverTokenPayload }).driver;
    const id = req.params['id'] as string;

    const doc = await prisma.driverUploadDocument.findFirst({
      where: { id, tempDriverAccessId: driver.driverAccessId },
    });
    if (!doc) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }

    const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? './uploads');
    const resolved = path.resolve(doc.storageKey);
    if (resolved !== uploadDir && !resolved.startsWith(uploadDir + path.sep)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: 'File not found on server' });
      return;
    }

    const safeFilename = doc.originalFilename.replace(/[^\w.\- ]/g, '_').slice(0, 200) || 'document';
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(resolved).pipe(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load file';
    res.status(500).json({ error: message });
  }
});

export default router;