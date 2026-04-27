/**
 * communicationRoutes.ts
 *
 * Express router for /api/communication
 *
 * Endpoints:
 *   POST /send                          — enqueue a communication job
 *   GET  /recipients                    — recipient dropdown (from master data)
 *   GET  /jobs                          — list jobs (paginated)
 *   GET  /jobs/:jobId                   — get one job + messages
 *   POST /messages/:messageId/retry     — retry a failed message
 *   GET  /templates                     — list templates
 *   POST /templates                     — create template
 *   GET  /templates/:id                 — get one template
 *   PUT  /templates/:id                 — update template
 *   DELETE /templates/:id               — soft-delete template
 *   GET  /templates/:id/preview         — render template with sample vars
 */

import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../auth/auth.routes.js';
import { requirePermission } from '../rbac/rbac.middleware.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import {
  sendCommunication,
  getJob,
  listJobs,
  retryMessage,
  CommunicationValidationError,
} from './communicationService.js';
import { recipientDropdown } from './recipientResolver.js';
import {
  createTemplate,
  listTemplates,
  getTemplate,
  updateTemplate,
  deactivateTemplate,
  renderTemplate,
  TemplateValidationError,
  TemplateNotFoundError,
} from './templateService.js';
import type { TemplateVars } from './templateService.js';

const router = Router();

// ── Rate limiters ──────────────────────────────────────────────────────────────

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

// ── Permission middleware combos ───────────────────────────────────────────────

const canSend             = [requireAuth, requirePermission(PERMISSIONS.COMMUNICATION_SEND)];
const canRead             = [requireAuth, requirePermission(PERMISSIONS.COMMUNICATION_READ)];
const canManageTemplates  = [requireAuth, requirePermission(PERMISSIONS.COMMUNICATION_TEMPLATE_MANAGE)];

// ── Error handler ──────────────────────────────────────────────────────────────

function handleCommError(err: unknown, res: Response, context: string): void {
  if (err instanceof CommunicationValidationError || err instanceof TemplateValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof TemplateNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  console.error(`[communication] ${context}:`, err);
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: isProduction ? 'An unexpected error occurred' : (err instanceof Error ? err.message : String(err)),
  });
}

// ── POST /send ─────────────────────────────────────────────────────────────────

router.post('/send', writeLimiter, ...canSend, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await sendCommunication(
      req.user!.companyId,
      req.user!.id,
      req.body,
    );
    res.status(202).json(result);
  } catch (err) {
    if (err instanceof CommunicationValidationError) {
      const isNoRecipients = err.message.startsWith('No deliverable recipients');
      res.status(isNoRecipients ? 422 : 400).json({ error: err.message });
      return;
    }
    handleCommError(err, res, 'POST /send');
  }
});

// ── GET /recipients ────────────────────────────────────────────────────────────

router.get('/recipients', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, channel } = req.query as Record<string, string | undefined>;
    const items = await recipientDropdown({
      companyId: req.user!.companyId,
      type,
      channel,
    });
    res.json(items);
  } catch (err) {
    handleCommError(err, res, 'GET /recipients');
  }
});

// ── GET /jobs ──────────────────────────────────────────────────────────────────

router.get('/jobs', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const result = await listJobs(req.user!.companyId, {
      page:     q['page']     ? parseInt(q['page'], 10)  : undefined,
      limit:    q['limit']    ? parseInt(q['limit'], 10) : undefined,
      status:   q['status'],
      bundleId: q['bundleId'],
    });
    res.json(result);
  } catch (err) {
    handleCommError(err, res, 'GET /jobs');
  }
});

// ── GET /jobs/:jobId ───────────────────────────────────────────────────────────

router.get('/jobs/:jobId', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    const job = await getJob(req.params['jobId'] as string, req.user!.companyId);
    if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
    res.json(job);
  } catch (err) {
    handleCommError(err, res, 'GET /jobs/:jobId');
  }
});

// ── POST /messages/:messageId/retry ───────────────────────────────────────────

router.post('/messages/:messageId/retry', writeLimiter, ...canSend, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await retryMessage(
      req.params['messageId'] as string,
      req.user!.companyId,
    );
    if (!result) { res.status(404).json({ error: 'Message not found' }); return; }
    res.status(202).json(result);
  } catch (err) {
    handleCommError(err, res, 'POST /messages/:messageId/retry');
  }
});

// ── GET /templates ─────────────────────────────────────────────────────────────

router.get('/templates', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const result = await listTemplates(req.user!.companyId, {
      page:            q['page']  ? parseInt(q['page'], 10)  : undefined,
      limit:           q['limit'] ? parseInt(q['limit'], 10) : undefined,
      includeInactive: q['includeInactive'] === 'true',
    });
    res.json(result);
  } catch (err) {
    handleCommError(err, res, 'GET /templates');
  }
});

// ── POST /templates ────────────────────────────────────────────────────────────

router.post('/templates', writeLimiter, ...canManageTemplates, async (req: Request, res: Response): Promise<void> => {
  try {
    const tmpl = await createTemplate(req.user!.companyId, req.body);
    res.status(201).json(tmpl);
  } catch (err) {
    handleCommError(err, res, 'POST /templates');
  }
});

// ── GET /templates/:id ─────────────────────────────────────────────────────────

router.get('/templates/:id', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    const tmpl = await getTemplate(req.params['id'] as string, req.user!.companyId);
    res.json(tmpl);
  } catch (err) {
    handleCommError(err, res, 'GET /templates/:id');
  }
});

// ── PUT /templates/:id ─────────────────────────────────────────────────────────

router.put('/templates/:id', writeLimiter, ...canManageTemplates, async (req: Request, res: Response): Promise<void> => {
  try {
    const tmpl = await updateTemplate(req.params['id'] as string, req.user!.companyId, req.body);
    res.json(tmpl);
  } catch (err) {
    handleCommError(err, res, 'PUT /templates/:id');
  }
});

// ── DELETE /templates/:id ──────────────────────────────────────────────────────

router.delete('/templates/:id', writeLimiter, ...canManageTemplates, async (req: Request, res: Response): Promise<void> => {
  try {
    await deactivateTemplate(req.params['id'] as string, req.user!.companyId);
    res.status(204).send();
  } catch (err) {
    handleCommError(err, res, 'DELETE /templates/:id');
  }
});

// ── GET /templates/:id/preview ─────────────────────────────────────────────────
// Render the template with caller-supplied vars (for preview / testing).

router.get('/templates/:id/preview', readLimiter, ...canRead, async (req: Request, res: Response): Promise<void> => {
  try {
    const tmpl = await getTemplate(req.params['id'] as string, req.user!.companyId);

    // Accept vars from query string or body (GET may carry a body on some clients)
    const rawVars = (Object.keys(req.body ?? {}).length > 0 ? req.body : req.query) as TemplateVars;

    const renderedSubject = tmpl.subjectTemplate
      ? renderTemplate(tmpl.subjectTemplate, rawVars)
      : undefined;
    const renderedBody = renderTemplate(tmpl.bodyTemplate, rawVars);

    res.json({ templateId: tmpl.id, renderedSubject, renderedBody });
  } catch (err) {
    handleCommError(err, res, 'GET /templates/:id/preview');
  }
});

export default router;
