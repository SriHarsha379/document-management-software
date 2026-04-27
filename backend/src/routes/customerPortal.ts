import { Router, type Request, type Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { requireCustomerAuth, signCustomerToken } from '../middleware/customerAuth.js';
import type { CustomerTokenPayload } from '../middleware/customerAuth.js';
import { prisma } from '../services/documentService.js';

const router = Router();

// Rate limiter for login: max 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
});

// Rate limiter for authenticated API endpoints: max 120 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/customer/login
// Authenticate with loginEmail + token. Validates expiry and isRevoked.
// Body: { email: string, token: string }
// ──────────────────────────────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, token } = req.body as { email?: string; token?: string };

    if (!email || !token) {
      res.status(400).json({ error: 'email and token are required' });
      return;
    }

    const loginEmail = email.trim().toLowerCase();

    const access = await prisma.customerPortalAccess.findUnique({
      where: { loginEmail },
      include: { party: { select: { id: true, name: true, companyId: true, phone: true } } },
    });

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

    const tokenMatch = await bcrypt.compare(token, access.tokenHash);
    if (!tokenMatch) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Update lastLoginAt
    await prisma.customerPortalAccess.update({
      where: { id: access.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: CustomerTokenPayload = {
      accessId: access.id,
      partyId: access.partyId,
      partyName: access.party.name,
      loginEmail: access.loginEmail,
      companyId: access.party.companyId,
      expiresAt: access.expiresAt.toISOString(),
    };

    const jwtToken = signCustomerToken(payload);

    res.json({
      token: jwtToken,
      expiresAt: access.expiresAt,
      partyName: access.party.name,
      loginEmail: access.loginEmail,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Login failed';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/customer/me
// Return current session info.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/me', apiLimiter, requireCustomerAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const customer = (req as Request & { customer: CustomerTokenPayload }).customer;

    const access = await prisma.customerPortalAccess.findUnique({
      where: { id: customer.accessId },
      include: { party: { select: { name: true, code: true, email: true, phone: true, address: true } } },
    });

    if (!access || access.isRevoked || access.expiresAt < new Date()) {
      res.status(403).json({ error: 'Access Expired', code: 'ACCESS_EXPIRED' });
      return;
    }

    res.json({
      partyName: access.party.name,
      partyCode: access.party.code,
      loginEmail: access.loginEmail,
      expiresAt: access.expiresAt,
      address: access.party.address,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get session info';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/customer/shipments
// List all document bundles dispatched to this customer's email or phone.
// Only READY or SENT bundles are returned (never DRAFT).
// ──────────────────────────────────────────────────────────────────────────────
router.get('/shipments', apiLimiter, requireCustomerAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const customer = (req as Request & { customer: CustomerTokenPayload }).customer;

    // Verify access is still valid
    const access = await prisma.customerPortalAccess.findUnique({
      where: { id: customer.accessId },
      include: { party: { select: { email: true, phone: true } } },
    });

    if (!access || access.isRevoked || access.expiresAt < new Date()) {
      res.status(403).json({ error: 'Access Expired', code: 'ACCESS_EXPIRED' });
      return;
    }

    // Build list of recipient identifiers to match against dispatch logs
    const recipientIdentifiers: string[] = [access.loginEmail];
    if (access.party.phone) recipientIdentifiers.push(access.party.phone.trim());

    // Find bundles dispatched to any of the customer's contact identifiers
    // Only non-DRAFT bundles are eligible
    const bundles = await prisma.documentBundle.findMany({
      where: {
        recipientType: 'PARTY',
        status: { not: 'DRAFT' },
        dispatchLogs: {
          some: {
            recipient: { in: recipientIdentifiers },
          },
        },
      },
      include: {
        group: { select: { vehicleNo: true, date: true } },
        items: {
          include: {
            document: {
              select: {
                id: true,
                type: true,
                originalFilename: true,
                uploadedAt: true,
                mimeType: true,
              },
            },
          },
        },
        dispatchLogs: {
          where: { recipient: { in: recipientIdentifiers } },
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: { sentAt: true, channel: true, status: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({
      shipments: bundles.map((b) => ({
        id: b.id,
        status: b.status,
        vehicleNo: b.group.vehicleNo,
        date: b.group.date,
        documentCount: b.items.length,
        lastDispatch: b.dispatchLogs[0] ?? null,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch shipments';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/customer/shipments/:bundleId
// Get a single bundle with all documents.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/shipments/:bundleId', apiLimiter, requireCustomerAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const customer = (req as Request & { customer: CustomerTokenPayload }).customer;
    const { bundleId } = req.params as { bundleId: string };

    const access = await prisma.customerPortalAccess.findUnique({
      where: { id: customer.accessId },
      include: { party: { select: { email: true, phone: true } } },
    });

    if (!access || access.isRevoked || access.expiresAt < new Date()) {
      res.status(403).json({ error: 'Access Expired', code: 'ACCESS_EXPIRED' });
      return;
    }

    const recipientIdentifiers: string[] = [access.loginEmail];
    if (access.party.phone) recipientIdentifiers.push(access.party.phone.trim());

    const bundle = await prisma.documentBundle.findFirst({
      where: {
        id: bundleId,
        recipientType: 'PARTY',
        status: { not: 'DRAFT' },
        dispatchLogs: {
          some: { recipient: { in: recipientIdentifiers } },
        },
      },
      include: {
        group: { select: { vehicleNo: true, date: true } },
        items: {
          include: {
            document: {
              select: {
                id: true,
                type: true,
                originalFilename: true,
                uploadedAt: true,
                mimeType: true,
                extractedData: {
                  select: {
                    lrNo: true,
                    invoiceNo: true,
                    vehicleNo: true,
                    date: true,
                    partyNames: true,
                    transporter: true,
                  },
                },
              },
            },
          },
        },
        dispatchLogs: {
          orderBy: { sentAt: 'desc' },
          select: { sentAt: true, channel: true, status: true, recipient: true },
        },
      },
    });

    if (!bundle) {
      res.status(404).json({ error: 'Shipment not found' });
      return;
    }

    res.json({
      shipment: {
        id: bundle.id,
        status: bundle.status,
        notes: bundle.notes,
        vehicleNo: bundle.group.vehicleNo,
        date: bundle.group.date,
        documents: bundle.items.map((item) => ({
          id: item.document.id,
          type: item.document.type,
          originalFilename: item.document.originalFilename,
          uploadedAt: item.document.uploadedAt,
          mimeType: item.document.mimeType,
          extractedData: item.document.extractedData,
        })),
        dispatchLogs: bundle.dispatchLogs,
        createdAt: bundle.createdAt,
        updatedAt: bundle.updatedAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch shipment';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/customer/documents/:documentId/download
// Download a specific document file — only if it belongs to a bundle
// dispatched to this customer.
// ──────────────────────────────────────────────────────────────────────────────
router.get(
  '/documents/:documentId/download',
  apiLimiter,
  requireCustomerAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const customer = (req as Request & { customer: CustomerTokenPayload }).customer;
      const { documentId } = req.params as { documentId: string };

      const access = await prisma.customerPortalAccess.findUnique({
        where: { id: customer.accessId },
        include: { party: { select: { email: true, phone: true } } },
      });

      if (!access || access.isRevoked || access.expiresAt < new Date()) {
        res.status(403).json({ error: 'Access Expired', code: 'ACCESS_EXPIRED' });
        return;
      }

      const recipientIdentifiers: string[] = [access.loginEmail];
      if (access.party.phone) recipientIdentifiers.push(access.party.phone.trim());

      // Verify the document belongs to a bundle dispatched to this customer
      const bundleItem = await prisma.bundleItem.findFirst({
        where: {
          documentId,
          bundle: {
            recipientType: 'PARTY',
            status: { not: 'DRAFT' },
            dispatchLogs: {
              some: { recipient: { in: recipientIdentifiers } },
            },
          },
        },
        include: {
          document: { select: { rawFilePath: true, originalFilename: true, mimeType: true } },
        },
      });

      if (!bundleItem) {
        res.status(404).json({ error: 'Document not found or access denied' });
        return;
      }

      const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? './uploads');
      const resolvedFilePath = path.resolve(bundleItem.document.rawFilePath);

      // Security: prevent path traversal
      if (!resolvedFilePath.startsWith(uploadDir + path.sep)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      if (!fs.existsSync(resolvedFilePath)) {
        res.status(404).json({ error: 'File not found on server' });
        return;
      }

      res.setHeader('Content-Disposition', `attachment; filename="${bundleItem.document.originalFilename}"`);
      res.setHeader('Content-Type', bundleItem.document.mimeType);
      fs.createReadStream(resolvedFilePath).pipe(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Download failed';
      res.status(500).json({ error: message });
    }
  }
);

export default router;
