import { PrismaClient } from '@prisma/client';
import type { DocumentType, ReviewPayload } from '../types/index.js';
import { autoLinkDocument } from './autoLinkService.js';

const prisma = new PrismaClient();

export { prisma };

/**
 * Auto-link a document to a DocumentGroup based on common fields.
 *
 * Matching strategy (in priority order):
 *  1. vehicleNo + date   — upserts the group (creates it if absent)
 *  2. lrNo               — joins an existing group that contains a document
 *                          with the same lrNo in its extracted data
 *  3. invoiceNo          — joins an existing group that contains a document
 *                          with the same invoiceNo in its extracted data
 *
 * Returns the groupId when a match is made, null otherwise.
 */
async function autoLinkDocumentToGroup(
  documentId: string,
  fields: {
    vehicleNo?: string | null;
    date?: string | null;
    lrNo?: string | null;
    invoiceNo?: string | null;
  },
): Promise<string | null> {
  const { vehicleNo, date, lrNo, invoiceNo } = fields;

  // ── Strategy 1: vehicleNo + date (create or find group) ──────────────────
  if (vehicleNo?.trim() && date?.trim()) {
    const normalizedVehicle = vehicleNo.trim().toUpperCase().replace(/\s+/g, '');
    const normalizedDate = date.trim();

    const group = await prisma.documentGroup.upsert({
      where: { vehicleNo_date: { vehicleNo: normalizedVehicle, date: normalizedDate } },
      update: {},
      create: { vehicleNo: normalizedVehicle, date: normalizedDate },
    });

    await prisma.document.update({
      where: { id: documentId },
      data: { groupId: group.id },
    });

    return group.id;
  }

  // ── Strategy 2: lrNo match in existing extracted data ─────────────────────
  if (lrNo?.trim()) {
    const normalizedLrNo = lrNo.trim().toUpperCase();
    const match = await prisma.extractedData.findFirst({
      where: {
        lrNo: normalizedLrNo,
        document: { groupId: { not: null }, id: { not: documentId } },
      },
      select: { document: { select: { groupId: true } } },
    });
    if (match?.document?.groupId) {
      await prisma.document.update({
        where: { id: documentId },
        data: { groupId: match.document.groupId },
      });
      return match.document.groupId;
    }
  }

  // ── Strategy 3: invoiceNo match in existing extracted data ────────────────
  if (invoiceNo?.trim()) {
    const normalizedInvoiceNo = invoiceNo.trim().toUpperCase();
    const match = await prisma.extractedData.findFirst({
      where: {
        invoiceNo: normalizedInvoiceNo,
        document: { groupId: { not: null }, id: { not: documentId } },
      },
      select: { document: { select: { groupId: true } } },
    });
    if (match?.document?.groupId) {
      await prisma.document.update({
        where: { id: documentId },
        data: { groupId: match.document.groupId },
      });
      return match.document.groupId;
    }
  }

  return null;
}

/**
 * Save OCR results to the ExtractedData table and update document status/type.
 */
