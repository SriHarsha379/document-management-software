/**
 * Search Routes  —  /api/search
 *
 * Endpoints:
 *  POST  /api/search              Natural-language search (existing, enhanced)
 *  GET   /api/search/documents    Structured filter-based search with pagination
 *  POST  /api/search/saved-filters       Save a named filter set
 *  GET   /api/search/saved-filters       List saved filters for the current user
 *  DELETE /api/search/saved-filters/:id  Delete a saved filter
 */

import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../modules/auth/auth.routes.js';
import {
  searchDocuments,
  executeAdvancedSearch,
  createSavedFilter,
  listSavedFilters,
  deleteSavedFilter,
  clampLimit,
  clampPage,
  SEARCH_MAX_LIMIT,
  SEARCH_DEFAULT_LIMIT,
} from '../services/searchService.js';
import type { AdvancedSearchFilters, SavedFilterPayload, DocumentType, DocumentStatus } from '../types/index.js';

const router = Router();

// ── Rate limiters ─────────────────────────────────────────────────────────────

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many search requests. Please slow down.' },
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// ── POST /api/search ──────────────────────────────────────────────────────────
// Natural-language search (backward-compatible).
// Accepts optional `page` and `limit` body fields for pagination.
// When a JWT is present the user's company/source scope is enforced.

router.post('/', searchLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, page, limit } = req.body as { query?: string; page?: number; limit?: number };

    if (!query || typeof query !== 'string' || query.trim() === '') {
      res.status(400).json({ error: 'query is required and must be a non-empty string' });
      return;
    }

    const trimmed = query.trim().slice(0, 500);
    const user = req.user;

    const result = await searchDocuments(
      trimmed,
      clampPage(page),
      clampLimit(limit),
      user?.companyId,
      user?.allowedSources,
    );

    res.json(result);
  } catch (err) {
    handleError(err, res, 'POST /search');
  }
});

// ── GET /api/search/documents ─────────────────────────────────────────────────
// Structured search with explicit filter params, pagination, and sorting.
// Requires authentication — company/source scope is enforced from the JWT.
//
// Query params (all optional):
//   companyId, source
//   documentType, documentStatus
//   lrNo, invoiceNo, vehicleNo, partyName, transporter
//   dateFrom, dateTo           (document date, YYYY-MM-DD)
//   uploadedFrom, uploadedTo   (upload timestamp, ISO-8601)
//   page, limit                (default 1 / 20, max limit 100)
//   sortBy                     (uploadedAt | date, default uploadedAt)
//   sortDir                    (asc | desc, default desc)

