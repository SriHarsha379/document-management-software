import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/auth.routes.js';
import { requirePermission, buildScopeWhere } from '../rbac/rbac.middleware.js';
import { lrRepo } from './lr.repo.js';

const router = Router();

// All LR routes require a valid user JWT
router.use(requireAuth);

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

      const limit  = Math.min(Number(req.query.limit  ?? 50), 200);
      const offset = Number(req.query.offset ?? 0);

      const rows = await lrRepo.findMany({ where, limit, offset });
      res.json({ data: rows, limit, offset });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      res.status(500).json({ error: message });
    }
  }
);

// ── POST /api/lrs ──────────────────────────────────────────────────────────────
// Creates a new LR record within the user's company scope.
// Protected by lr.create permission.

router.post(
  '/',
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

      if (!lrNo || !branchId) {
        res.status(400).json({ error: 'lrNo and branchId are required' });
        return;
      }

      // Enforce that the branchId is within the user's allowed branches
      if (!user.isSuperAdmin && !user.branchIds.includes(branchId)) {
        res.status(403).json({ error: 'Forbidden: branch not in scope' });
        return;
      }

      const lr = await lrRepo.create({
        lrNo,
        companyId: user.companyId,
        branchId,
        source: source ?? 'INTERNAL',
        consignor,
        consignee,
        vehicleNo,
        date,
        createdBy: user.id,
      });

      res.status(201).json({ data: lr });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      res.status(500).json({ error: message });
    }
  }
);

// ── PATCH /api/lrs/:id ────────────────────────────────────────────────────────
// Updates an existing LR record.  Row is fetched WITH the scope filter so a
// record from another branch/company returns 404 (existence does not leak).
// Protected by lr.update permission.

router.patch(
  '/:id',
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

      const updated = await lrRepo.update(lr.id, { lrNo, status, consignor, consignee, vehicleNo, date });
      res.json({ data: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      res.status(500).json({ error: message });
    }
  }
);

// ── DELETE /api/lrs/:id ───────────────────────────────────────────────────────
// Deletes an LR record.  Same scoped-fetch pattern as PATCH.
// Protected by lr.delete permission.

router.delete(
  '/:id',
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
      const message = err instanceof Error ? err.message : 'Internal server error';
      res.status(500).json({ error: message });
    }
  }
);

export default router;
