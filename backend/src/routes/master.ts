/**
 * Master Data Routes  —  /api/master
 *
 * Full CRUD for all five master entities plus lightweight dropdown endpoints.
 *
 * Access rules:
 *  - All authenticated users with MASTER_READ may list / get / use dropdowns
 *  - Only users with MASTER_MANAGE may create / update / deactivate records
 *  - Super Admins bypass all capability checks (via requirePermission middleware)
 *  - All operations are automatically scoped to the JWT user's companyId
 *
 * Endpoints overview:
 *
 *  Transporters
 *    GET    /api/master/transporters              list (paginated)
 *    POST   /api/master/transporters              create
 *    GET    /api/master/transporters/dropdown     dropdown data (id + label)
 *    GET    /api/master/transporters/:id          get one
 *    PUT    /api/master/transporters/:id          update
 *    DELETE /api/master/transporters/:id          soft-delete (deactivate)
 *
 *  Officers
 *    GET    /api/master/officers
 *    POST   /api/master/officers
 *    GET    /api/master/officers/dropdown
 *    GET    /api/master/officers/:id
 *    PUT    /api/master/officers/:id
 *    DELETE /api/master/officers/:id
 *
 *  Parties
 *    GET    /api/master/parties
 *    POST   /api/master/parties
 *    GET    /api/master/parties/dropdown
 *    GET    /api/master/parties/:id
 *    PUT    /api/master/parties/:id
 *    DELETE /api/master/parties/:id
 *
 *  Products
 *    GET    /api/master/products                  supports ?category= filter
 *    POST   /api/master/products
 *    GET    /api/master/products/dropdown         supports ?category= filter
 *    GET    /api/master/products/categories       distinct category list
 *    GET    /api/master/products/:id
 *    PUT    /api/master/products/:id
 *    DELETE /api/master/products/:id
 *
 *  Working Centres
 *    GET    /api/master/working-centres           supports ?branchId= filter
 *    POST   /api/master/working-centres
 *    GET    /api/master/working-centres/dropdown  supports ?branchId= filter
 *    GET    /api/master/working-centres/:id
 *    PUT    /api/master/working-centres/:id
 *    DELETE /api/master/working-centres/:id
 */

import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../modules/auth/auth.routes.js';
import { requirePermission } from '../modules/rbac/rbac.middleware.js';
import { PERMISSIONS } from '../modules/rbac/permissions.js';
import {
  ValidationError,
  NotFoundError,
  // Transporter
  createTransporter, listTransporters, getTransporter, updateTransporter,
  deactivateTransporter, transporterDropdown,
  // Officer
  createOfficer, listOfficers, getOfficer, updateOfficer,
  deactivateOfficer, officerDropdown,
  // Party
  createParty, listParties, getParty, updateParty,
  deactivateParty, partyDropdown,
  // Product
  createProduct, listProducts, getProduct, updateProduct,
  deactivateProduct, productDropdown, productCategories,
  // WorkingCentre
  createWorkingCentre, listWorkingCentres, getWorkingCentre, updateWorkingCentre,
  deactivateWorkingCentre, workingCentreDropdown,
  // Helpers
  clampMasterLimit, clampMasterPage,
} from '../services/masterService.js';

const router = Router();

// ── Rate limiters ─────────────────────────────────────────────────────────────

const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// ── Middleware helpers ────────────────────────────────────────────────────────

const canRead   = [requireAuth, requirePermission(PERMISSIONS.MASTER_READ)];
const canManage = [requireAuth, requirePermission(PERMISSIONS.MASTER_MANAGE)];

// Parse pagination query params
function paginationOpts(q: Record<string, string | undefined>) {
  return {
    page:            clampMasterPage(parseInt(q['page'] ?? '', 10)),
    limit:           clampMasterLimit(parseInt(q['limit'] ?? '', 10)),
    includeInactive: q['includeInactive'] === 'true',
    search:          q['search'] || undefined,
  };
}

// ── Error handler ─────────────────────────────────────────────────────────────

function handleMasterError(err: unknown, res: Response, context: string): void {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  console.error(`[master] ${context}:`, err);
  const msg =
    process.env.NODE_ENV !== 'production' && err instanceof Error
      ? err.message
      : 'An unexpected error occurred';
  res.status(500).json({ error: msg });
}

