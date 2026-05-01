import { Router, type Request, type Response } from 'express';
import * as path from 'path';
import { upload } from '../middleware/upload.js';
import { processDocumentOcr } from '../services/ocrService.js';
import { prisma, saveOcrResults, saveReviewedData } from '../services/documentService.js';
import type { ReviewPayload } from '../types/index.js';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/documents/upload
// Upload a document file. Creates a Document record with PENDING_OCR status.
// ──────────────────────────────────────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const document = await prisma.document.create({
      data: {
        type: 'UNKNOWN',
        status: 'PENDING_OCR',
        originalFilename: req.file.originalname,
        rawFilePath: req.file.path,
        mimeType: req.file.mimetype,
      },
    });

    res.status(201).json({
      message: 'File uploaded successfully',
      document: {
        id: document.id,
        type: document.type,
        status: document.status,
        originalFilename: document.originalFilename,
        uploadedAt: document.uploadedAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/documents/:id/ocr
// Trigger OCR processing on an uploaded document.
// ──────────────────────────────────────────────────────────────────────────────
router.post('/:id/ocr', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;

    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const ocrResult = await processDocumentOcr(document.rawFilePath, document.mimeType);

    await saveOcrResults(
      id,
      ocrResult.fields,
      ocrResult.documentType,
      ocrResult.rawResponse
    );

    const updated = await prisma.document.findUnique({
      where: { id },
      include: { extractedData: true, group: true },
    });

    res.json({
      message: 'OCR processing complete',
      document: formatDocument(updated),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OCR processing failed';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/documents/:id/review
// Save user-reviewed/edited data and mark document as SAVED.
// ──────────────────────────────────────────────────────────────────────────────
router.put('/:id/review', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;
    const payload = req.body as ReviewPayload;

    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    await saveReviewedData(id, payload);

    const updated = await prisma.document.findUnique({
      where: { id },
      include: { extractedData: true, group: true },
    });

    res.json({
      message: 'Document reviewed and saved',
      document: formatDocument(updated),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Review save failed';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/documents
// List all documents with optional filters.
// Query params: type, status, vehicleNo, ungrouped, page, limit
// ──────────────────────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, status, vehicleNo, ungrouped, page = '1', limit = '20' } = req.query as Record<string, string>;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (vehicleNo) {
      where.extractedData = {
        vehicleNo: { contains: vehicleNo.toUpperCase() },
      };
    }
    if (ungrouped === 'true') {
      where.groupId = null;
    }

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        include: { extractedData: true, group: true },
        orderBy: { uploadedAt: 'desc' },
        skip,
        take,
      }),
      prisma.document.count({ where }),
    ]);

    res.json({
      documents: documents.map(formatDocument),
      pagination: { total, page: parseInt(page, 10), limit: take, pages: Math.ceil(total / take) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch documents';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/documents/:id
// Delete a document and its associated data.
// ──────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;

    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // BundleItem has no onDelete cascade, so remove bundle membership first
    await prisma.bundleItem.deleteMany({ where: { documentId: id } });

    // Delete the document — cascades to ExtractedData and DocumentLinkRecord
    await prisma.document.delete({ where: { id } });

    res.status(204).send();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete document';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/documents/:id
// Get a single document by ID.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;

    const document = await prisma.document.findUnique({
      where: { id },
      include: { extractedData: true, group: { include: { documents: { include: { extractedData: true } } } } },
    });

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.json({ document: formatDocument(document) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch document';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/documents/groups/:groupId
// Get all documents in a linked group.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/groups/:groupId', async (req: Request, res: Response): Promise<void> => {
  try {
    const groupId = req.params['groupId'] as string;

    const group = await prisma.documentGroup.findUnique({
      where: { id: groupId },
      include: { documents: { include: { extractedData: true } } },
    });

    if (!group) {
      res.status(404).json({ error: 'Document group not found' });
      return;
    }

    res.json({
      group: {
        id: group.id,
        vehicleNo: group.vehicleNo,
        date: group.date,
        createdAt: group.createdAt,
        documents: group.documents.map((d) => formatDocument(d as PrismaDocumentWithRelations)),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch group';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/documents/groups
// List all document groups.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/groups', async (_req: Request, res: Response): Promise<void> => {
  try {
    const groups = await prisma.documentGroup.findMany({
      include: { documents: { select: { id: true, type: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ groups });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch groups';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

type PrismaDocumentWithRelations = Awaited<ReturnType<typeof prisma.document.findUnique>> & {
  extractedData?: {
    id: string;
    lrNo: string | null;
    invoiceNo: string | null;
    vehicleNo: string | null;
    quantity: string | null;
    date: string | null;
    partyNames: string | null;
    tollAmount: string | null;
    weightInfo: string | null;
    rawOcrResponse: string;
    confidence: number | null;
    ocrProcessedAt: Date;
    userReviewed: boolean;
    reviewedAt: Date | null;
    userEdits: string | null;
    createdAt: Date;
    updatedAt: Date;
    documentId: string;
  } | null;
  group?: unknown;
};

function formatDocument(doc: PrismaDocumentWithRelations | null) {
  if (!doc) return null;

  const result: Record<string, unknown> = {
    id: doc.id,
    type: doc.type,
    status: doc.status,
    originalFilename: doc.originalFilename,
    mimeType: doc.mimeType,
    uploadedAt: doc.uploadedAt,
    updatedAt: doc.updatedAt,
    groupId: doc.groupId,
    filePath: path.basename(doc.rawFilePath),
  };

  if (doc.extractedData) {
    const ed = doc.extractedData;
    result.extractedData = {
      id: ed.id,
      lrNo: ed.lrNo,
      invoiceNo: ed.invoiceNo,
      vehicleNo: ed.vehicleNo,
      quantity: ed.quantity,
      date: ed.date,
      partyNames: ed.partyNames ? (JSON.parse(ed.partyNames) as string[]) : null,
      tollAmount: ed.tollAmount,
      weightInfo: ed.weightInfo,
      confidence: ed.confidence,
      ocrProcessedAt: ed.ocrProcessedAt,
      userReviewed: ed.userReviewed,
      reviewedAt: ed.reviewedAt,
      userEdits: ed.userEdits ? (JSON.parse(ed.userEdits) as Record<string, unknown>) : null,
    };
  }

  if (doc.group) {
    result.group = doc.group;
  }

  return result;
}

export default router;