router.get('/documents', searchLimiter, requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as Record<string, string | undefined>;

    const validDocTypes = new Set<string>(['LR', 'INVOICE', 'TOLL', 'WEIGHMENT', 'EWAYBILL', 'RECEIVING', 'UNKNOWN']);
    const validStatuses = new Set<string>(['PENDING_OCR', 'PENDING_REVIEW', 'REVIEWED', 'SAVED']);

    const rawDocType = q.documentType?.toUpperCase();
    const rawStatus = q.documentStatus?.toUpperCase();

    if (rawDocType && !validDocTypes.has(rawDocType)) {
      res.status(400).json({ error: `Invalid documentType. Must be one of: ${[...validDocTypes].join(', ')}` });
      return;
    }
    if (rawStatus && !validStatuses.has(rawStatus)) {
      res.status(400).json({ error: `Invalid documentStatus. Must be one of: ${[...validStatuses].join(', ')}` });
      return;
    }

    const rawSortBy = q.sortBy;
    if (rawSortBy && rawSortBy !== 'uploadedAt' && rawSortBy !== 'date') {
      res.status(400).json({ error: 'sortBy must be uploadedAt or date' });
      return;
    }
    const rawSortDir = q.sortDir;
    if (rawSortDir && rawSortDir !== 'asc' && rawSortDir !== 'desc') {
      res.status(400).json({ error: 'sortDir must be asc or desc' });
      return;
    }

    const rawLimit = parseInt(q.limit ?? '', 10);
    const rawPage  = parseInt(q.page  ?? '', 10);

    // Validate date strings (basic ISO format check)
    for (const field of ['dateFrom', 'dateTo', 'uploadedFrom', 'uploadedTo'] as const) {
      const val = q[field];
      if (val && isNaN(Date.parse(val))) {
        res.status(400).json({ error: `Invalid date format for ${field}. Use YYYY-MM-DD or ISO-8601.` });
        return;
      }
    }

    const user = req.user!;
    const filters: AdvancedSearchFilters = {
      // Caller-supplied filters
      documentType:   rawDocType as DocumentType | undefined,
      documentStatus: rawStatus as DocumentStatus | undefined,
      lrNo:           q.lrNo,
      invoiceNo:      q.invoiceNo,
      vehicleNo:      q.vehicleNo,
      partyName:      q.partyName,
      transporter:    q.transporter,
      dateFrom:       q.dateFrom,
      dateTo:         q.dateTo,
      uploadedFrom:   q.uploadedFrom,
      uploadedTo:     q.uploadedTo,
      companyId:      q.companyId,
      source:         q.source,
      sortBy:         rawSortBy as 'uploadedAt' | 'date' | undefined,
      sortDir:        rawSortDir as 'asc' | 'desc' | undefined,
      page:           isNaN(rawPage) ? 1 : rawPage,
      limit:          isNaN(rawLimit) ? SEARCH_DEFAULT_LIMIT : rawLimit,
    };

    const result = await executeAdvancedSearch(
      filters,
      user.isSuperAdmin ? undefined : user.companyId,
      user.isSuperAdmin ? undefined : user.allowedSources,
    );

    res.json(result);
  } catch (err) {
    handleError(err, res, 'GET /search/documents');
  }
});

// ── POST /api/search/saved-filters ───────────────────────────────────────────
// Save a named filter set for the authenticated user.
// Body: { name: string, filters: AdvancedSearchFilters }

router.post('/saved-filters', writeLimiter, requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, filters } = req.body as Partial<SavedFilterPayload>;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!filters || typeof filters !== 'object') {
      res.status(400).json({ error: 'filters object is required' });
      return;
    }

    const saved = await createSavedFilter(req.user!.id, { name, filters });
    res.status(201).json({
      id: saved.id,
      name: saved.name,
      filters,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    });
  } catch (err) {
    handleError(err, res, 'POST /search/saved-filters');
  }
});

// ── GET /api/search/saved-filters ────────────────────────────────────────────
// Return all saved filters belonging to the current user.

router.get('/saved-filters', searchLimiter, requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const saved = await listSavedFilters(req.user!.id);
    res.json({ savedFilters: saved });
  } catch (err) {
    handleError(err, res, 'GET /search/saved-filters');
  }
});

// ── DELETE /api/search/saved-filters/:id ─────────────────────────────────────
// Delete a saved filter (only if it belongs to the current user).

router.delete('/saved-filters/:id', writeLimiter, requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await deleteSavedFilter(req.params['id'] as string, req.user!.id);
    if (!deleted) {
      res.status(404).json({ error: 'Saved filter not found' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    handleError(err, res, 'DELETE /search/saved-filters/:id');
  }
});

export default router;

// ── Helpers ───────────────────────────────────────────────────────────────────

function handleError(err: unknown, res: Response, context: string): void {
  console.error(`[search] ${context}:`, err);
  const message =
    process.env.NODE_ENV !== 'production' && err instanceof Error
      ? err.message
      : 'An unexpected error occurred';
  res.status(500).json({ error: message });
}

// Re-export constants so tests can use them without importing the service directly
export { SEARCH_MAX_LIMIT, SEARCH_DEFAULT_LIMIT };