// ════════════════════════════════════════════════════════════════════════════
// TRANSPORTERS
// ════════════════════════════════════════════════════════════════════════════

router.get('/transporters/dropdown', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await transporterDropdown(req.user!.companyId));
  } catch (err) { handleMasterError(err, res, 'GET transporters/dropdown'); }
});

router.get('/transporters', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as Record<string, string | undefined>;
    res.json(await listTransporters(req.user!.companyId, paginationOpts(q)));
  } catch (err) { handleMasterError(err, res, 'GET transporters'); }
});

router.post('/transporters', writeLimiter, ...canManage, async (req: Request, res: Response): Promise<void> => {
  try {
    const item = await createTransporter(req.user!.companyId, req.body);
    res.status(201).json(item);
  } catch (err) { handleMasterError(err, res, 'POST transporters'); }
});

router.get('/transporters/:id', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await getTransporter(req.params['id'] as string, req.user!.companyId));
  } catch (err) { handleMasterError(err, res, 'GET transporters/:id'); }
});

router.put('/transporters/:id', writeLimiter, ...canManage, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await updateTransporter(req.params['id'] as string, req.user!.companyId, req.body));
  } catch (err) { handleMasterError(err, res, 'PUT transporters/:id'); }
});

router.delete('/transporters/:id', writeLimiter, ...canManage, async (req: Request, res: Response): Promise<void> => {
  try {
    await deactivateTransporter(req.params['id'] as string, req.user!.companyId);
    res.status(204).send();
  } catch (err) { handleMasterError(err, res, 'DELETE transporters/:id'); }
});

// ════════════════════════════════════════════════════════════════════════════
// OFFICERS
// ════════════════════════════════════════════════════════════════════════════

router.get('/officers/dropdown', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await officerDropdown(req.user!.companyId));
  } catch (err) { handleMasterError(err, res, 'GET officers/dropdown'); }
});

router.get('/officers', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as Record<string, string | undefined>;
    res.json(await listOfficers(req.user!.companyId, paginationOpts(q)));
  } catch (err) { handleMasterError(err, res, 'GET officers'); }
});

router.post('/officers', writeLimiter, ...canManage, async (req: Request, res: Response): Promise<void> => {
  try {
    const item = await createOfficer(req.user!.companyId, req.body);
    res.status(201).json(item);
  } catch (err) { handleMasterError(err, res, 'POST officers'); }
});

router.get('/officers/:id', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await getOfficer(req.params['id'] as string, req.user!.companyId));
  } catch (err) { handleMasterError(err, res, 'GET officers/:id'); }
});

router.put('/officers/:id', writeLimiter, ...canManage, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await updateOfficer(req.params['id'] as string, req.user!.companyId, req.body));
  } catch (err) { handleMasterError(err, res, 'PUT officers/:id'); }
});

router.delete('/officers/:id', writeLimiter, ...canManage, async (req: Request, res: Response): Promise<void> => {
  try {
    await deactivateOfficer(req.params['id'] as string, req.user!.companyId);
    res.status(204).send();
  } catch (err) { handleMasterError(err, res, 'DELETE officers/:id'); }
});

// ════════════════════════════════════════════════════════════════════════════
// PARTIES
// ════════════════════════════════════════════════════════════════════════════

router.get('/parties/dropdown', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await partyDropdown(req.user!.companyId));
  } catch (err) { handleMasterError(err, res, 'GET parties/dropdown'); }
});

router.get('/parties', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as Record<string, string | undefined>;
    res.json(await listParties(req.user!.companyId, paginationOpts(q)));
  } catch (err) { handleMasterError(err, res, 'GET parties'); }
});

router.post('/parties', writeLimiter, ...canManage, async (req: Request, res: Response): Promise<void> => {
  try {
    const item = await createParty(req.user!.companyId, req.body);
    res.status(201).json(item);
  } catch (err) { handleMasterError(err, res, 'POST parties'); }
});

