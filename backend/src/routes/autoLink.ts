/**
 * Auto-Link Routes  —  /api/documents/:id/links
 *
 * Exposes the document → LR auto-linking system over HTTP.
 *
 * Endpoints:
 *  GET    /api/documents/:id/links          List all LR links for a document
 *  POST   /api/documents/:id/links/auto     Trigger (re-)auto-link
 *  POST   /api/documents/:id/links          Manually link to a specific LR
 *  DELETE /api/documents/:id/links/:lrId    Remove a link
 *  POST   /api/admin/relink-pending         Batch-relink all pending documents
 */

import { Router, type Request, type Response } from 'express';
import { db } from '../lib/db.js';
import {
  autoLinkDocument,
  linkDocumentToLr,
  unlinkDocumentFromLr,
  getDocumentLinks,
  relinkPendingDocuments,
} from '../services/autoLinkService.js';

const router = Router();
const adminRouter = Router();

// ── GET /api/documents/:id/links ──────────────────────────────────────────────
// Returns all LR link records for the given document, sorted by confidence desc.

router.get('/:id/links', async (req: Request, res: Response): Promise<void> => {
  try {
    const doc = await db.document.findUnique({ where: { id: req.params['id'] as string } });
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const links = await getDocumentLinks(doc.id);
    res.json({ documentId: doc.id, links });
  } catch (err) {
    handleError(err, res, 'GET /links');
  }
});

// ── POST /api/documents/:id/links/auto ────────────────────────────────────────
// (Re-)runs the auto-link algorithm for the given document.
// Accepts an optional `companyId` body field to scope the LR search.

router.post('/:id/links/auto', async (req: Request, res: Response): Promise<void> => {
  try {
    const documentId = req.params['id'] as string;
    const doc = await db.document.findUnique({ where: { id: documentId } });
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const { companyId } = req.body as { companyId?: string };
    const result = await autoLinkDocument(documentId, companyId);

    res.json({ documentId, ...result });
  } catch (err) {
    handleError(err, res, 'POST /links/auto');
  }
});

// ── POST /api/documents/:id/links ─────────────────────────────────────────────
// Manually link a document to a specific LR.
// Body: { lrId: string }

router.post('/:id/links', async (req: Request, res: Response): Promise<void> => {
  try {
    const documentId = req.params['id'] as string;
    const { lrId } = req.body as { lrId?: string };

    if (!lrId?.trim()) {
      res.status(400).json({ error: 'lrId is required' });
      return;
    }

    const [doc, lr] = await Promise.all([
      db.document.findUnique({ where: { id: documentId } }),
      db.lr.findUnique({ where: { id: lrId.trim() } }),
    ]);

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    if (!lr) {
      res.status(404).json({ error: 'LR not found' });
      return;
    }

    const link = await linkDocumentToLr(documentId, lr.id, ['manual'], 1.0, true);
    res.status(201).json({ documentId, lrId: lr.id, linkedAt: link.linkedAt, isManual: true });
  } catch (err) {
    handleError(err, res, 'POST /links');
  }
});

// ── DELETE /api/documents/:id/links/:lrId ─────────────────────────────────────
// Removes the link between a document and an LR.

router.delete('/:id/links/:lrId', async (req: Request, res: Response): Promise<void> => {
  try {
    await unlinkDocumentFromLr(
      req.params['id'] as string,
      req.params['lrId'] as string,
    );
    res.status(204).send();
  } catch (err) {
    handleError(err, res, 'DELETE /links/:lrId');
  }
});

// ── POST /api/admin/relink-pending ────────────────────────────────────────────
// Admin endpoint: batch-relink all documents that have no confirmed auto-link.
// Designed for scheduled jobs (cron) to handle delayed uploads (T+1, T+7).
// Optional body: { companyId: string } to restrict to one tenant.

adminRouter.post('/relink-pending', async (req: Request, res: Response): Promise<void> => {
  try {
    const { companyId } = req.body as { companyId?: string };
    const summary = await relinkPendingDocuments(companyId);
    res.json({ message: 'Relink complete', ...summary });
  } catch (err) {
    handleError(err, res, 'POST /admin/relink-pending');
  }
});

export { adminRouter as relinkAdminRouter };
export default router;

// ── Helpers ───────────────────────────────────────────────────────────────────

function handleError(err: unknown, res: Response, context: string): void {
  console.error(`[autoLink] ${context}:`, err);
  const message =
    process.env.NODE_ENV !== 'production' && err instanceof Error
      ? err.message
      : 'An unexpected error occurred';
  res.status(500).json({ error: message });
}
