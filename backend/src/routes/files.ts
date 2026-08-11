/**
 * Authenticated file serving.
 *
 * Replaces this line in app.ts:
 *
 *     app.use('/uploads', express.static(path.resolve(uploadDir)));
 *
 * That mount served every scanned document in the system — tax invoices,
 * lorry receipts, weighbridge tickets, signed acknowledgements, and with them
 * GSTINs, party names, quantities, rates, signatures and driver phone numbers —
 * to anyone who could reach the host. No session, no token, no expiry, and no
 * way to revoke access to a URL once it had leaked.
 *
 * Filenames are UUIDv4, so the files were unguessable in isolation. They were
 * not unguessable in practice: `GET /api/documents` was itself unauthenticated
 * and returned `filePath: path.basename(rawFilePath)` for every document, so
 * the two endpoints chained into full document exfiltration.
 *
 * The customer portal already implements this correctly
 * (routes/customerPortal.ts) — scoped query, dispatch-log check,
 * path-traversal guard. That work was simply bypassed by the static mount, and
 * this module applies the same discipline to internal users.
 *
 * ── Mount ────────────────────────────────────────────────────────────────────
 *
 *   // DELETE: app.use('/uploads', express.static(path.resolve(uploadDir)));
 *   app.use('/uploads', fileRoutes);
 *
 * The path stays `/uploads/:filename` so existing frontend URLs keep working;
 * they now need to carry the auth token like any other API call.
 */

import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from '../services/documentService.js';
import { requireAuth } from '../modules/auth/auth.routes.js';
import { requirePermission } from '../modules/rbac/rbac.middleware.js';
import { PERMISSIONS } from '../modules/rbac/permissions.js';

const router = Router();

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? './uploads');

/**
 * Strip anything that could break out of a quoted header value.
 *
 * `originalFilename` is attacker-controlled (it's whatever the uploader named
 * the file) and was previously interpolated raw into Content-Disposition, so a
 * filename containing a quote or CRLF injected into the response headers.
 */
function safeFilename(name: string): string {
  const cleaned = name.replace(/[^\w.\- ]/g, '_').slice(0, 200);
  return cleaned.length > 0 ? cleaned : 'document';
}

/**
 * GET /uploads/:filename
 *
 * Serves a stored file only when it corresponds to a Document row the caller is
 * allowed to see. Lookup is by stored path rather than by trusting the
 * requested name, so a filename that isn't a real Document is a 404 regardless
 * of whether it happens to exist on disk.
 */
router.get(
  '/:filename',
  requireAuth,
  requirePermission(PERMISSIONS.DOCUMENT_READ),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const raw = req.params.filename;
      const requested = path.basename(typeof raw === 'string' ? raw : '');
      if (!requested) {
        res.status(400).json({ error: 'Filename required' });
        return;
      }

      // Resolve first, then verify containment. Serving is gated on a matching
      // Document row, but the traversal guard stays as defence in depth: a
      // stored rawFilePath outside the upload directory would otherwise let a
      // bad DB row read arbitrary files.
      const resolved = path.resolve(UPLOAD_DIR, requested);
      if (resolved !== UPLOAD_DIR && !resolved.startsWith(UPLOAD_DIR + path.sep)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // A file is reachable only through a Document that points at it.
      const documents = await prisma.document.findMany({
        where: { rawFilePath: { endsWith: requested } },
        select: {
          id: true,
          rawFilePath: true,
          originalFilename: true,
          mimeType: true,
          documentLinks: { select: { lr: { select: { companyId: true } } } },
        },
      });

      const document = documents.find((d) => path.resolve(d.rawFilePath) === resolved);
      if (!document) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      // Tenant scoping.
      //
      // Documents have no companyId of their own — they reach a company only
      // through their Lr links — so an UNLINKED document cannot be scoped at
      // all. Rather than leak it to every tenant, a non-super-admin may read an
      // unlinked document only if no company owns it yet, and any document with
      // links must have at least one link into the caller's company.
      //
      // This is a stopgap. The real fix is a companyId on Document (and on
      // DocumentGroup), set at upload time from the uploader's context.
      if (!user.isSuperAdmin) {
        const linkedCompanyIds = document.documentLinks
          .map((l) => l.lr?.companyId)
          .filter((c): c is string => typeof c === 'string');

        if (linkedCompanyIds.length > 0 && !linkedCompanyIds.includes(user.companyId)) {
          // Deliberately 404, not 403: a 403 would confirm the file exists.
          res.status(404).json({ error: 'Document not found' });
          return;
        }
      }

      if (!fs.existsSync(resolved)) {
        res.status(404).json({ error: 'File not found on server' });
        return;
      }

      // `inline` so the frontend can preview scans in the viewer; the filename
      // is sanitised because it came from the uploader.
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${safeFilename(document.originalFilename)}"`,
      );
      res.setHeader('Content-Type', document.mimeType);
      // Stored documents are immutable, but they're private — never let a
      // shared cache hold one.
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      fs.createReadStream(resolved).pipe(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Download failed';
      res.status(500).json({ error: message });
    }
  },
);

export default router;
