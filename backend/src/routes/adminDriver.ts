import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../services/documentService.js';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/admin/driver-access
// Create a temporary driver access entry. Returns the plain-text password once.
// Body: { phone: string }
// ──────────────────────────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone } = req.body as { phone?: string };
    if (!phone || typeof phone !== 'string' || phone.trim() === '') {
      res.status(400).json({ error: 'phone is required' });
      return;
    }

    const cleanPhone = phone.trim();

    // Generate random 8-char alphanumeric password
    const plainPassword = randomBytes(5).toString('hex').toUpperCase(); // 10 hex chars
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // +7 days

    const existing = await prisma.temporaryDriverAccess.findUnique({ where: { phone: cleanPhone } });

    let access;
    if (existing) {
      // Renew: update password and expiry
      access = await prisma.temporaryDriverAccess.update({
        where: { phone: cleanPhone },
        data: { passwordHash, expiresAt, isRevoked: false, lastLoginAt: null },
      });
    } else {
      access = await prisma.temporaryDriverAccess.create({
        data: { phone: cleanPhone, passwordHash, expiresAt },
      });
    }

    res.status(201).json({
      message: existing ? 'Driver access renewed' : 'Driver access created',
      driverAccess: {
        id: access.id,
        phone: access.phone,
        expiresAt: access.expiresAt,
        createdAt: access.createdAt,
        isRevoked: access.isRevoked,
      },
      // Return plain password ONCE — admin must share with driver
      generatedPassword: plainPassword,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create driver access';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/admin/driver-access
// List all temporary driver accesses.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const accesses = await prisma.temporaryDriverAccess.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { uploadedDocs: true } } },
    });

    res.json({
      accesses: accesses.map((a) => ({
        id: a.id,
        phone: a.phone,
        createdAt: a.createdAt,
        expiresAt: a.expiresAt,
        lastLoginAt: a.lastLoginAt,
        isRevoked: a.isRevoked,
        isExpired: a.expiresAt < new Date(),
        uploadCount: a._count.uploadedDocs,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list driver accesses';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/driver-access/:id/revoke
// Revoke a specific driver access.
// ──────────────────────────────────────────────────────────────────────────────
router.put('/:id/revoke', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const access = await prisma.temporaryDriverAccess.findUnique({ where: { id } });
    if (!access) {
      res.status(404).json({ error: 'Driver access not found' });
      return;
    }

    await prisma.temporaryDriverAccess.update({
      where: { id },
      data: { isRevoked: true },
    });

    res.json({ message: 'Driver access revoked' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to revoke driver access';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/admin/driver-access/:id/uploads
// List all uploads for a specific driver access.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/:id/uploads', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const docs = await prisma.driverUploadDocument.findMany({
      where: { tempDriverAccessId: id },
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
