import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { prisma } from '../services/documentService.js';
import { requireAuth } from '../modules/auth/auth.routes.js';

const router = Router();

const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

router.use(readLimiter);
router.use(requireAuth);

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/admin/customer-portal-access
// Create (or renew) a customer portal access entry for a Party.
// Returns the plain-text token once — admin must share it with the customer.
// Body: { partyId: string, loginEmail?: string, daysValid?: number }
// ──────────────────────────────────────────────────────────────────────────────
router.post('/', writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { partyId, loginEmail: overrideEmail, daysValid } = req.body as {
      partyId?: string;
      loginEmail?: string;
      daysValid?: number;
    };

    if (!partyId || typeof partyId !== 'string' || partyId.trim() === '') {
      res.status(400).json({ error: 'partyId is required' });
      return;
    }

    // req.user is guaranteed by requireAuth middleware above
    const trimmedPartyId = partyId.trim();
    let party = await prisma.party.findUnique({ where: { id: trimmedPartyId } });
    if (!party) {
      // Fall back to lookup by code within the authenticated user's company
      party = await prisma.party.findUnique({
        where: { companyId_code: { companyId: req.user!.companyId, code: trimmedPartyId } },
      });
    }
    if (!party) {
      res.status(404).json({ error: 'Party not found' });
      return;
    }

    const loginEmail = (overrideEmail?.trim() || party.email?.trim() || '').toLowerCase();
    if (!loginEmail) {
      res.status(400).json({ error: 'loginEmail is required (or set email on the Party record first)' });
      return;
    }

    const validDays = Math.min(Math.max(Number(daysValid) || 30, 1), 365);
    const expiresAt = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000);

    // Generate a random 12-char alphanumeric token
    const plainToken = randomBytes(9).toString('base64url').toUpperCase().slice(0, 12);
    const tokenHash = await bcrypt.hash(plainToken, 10);

    // Upsert: if access for this loginEmail already exists, renew it
    const existing = await prisma.customerPortalAccess.findUnique({ where: { loginEmail } });

    let access;
    if (existing) {
      access = await prisma.customerPortalAccess.update({
        where: { loginEmail },
        data: { tokenHash, expiresAt, isRevoked: false, lastLoginAt: null, partyId: party.id },
        include: { party: { select: { name: true, code: true, email: true } } },
      });
    } else {
      access = await prisma.customerPortalAccess.create({
        data: { partyId: party.id, loginEmail, tokenHash, expiresAt },
        include: { party: { select: { name: true, code: true, email: true } } },
      });
    }

    res.status(201).json({
      message: existing ? 'Customer portal access renewed' : 'Customer portal access created',
      access: {
        id: access.id,
        partyId: access.partyId,
        partyName: access.party.name,
        partyCode: access.party.code,
        loginEmail: access.loginEmail,
        expiresAt: access.expiresAt,
        createdAt: access.createdAt,
        isRevoked: access.isRevoked,
      },
      // Return plain token ONCE — admin must share with customer
      generatedToken: plainToken,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create customer portal access';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/admin/customer-portal-access
// List all customer portal accesses.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/', readLimiter, async (_req: Request, res: Response): Promise<void> => {
  try {
    const accesses = await prisma.customerPortalAccess.findMany({
      orderBy: { createdAt: 'desc' },
      include: { party: { select: { name: true, code: true, companyId: true } } },
    });

    res.json({
      accesses: accesses.map((a) => ({
        id: a.id,
        partyId: a.partyId,
        partyName: a.party.name,
        partyCode: a.party.code,
        companyId: a.party.companyId,
        loginEmail: a.loginEmail,
        createdAt: a.createdAt,
        expiresAt: a.expiresAt,
        lastLoginAt: a.lastLoginAt,
        isRevoked: a.isRevoked,
        isExpired: a.expiresAt < new Date(),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list customer portal accesses';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/customer-portal-access/:id/revoke
// Revoke a specific customer portal access.
// ──────────────────────────────────────────────────────────────────────────────
router.put('/:id/revoke', writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const access = await prisma.customerPortalAccess.findUnique({ where: { id } });
    if (!access) {
      res.status(404).json({ error: 'Customer portal access not found' });
      return;
    }

    await prisma.customerPortalAccess.update({
      where: { id },
      data: { isRevoked: true },
    });

    res.json({ message: 'Customer portal access revoked' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to revoke customer portal access';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/customer-portal-access/:id
// Delete a specific customer portal access entry.
// ──────────────────────────────────────────────────────────────────────────────
router.delete('/:id', writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const access = await prisma.customerPortalAccess.findUnique({ where: { id } });
    if (!access) {
      res.status(404).json({ error: 'Customer portal access not found' });
      return;
    }

    await prisma.customerPortalAccess.delete({ where: { id } });
    res.json({ message: 'Customer portal access deleted' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete customer portal access';
    res.status(500).json({ error: message });
  }
});

export default router;