export async function saveOcrResults(
  documentId: string,
  fields: {
    lrNo?: string;
    invoiceNo?: string;
    vehicleNo?: string;
    quantity?: string;
    date?: string;
    partyNames?: string[];
    tollAmount?: string;
    weightInfo?: string;
    confidence?: number;
  },
  documentType: DocumentType,
  rawOcrResponse: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.extractedData.upsert({
      where: { documentId },
      create: {
        documentId,
        lrNo: fields.lrNo ?? null,
        invoiceNo: fields.invoiceNo ?? null,
        vehicleNo: fields.vehicleNo ?? null,
        quantity: fields.quantity ?? null,
        date: fields.date ?? null,
        partyNames: fields.partyNames ? JSON.stringify(fields.partyNames) : null,
        tollAmount: fields.tollAmount ?? null,
        weightInfo: fields.weightInfo ?? null,
        rawOcrResponse,
        confidence: fields.confidence ?? null,
      },
      update: {
        lrNo: fields.lrNo ?? null,
        invoiceNo: fields.invoiceNo ?? null,
        vehicleNo: fields.vehicleNo ?? null,
        quantity: fields.quantity ?? null,
        date: fields.date ?? null,
        partyNames: fields.partyNames ? JSON.stringify(fields.partyNames) : null,
        tollAmount: fields.tollAmount ?? null,
        weightInfo: fields.weightInfo ?? null,
        rawOcrResponse,
        confidence: fields.confidence ?? null,
      },
    });

    await tx.document.update({
      where: { id: documentId },
      data: { type: documentType, status: 'PENDING_REVIEW' },
    });
  });

  // Auto-link to DocumentGroup using all common fields.
  // Strategy 1 (vehicleNo+date) is tried first inside autoLinkDocumentToGroup;
  // lrNo and invoiceNo are used as fallback when date is unavailable.
  if (fields.vehicleNo || fields.lrNo || fields.invoiceNo) {
    await autoLinkDocument(documentId);
    await autoLinkDocumentToGroup(documentId, {
      vehicleNo: fields.vehicleNo,
      date: fields.date,
      lrNo: fields.lrNo,
      invoiceNo: fields.invoiceNo,
    });
  }
}

/**
 * Save user-reviewed/edited data and mark document as REVIEWED.
 */
export async function saveReviewedData(documentId: string, payload: ReviewPayload): Promise<void> {
  const existing = await prisma.extractedData.findUnique({ where: { documentId } });
  if (!existing) {
    throw new Error(`No extracted data found for document ${documentId}`);
  }

  // Compute what fields the user changed compared to OCR output
  const userEdits: Record<string, unknown> = {};
  const fields: (keyof ReviewPayload)[] = [
    'lrNo', 'invoiceNo', 'vehicleNo', 'quantity', 'date',
    'partyNames', 'tollAmount', 'weightInfo',
  ];

  for (const field of fields) {
    const newVal = payload[field];
    const oldVal = field === 'partyNames'
      ? (existing.partyNames ? (JSON.parse(existing.partyNames) as string[]) : null)
      : (existing[field as keyof typeof existing] as string | null);

    const newSer = newVal !== undefined ? JSON.stringify(newVal) : null;
    const oldSer = oldVal !== null ? JSON.stringify(oldVal) : null;

    if (newSer !== oldSer && newVal !== undefined) {
      userEdits[field] = newVal;
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.extractedData.update({
      where: { documentId },
      data: {
        lrNo: payload.lrNo ?? existing.lrNo,
        invoiceNo: payload.invoiceNo ?? existing.invoiceNo,
        vehicleNo: payload.vehicleNo ?? existing.vehicleNo,
        quantity: payload.quantity ?? existing.quantity,
        date: payload.date ?? existing.date,
        partyNames: payload.partyNames
          ? JSON.stringify(payload.partyNames)
          : existing.partyNames,
        tollAmount: payload.tollAmount ?? existing.tollAmount,
        weightInfo: payload.weightInfo ?? existing.weightInfo,
        userReviewed: true,
        reviewedAt: new Date(),
        userEdits: Object.keys(userEdits).length > 0 ? JSON.stringify(userEdits) : existing.userEdits,
      },
    });

    const docType = payload.documentType ?? undefined;
    await tx.document.update({
      where: { id: documentId },
      data: {
        status: 'SAVED',
        ...(docType ? { type: docType } : {}),
      },
    });
  });

  // Re-link to Lr record and DocumentGroup when reviewed fields change.
  // Use || so lrNo/invoiceNo fallback is available when date is missing.
  const updatedExtracted = await prisma.extractedData.findUnique({ where: { documentId } });
  if (updatedExtracted?.vehicleNo || updatedExtracted?.lrNo || updatedExtracted?.invoiceNo) {
    await autoLinkDocument(documentId);
    await autoLinkDocumentToGroup(documentId, {
      vehicleNo: updatedExtracted.vehicleNo,
      date: updatedExtracted.date,
      lrNo: updatedExtracted.lrNo,
      invoiceNo: updatedExtracted.invoiceNo,
    });
  }
}
