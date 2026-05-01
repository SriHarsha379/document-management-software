import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import * as path from 'path';
import rateLimit from 'express-rate-limit';
import { upload } from '../middleware/upload.js';
import { requireDriverAuth, signDriverToken } from '../middleware/driverAuth.js';
import type { DriverTokenPayload } from '../middleware/driverAuth.js';
import { prisma, saveOcrResults } from '../services/documentService.js';
import { processDocumentOcr } from '../services/ocrService.js';

const router = Router();

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
// Form fields: file (multipart), docType (LR | TOLL | WEIGHMENT_SLIP)
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
      const validDocTypes = ['LR', 'TOLL', 'WEIGHMENT_SLIP'] as const;
      if (!docType || !validDocTypes.includes(docType as (typeof validDocTypes)[number])) {
        res.status(400).json({ error: `docType must be one of: ${validDocTypes.join(', ')}` });
        return;
      }

      // Create initial DB record
      const driverDoc = await prisma.driverUploadDocument.create({
        data: {
          docType: docType as 'LR' | 'TOLL' | 'WEIGHMENT_SLIP',
          storageKey: req.file.path,
          originalFilename: req.file.originalname,
          mimeType: req.file.mimetype,
          status: 'PENDING_OCR',
          tempDriverAccessId: driver.driverAccessId,
        },
      });

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

        // Create a Document record in the main system so the upload is visible
        // to admins in the Documents view and participates in auto-linking to
        // Lr records and DocumentGroups (via saveOcrResults).
        const adminDoc = await prisma.document.create({
          data: {
            type:             ocrResult.documentType,
            status:           'PENDING_OCR',
            originalFilename: req.file.originalname,
            rawFilePath:      resolvedFilePath,
            mimeType:         req.file.mimetype,
          },
        });

        // saveOcrResults updates the Document type/status, stores ExtractedData,
        // and calls autoLinkDocument + autoLinkDocumentToGroup.
        await saveOcrResults(adminDoc.id, ocrResult.fields, ocrResult.documentType, ocrResult.rawResponse);

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

export default router;
