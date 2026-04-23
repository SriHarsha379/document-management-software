import { Router, type Request, type Response } from 'express';
import { prisma } from '../services/documentService.js';
import {
  previewBundle,
  createBundle,
  updateBundle,
  deleteBundle,
  RECIPIENT_RULES,
} from '../services/bundleService.js';
import type { RecipientType, BundleStatus, CreateBundlePayload, UpdateBundlePayload, BundlePreviewRequest } from '../types/index.js';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/bundles/preview
// Given groupId + recipientType, return auto-selected documents and missing types.
// Does NOT persist anything.
// ──────────────────────────────────────────────────────────────────────────────
router.post('/preview', async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId, recipientType } = req.body as BundlePreviewRequest;

    if (!groupId || !recipientType) {
      res.status(400).json({ error: 'groupId and recipientType are required' });
      return;
    }

    const validRecipients: RecipientType[] = ['ACCOUNTS', 'PARTY', 'TRANSPORTER'];
    if (!validRecipients.includes(recipientType)) {
      res.status(400).json({ error: `recipientType must be one of: ${validRecipients.join(', ')}` });
      return;
    }

    const group = await prisma.documentGroup.findUnique({ where: { id: groupId } });
    if (!group) {
      res.status(404).json({ error: 'Document group not found' });
      return;
    }

    const preview = await previewBundle(groupId, recipientType);

    res.json({
      preview,
      rules: RECIPIENT_RULES,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Preview failed';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/bundles
// Create and persist a new bundle.
// Body: { groupId, recipientType, documentIds, notes? }
// ──────────────────────────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId, recipientType, documentIds, notes } = req.body as CreateBundlePayload;

    if (!groupId || !recipientType || !Array.isArray(documentIds)) {
      res.status(400).json({ error: 'groupId, recipientType, and documentIds[] are required' });
      return;
    }

    const validRecipients: RecipientType[] = ['ACCOUNTS', 'PARTY', 'TRANSPORTER'];
    if (!validRecipients.includes(recipientType)) {
      res.status(400).json({ error: `recipientType must be one of: ${validRecipients.join(', ')}` });
      return;
    }

    const group = await prisma.documentGroup.findUnique({ where: { id: groupId } });
    if (!group) {
      res.status(404).json({ error: 'Document group not found' });
      return;
    }

    const bundle = await createBundle(groupId, recipientType, documentIds, notes);

    res.status(201).json({ message: 'Bundle created', bundle: formatBundle(bundle) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bundle creation failed';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/bundles
// List all bundles with optional filters.
// Query params: recipientType, status, groupId, page, limit
// ──────────────────────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { recipientType, status, groupId, page = '1', limit = '20' } = req.query as Record<string, string>;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const where: Record<string, unknown> = {};
    if (recipientType) where.recipientType = recipientType;
    if (status) where.status = status;
    if (groupId) where.groupId = groupId;

    const [bundles, total] = await Promise.all([
      prisma.documentBundle.findMany({
        where,
        include: {
          items: { include: { document: { select: { id: true, type: true, originalFilename: true, status: true } } } },
          group: { select: { id: true, vehicleNo: true, date: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.documentBundle.count({ where }),
    ]);

    res.json({
      bundles: bundles.map(formatBundle),
      pagination: { total, page: parseInt(page, 10), limit: take, pages: Math.ceil(total / take) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch bundles';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/bundles/:id
// Get a single bundle with all items.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;

    const bundle = await prisma.documentBundle.findUnique({
      where: { id },
      include: {
        items: { include: { document: true } },
        group: { include: { documents: { include: { extractedData: true } } } },
      },
    });

    if (!bundle) {
      res.status(404).json({ error: 'Bundle not found' });
      return;
    }

    res.json({ bundle: formatBundle(bundle) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch bundle';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/bundles/:id
// Update a bundle's document list and/or status.
// Body: { documentIds?, status?, notes? }
// ──────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;
    const payload = req.body as UpdateBundlePayload;

    const validStatuses: BundleStatus[] = ['DRAFT', 'READY', 'SENT'];
    if (payload.status && !validStatuses.includes(payload.status)) {
      res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
      return;
    }

    const updated = await updateBundle(id, payload);

    res.json({ message: 'Bundle updated', bundle: formatBundle(updated) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bundle update failed';
    const statusCode = message === 'Bundle not found' ? 404 : 500;
    res.status(statusCode).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/bundles/:id
// ──────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;

    const existing = await prisma.documentBundle.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Bundle not found' });
      return;
    }

    await deleteBundle(id);

    res.json({ message: 'Bundle deleted' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bundle deletion failed';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

type PrismaBundleWithRelations = {
  id: string;
  recipientType: string;
  status: string;
  notes: string | null;
  groupId: string;
  createdAt: Date;
  updatedAt: Date;
  group?: unknown;
  items?: Array<{
    id: string;
    bundleId: string;
    documentId: string;
    isOverride: boolean;
    document?: unknown;
  }>;
};

function formatBundle(bundle: PrismaBundleWithRelations) {
  return {
    id: bundle.id,
    recipientType: bundle.recipientType,
    status: bundle.status,
    notes: bundle.notes,
    groupId: bundle.groupId,
    createdAt: bundle.createdAt,
    updatedAt: bundle.updatedAt,
    group: bundle.group,
    items: (bundle.items ?? []).map((item) => ({
      id: item.id,
      documentId: item.documentId,
      isOverride: item.isOverride,
      document: item.document,
    })),
  };
}

export default router;
