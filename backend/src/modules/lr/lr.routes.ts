import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../auth/auth.routes.js';
import { requirePermission, buildScopeWhere } from '../rbac/rbac.middleware.js';
import { ALLOWED_SOURCES, ALLOWED_LR_STATUSES } from '../rbac/permissions.js';
import { lrRepo } from './lr.repo.js';

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
      const { lrNo, branchId, source, consignor, consignee, vehicleNo, date } =
        req.body as {
          lrNo?: string;
          branchId?: string;
          source?: string;
          consignor?: string;
          consignee?: string;
          vehicleNo?: string;
          date?: string;
        };

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
        lrNo:      lrNo.trim(),
        companyId: user.companyId,
        branchId:  branchId.trim(),
        source:    source ?? 'INTERNAL',
        consignor: consignor?.trim(),
        consignee: consignee?.trim(),
        vehicleNo: vehicleNo?.trim(),
        date:      date?.trim(),
        createdBy: user.id,
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

      const { lrNo, status, consignor, consignee, vehicleNo, date } =
        req.body as {
          lrNo?: string;
          status?: string;
          consignor?: string;
          consignee?: string;
          vehicleNo?: string;
          date?: string;
        };

      if (status && !(ALLOWED_LR_STATUSES as readonly string[]).includes(status)) {
        res.status(400).json({ error: `status must be one of: ${ALLOWED_LR_STATUSES.join(', ')}` });
        return;
      }

      const updated = await lrRepo.update(lr.id, {
        lrNo:      lrNo?.trim(),
        status,
        consignor: consignor?.trim(),
        consignee: consignee?.trim(),
        vehicleNo: vehicleNo?.trim(),
        date:      date?.trim(),
      });
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

// Log the real error server-side; send a generic message in production.
function handleRouteError(err: unknown, res: Response, context: string): void {
  console.error(`${context}:`, err);
  const message =
    process.env.NODE_ENV !== 'production' && err instanceof Error
      ? err.message
      : 'An unexpected error occurred';
  res.status(500).json({ error: message });
}