router.get('/parties/:id', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await getParty(req.params['id'] as string, req.user!.companyId));
  } catch (err) { handleMasterError(err, res, 'GET parties/:id'); }
});

router.put('/parties/:id', writeLimiter, ...canManage, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await updateParty(req.params['id'] as string, req.user!.companyId, req.body));
  } catch (err) { handleMasterError(err, res, 'PUT parties/:id'); }
});

router.delete('/parties/:id', writeLimiter, ...canManage, async (req: Request, res: Response): Promise<void> => {
  try {
    await deactivateParty(req.params['id'] as string, req.user!.companyId);
    res.status(204).send();
  } catch (err) { handleMasterError(err, res, 'DELETE parties/:id'); }
});

// ════════════════════════════════════════════════════════════════════════════
// PRODUCTS
// ════════════════════════════════════════════════════════════════════════════

router.get('/products/categories', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await productCategories(req.user!.companyId));
  } catch (err) { handleMasterError(err, res, 'GET products/categories'); }
});

router.get('/products/dropdown', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as Record<string, string | undefined>;
    res.json(await productDropdown(req.user!.companyId, q['category']));
  } catch (err) { handleMasterError(err, res, 'GET products/dropdown'); }
});

router.get('/products', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as Record<string, string | undefined>;
    res.json(await listProducts(req.user!.companyId, { ...paginationOpts(q), category: q['category'] }));
  } catch (err) { handleMasterError(err, res, 'GET products'); }
});

router.post('/products', writeLimiter, ...canManage, async (req: Request, res: Response): Promise<void> => {
  try {
    const item = await createProduct(req.user!.companyId, req.body);
    res.status(201).json(item);
  } catch (err) { handleMasterError(err, res, 'POST products'); }
});

router.get('/products/:id', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await getProduct(req.params['id'] as string, req.user!.companyId));
  } catch (err) { handleMasterError(err, res, 'GET products/:id'); }
});

router.put('/products/:id', writeLimiter, ...canManage, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await updateProduct(req.params['id'] as string, req.user!.companyId, req.body));
  } catch (err) { handleMasterError(err, res, 'PUT products/:id'); }
});

router.delete('/products/:id', writeLimiter, ...canManage, async (req: Request, res: Response): Promise<void> => {
  try {
    await deactivateProduct(req.params['id'] as string, req.user!.companyId);
    res.status(204).send();
  } catch (err) { handleMasterError(err, res, 'DELETE products/:id'); }
});

// ════════════════════════════════════════════════════════════════════════════
// WORKING CENTRES
// ════════════════════════════════════════════════════════════════════════════

router.get('/working-centres/dropdown', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as Record<string, string | undefined>;
    res.json(await workingCentreDropdown(req.user!.companyId, q['branchId']));
  } catch (err) { handleMasterError(err, res, 'GET working-centres/dropdown'); }
});

router.get('/working-centres', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as Record<string, string | undefined>;
    res.json(await listWorkingCentres(req.user!.companyId, { ...paginationOpts(q), branchId: q['branchId'] }));
  } catch (err) { handleMasterError(err, res, 'GET working-centres'); }
});

router.post('/working-centres', writeLimiter, ...canManage, async (req: Request, res: Response): Promise<void> => {
  try {
    const item = await createWorkingCentre(req.user!.companyId, req.body);
    res.status(201).json(item);
  } catch (err) { handleMasterError(err, res, 'POST working-centres'); }
});

router.get('/working-centres/:id', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await getWorkingCentre(req.params['id'] as string, req.user!.companyId));
  } catch (err) { handleMasterError(err, res, 'GET working-centres/:id'); }
});

router.put('/working-centres/:id', writeLimiter, ...canManage, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await updateWorkingCentre(req.params['id'] as string, req.user!.companyId, req.body));
  } catch (err) { handleMasterError(err, res, 'PUT working-centres/:id'); }
});

router.delete('/working-centres/:id', writeLimiter, ...canManage, async (req: Request, res: Response): Promise<void> => {
  try {
    await deactivateWorkingCentre(req.params['id'] as string, req.user!.companyId);
    res.status(204).send();
  } catch (err) { handleMasterError(err, res, 'DELETE working-centres/:id'); }
});

export default router;
