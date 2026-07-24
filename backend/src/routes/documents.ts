import { Router, type Request, type Response } from 'express';
import * as path from 'path';
import { upload } from '../middleware/upload.js';
import { processDocumentOcr } from '../services/ocrService.js';
import { getOcrMetrics, prisma, saveOcrResults, saveReviewedData } from '../services/documentService.js';
import type { DocumentType, ReviewPayload } from '../types/index.js';
import { LrDocumentCategory } from '@prisma/client';
import { getPdfPageCount, splitPdfToPageImages, MAX_PDF_PAGES } from '../services/pdfSplitService.js';

const VALID_DOCUMENT_TYPES: DocumentType[] = [
  'LR', 'INVOICE', 'TOLL', 'WEIGHMENT', 'WEIGHMENT_PARTY', 'WEIGHMENT_SITE',
  'EWAYBILL', 'RECEIVING', 'UNKNOWN',
];

const VALID_LR_DOCUMENT_CATEGORIES = new Set<LrDocumentCategory>([
  LrDocumentCategory.ADDITIONAL_ATTACHMENT_1,
  LrDocumentCategory.ADDITIONAL_ATTACHMENT_2,
]);

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/documents/upload
// Upload a document file. Creates one or more Document records.
//
// For single images or single-page PDFs: behaves as before and returns:
//   { message, document, documents: [document], pageCount: 1, isPdfMultiPage: false }
//
// For multi-page PDFs: splits each page into a JPEG, creates one Document per
// page plus a source Document for the original PDF, and returns:
//   { message, document, documents: [...pageDocuments], pageCount: N,
//     isPdfMultiPage: true, sourceDocumentId }
//
// Optional form-data fields:
//   type    – DocumentType applied to all created document(s)
//   groupId – link all created document(s) to an existing DocumentGroup
// ──────────────────────────────────────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const rawType = req.body['type'] as string | undefined;
    const groupId = req.body['groupId'] as string | undefined;
    const rawLrDocumentCategory = req.body['lrDocumentCategory'] as string | undefined;
    const lrDocumentCategory = rawLrDocumentCategory && VALID_LR_DOCUMENT_CATEGORIES.has(rawLrDocumentCategory as LrDocumentCategory)
      ? rawLrDocumentCategory as LrDocumentCategory
      : undefined;

    const docType: DocumentType =
      rawType && VALID_DOCUMENT_TYPES.includes(rawType as DocumentType)
        ? (rawType as DocumentType)
        : 'UNKNOWN';

    // If a group is specified, validate it exists
    if (groupId) {
      const group = await prisma.documentGroup.findUnique({ where: { id: groupId } });
      if (!group) {
        res.status(404).json({ error: 'Document group not found' });
        return;
      }
    }

    const isPdf = req.file.mimetype === 'application/pdf';

    // ── Multi-page PDF path ───────────────────────────────────────────────────
    if (isPdf) {
      let pageCount = 1;
      try {
        pageCount = await getPdfPageCount(req.file.path);
      } catch (countErr) {
        const msg = countErr instanceof Error ? countErr.message : String(countErr);
        res.status(400).json({ error: `Cannot process PDF: ${msg}` });
        return;
      }

      if (pageCount > MAX_PDF_PAGES) {
        res.status(400).json({
          error: `PDF has ${pageCount} pages which exceeds the limit of ${MAX_PDF_PAGES}. ` +
            'Split the PDF before uploading or contact your administrator.',
        });
        return;
      }

      if (pageCount > 1) {
        // ── Create source Document for the original PDF ───────────────────
        const sourceDoc = await prisma.document.create({
          data: {
            type: 'UNKNOWN',
            // SAVED means it won't appear in the "needs OCR" queue – it is a
            // container record for traceability only.
            status: 'SAVED',
            originalFilename: req.file.originalname,
            rawFilePath: req.file.path,
            mimeType: req.file.mimetype,
            ...(groupId ? { groupId } : {}),
          },
        });

        // ── Split pages and create one Document per page ──────────────────
        let pageFiles;
        try {
          pageFiles = await splitPdfToPageImages(req.file.path, UPLOAD_DIR);
        } catch (splitErr) {
          // Clean up source document on split failure
          await prisma.document.delete({ where: { id: sourceDoc.id } });
          const msg = splitErr instanceof Error ? splitErr.message : String(splitErr);
          res.status(500).json({ error: `PDF page extraction failed: ${msg}` });
          return;
        }

        const pageDocuments = await Promise.all(
          pageFiles.map((pf) =>
            prisma.document.create({
              data: {
                type: docType,
                status: docType !== 'UNKNOWN' ? 'PENDING_REVIEW' : 'PENDING_OCR',
                originalFilename: req.file!.originalname,
                rawFilePath: pf.filePath,
                mimeType: pf.mimeType,
                sourceDocumentId: sourceDoc.id,
                pageNumber: pf.pageNumber,
                ...(groupId ? { groupId } : {}),
                ...(lrDocumentCategory ? { lrDocumentCategory } : {}),
              },
            }),
          ),
        );

        const formatted = pageDocuments.map((d) => formatUploadedDocument(d));

        res.status(201).json({
          message: `PDF split into ${pageCount} pages. Each page has been queued for OCR.`,
          document: formatted[0],
          documents: formatted,
          pageCount,
          isPdfMultiPage: true,
          sourceDocumentId: sourceDoc.id,
        });
        return;
      }
    }

    // ── Single-file path (image or single-page PDF) ───────────────────────────
    const document = await prisma.document.create({
      data: {
        type: docType,
        status: docType !== 'UNKNOWN' ? 'PENDING_REVIEW' : 'PENDING_OCR',
        originalFilename: req.file.originalname,
        rawFilePath: req.file.path,
        mimeType: req.file.mimetype,
        ...(groupId ? { groupId } : {}),
        ...(lrDocumentCategory ? { lrDocumentCategory } : {}),
      },
    });

    const formatted = formatUploadedDocument(document);

    res.status(201).json({
      message: 'File uploaded successfully',
      document: formatted,
      documents: [formatted],
      pageCount: 1,
      isPdfMultiPage: false,
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
      JSON.stringify({
        providerResponse: ocrResult.rawResponse,
        metadata: ocrResult.metadata,
      }),
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
// GET /api/documents/groups
// List all document groups.
// ──────────────────────────────────────────────────────────────────────────────
const parsePositiveInt = (value: unknown, defaultVal: number, max?: number): number => {
  const n = parseInt(String(value ?? defaultVal), 10);
  const clamped = Math.max(1, isNaN(n) ? defaultVal : n);
  return max !== undefined ? Math.min(max, clamped) : clamped;
};

router.get('/groups', async (req: Request, res: Response): Promise<void> => {
  try {
    const page  = parsePositiveInt(req.query['page'],  1);
    const limit = parsePositiveInt(req.query['limit'], 25, 100);
    const skip  = (page - 1) * limit;

    const [total, groups] = await Promise.all([
      prisma.documentGroup.count(),
      prisma.documentGroup.findMany({
        include: {
          documents: {
            select: {
              id: true,
              type: true,
              status: true,
              originalFilename: true,
              mimeType: true,
              rawFilePath: true,
              uploadedAt: true,
              updatedAt: true,
              groupId: true,
              lrDocumentCategory: true,
              sourceDocumentId: true,
              pageNumber: true,
              extractedData: { select: { lrNo: true, invoiceNo: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    res.json({
      groups: groups.map((group) => ({
        ...group,
        documents: group.documents.map((doc) => {
          const { rawFilePath, ...rest } = doc;
          return {
            ...rest,
            filePath: path.basename(rawFilePath),
          };
        }),
      })),
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch groups';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/documents/ocr-metrics
// OCR quality metrics for continuous improvement.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/ocr-metrics', async (_req: Request, res: Response): Promise<void> => {
  try {
    const metrics = await getOcrMetrics();
    res.json({ metrics });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch OCR metrics';
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
    billToParty: string | null;
    shipToParty: string | null;
    principalCompany: string | null;
    branchName: string | null;
    loadingSlipNo: string | null;
    companyInvoiceNo: string | null;
    companyInvoiceDate: string | null;
    companyEwayBillNo: string | null;
    ewayBillDate: string | null;
    approvedDestination: string | null;
    deliveryDestination: string | null;
    orderNo: string | null;
    productName: string | null;
    transporterName: string | null;
    orderType: string | null;
    tptCode: string | null;
    quantityInMt: number | null;
    quantityInBags: number | null;
    driverName: string | null;
    driverCellNo: string | null;
    workingCenter: string | null;
    depotPlantCode: string | null;
    source: string | null;
    createdAt: Date;
    updatedAt: Date;
    documentId: string;
  } | null;
  group?: unknown;
};

/** Lightweight shape returned directly by the upload endpoint (no OCR data yet). */
function formatUploadedDocument(doc: {
  id: string;
  type: string;
  status: string;
  originalFilename: string;
  mimeType: string;
  uploadedAt: Date;
  groupId: string | null;
    sourceDocumentId?: string | null;
    pageNumber?: number | null;
    lrDocumentCategory?: string | null;
}) {
  return {
    id: doc.id,
    type: doc.type,
    status: doc.status,
    originalFilename: doc.originalFilename,
    mimeType: doc.mimeType,
    uploadedAt: doc.uploadedAt,
    groupId: doc.groupId,
    sourceDocumentId: doc.sourceDocumentId ?? null,
    pageNumber: doc.pageNumber ?? null,
    lrDocumentCategory: doc.lrDocumentCategory ?? null,
  };
}

function parseStoredOcrResponse(rawOcrResponse: string, fallbackConfidence: number | null) {
  try {
    const parsed = JSON.parse(rawOcrResponse) as {
      providerResponse?: string;
      metadata?: {
        classificationConfidence?: number;
        ocrConfidence?: number;
        appliedRotation?: number;
        imageQuality?: 'HIGH' | 'MEDIUM' | 'LOW';
        processingNotes?: string[];
        fieldConfidence?: Record<string, number>;
        validationIssues?: string[];
      };
    };

    return {
      rawOcrResponse: parsed.providerResponse ?? rawOcrResponse,
      classificationConfidence: parsed.metadata?.classificationConfidence ?? fallbackConfidence,
      ocrConfidence: parsed.metadata?.ocrConfidence ?? fallbackConfidence,
      appliedRotation: parsed.metadata?.appliedRotation ?? 0,
      imageQuality: parsed.metadata?.imageQuality ?? null,
      processingNotes: parsed.metadata?.processingNotes ?? [],
      fieldConfidence: parsed.metadata?.fieldConfidence ?? {},
      validationIssues: parsed.metadata?.validationIssues ?? [],
    };
  } catch {
    return {
      rawOcrResponse,
      classificationConfidence: fallbackConfidence,
      ocrConfidence: fallbackConfidence,
      appliedRotation: 0,
      imageQuality: null,
      processingNotes: [],
      fieldConfidence: {},
      validationIssues: [],
    };
  }
}

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
    sourceDocumentId: (doc as Record<string, unknown>).sourceDocumentId ?? null,
    pageNumber: (doc as Record<string, unknown>).pageNumber ?? null,
    lrDocumentCategory: (doc as Record<string, unknown>).lrDocumentCategory ?? null,
  };

  if (doc.extractedData) {
    const ed = doc.extractedData;
    const ocrMetadata = parseStoredOcrResponse(ed.rawOcrResponse, ed.confidence);
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
      classificationConfidence: ocrMetadata.classificationConfidence,
      ocrConfidence: ocrMetadata.ocrConfidence,
      appliedRotation: ocrMetadata.appliedRotation,
      imageQuality: ocrMetadata.imageQuality,
      processingNotes: ocrMetadata.processingNotes,
      fieldConfidence: ocrMetadata.fieldConfidence,
      validationIssues: ocrMetadata.validationIssues,
      ocrProcessedAt: ed.ocrProcessedAt,
      userReviewed: ed.userReviewed,
      reviewedAt: ed.reviewedAt,
      userEdits: ed.userEdits ? (JSON.parse(ed.userEdits) as Record<string, unknown>) : null,
      billToParty: ed.billToParty,
      shipToParty: ed.shipToParty,
      principalCompany: ed.principalCompany,
      branchName: ed.branchName,
      loadingSlipNo: ed.loadingSlipNo,
      companyInvoiceNo: ed.companyInvoiceNo,
      companyInvoiceDate: ed.companyInvoiceDate,
      companyEwayBillNo: ed.companyEwayBillNo,
      ewayBillDate: ed.ewayBillDate,
      approvedDestination: ed.approvedDestination,
      deliveryDestination: ed.deliveryDestination,
      orderNo: ed.orderNo,
      productName: ed.productName,
      transporterName: ed.transporterName,
      orderType: ed.orderType,
      tptCode: ed.tptCode,
      quantityInMt: ed.quantityInMt,
      quantityInBags: ed.quantityInBags,
      driverName: ed.driverName,
      driverCellNo: ed.driverCellNo,
      workingCenter: ed.workingCenter,
      depotPlantCode: ed.depotPlantCode,
      source: ed.source,
    };
  }

  if (doc.group) {
    result.group = doc.group;
  }

  return result;
}

export default router;
