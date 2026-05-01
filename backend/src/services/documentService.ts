import { PrismaClient } from '@prisma/client';
import type { DocumentType, ReviewPayload } from '../types/index.js';
import { autoLinkDocument, relinkPendingDocuments, normalizeVehicleNo } from './autoLinkService.js';

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
 * Auto-create an LR record from an uploaded LR-type document.
 *
 * Uses the first available company + branch as defaults (single-tenant).
 * Idempotent — skips silently when an LR with the same lrNo already exists
 * for that company, so calling this multiple times is safe.
 *
 * Returns true when a new LR record was created, false when skipped.
 */
async function autoCreateLrRecord(
  documentType: DocumentType | string,
  fields: {
    lrNo?: string | null;
    invoiceNo?: string | null;
    vehicleNo?: string | null;
    date?: string | null;
    partyNames?: string[] | string | null;
  },
): Promise<boolean> {
  if (documentType !== 'LR' || !fields.lrNo?.trim()) return false;

  const lrNo = fields.lrNo.trim().toUpperCase();

  // Look up the first company and its first branch (single-tenant default)
  const company = await prisma.company.findFirst({
    include: { branches: { take: 1, orderBy: { createdAt: 'asc' } } },
  });
  if (!company || company.branches.length === 0) return false;

  const companyId = company.id;
  const branchId = company.branches[0].id;

  // Idempotent: skip if an LR with the same lrNo already exists for this company
  const existing = await prisma.lr.findFirst({ where: { lrNo, companyId } });
  if (existing) return false;

  // Parse party names (OCR returns ["consignor", "consignee"]).
  // Array access beyond its length returns undefined in JS — no out-of-bounds error.
  let consignor: string | undefined;
  let consignee: string | undefined;
  if (fields.partyNames) {
    try {
      const names: unknown[] = Array.isArray(fields.partyNames)
        ? fields.partyNames
        : (JSON.parse(fields.partyNames as string) as unknown[]);
      if (typeof names[0] === 'string') consignor = (names[0] as string).trim() || undefined;
      if (typeof names[1] === 'string') consignee = (names[1] as string).trim() || undefined;
    } catch {
      // ignore malformed JSON
    }
  }

  // Assign next serialNo for this company
  const last = await prisma.lr.findFirst({
    where: { companyId },
    orderBy: { serialNo: 'desc' },
    select: { serialNo: true },
  });
  const serialNo = (last?.serialNo ?? 0) + 1;

  const lrDate = fields.date?.trim() || undefined;
  const vehicleNo = fields.vehicleNo?.trim()
    ? normalizeVehicleNo(fields.vehicleNo)
    : undefined;

  await prisma.lr.create({
    data: {
      lrNo,
      serialNo,
      companyId,
      branchId,
      source: 'INTERNAL',
      lrDate,
      date: lrDate,
      vehicleNo,
      invoiceNo: fields.invoiceNo?.trim() || undefined,
      consignor: consignor || undefined,
      consignee: consignee || undefined,
    },
  });

  return true;
}

/**
 * Sync LR records from all existing LR-type documents.
 *
 * Scans every LR-type document that has OCR-extracted data, auto-creates an
 * LR record for each one (idempotent — skips existing), then re-runs the
 * auto-link pipeline so all documents get linked to their LR records.
 *
 * Safe to call repeatedly; already-existing LR records are never duplicated.
 */
export async function syncLrRecordsFromDocuments(): Promise<{
  processed: number;
  created: number;
  linked: number;
}> {
  const docs = await prisma.document.findMany({
    where: { type: 'LR' },
    include: { extractedData: true },
  });

  let created = 0;
  for (const doc of docs) {
    if (!doc.extractedData?.lrNo) continue;
    const wasCreated = await autoCreateLrRecord('LR', {
      lrNo: doc.extractedData.lrNo,
      invoiceNo: doc.extractedData.invoiceNo,
      vehicleNo: doc.extractedData.vehicleNo,
      date: doc.extractedData.date,
      partyNames: doc.extractedData.partyNames,
    });
    if (wasCreated) created++;
  }

  // Re-run auto-link for documents that have no LR link yet
  const { linked } = await relinkPendingDocuments();

  return { processed: docs.length, created, linked };
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
    // Auto-create an LR record from OCR data before attempting to link,
    // so the link step can always find a matching LR row.
    await autoCreateLrRecord(documentType, {
      lrNo: fields.lrNo,
      invoiceNo: fields.invoiceNo,
      vehicleNo: fields.vehicleNo,
      date: fields.date,
      partyNames: fields.partyNames,
    });
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
  const updatedDoc = await prisma.document.findUnique({ where: { id: documentId }, select: { type: true } });
  if (updatedExtracted?.vehicleNo || updatedExtracted?.lrNo || updatedExtracted?.invoiceNo) {
    // Auto-create LR record from confirmed reviewed data before linking
    if (updatedDoc?.type === 'LR') {
      await autoCreateLrRecord('LR', {
        lrNo: updatedExtracted.lrNo,
        invoiceNo: updatedExtracted.invoiceNo,
        vehicleNo: updatedExtracted.vehicleNo,
        date: updatedExtracted.date,
        partyNames: updatedExtracted.partyNames,
      });
    }
    await autoLinkDocument(documentId);
    await autoLinkDocumentToGroup(documentId, {
      vehicleNo: updatedExtracted.vehicleNo,
      date: updatedExtracted.date,
      lrNo: updatedExtracted.lrNo,
      invoiceNo: updatedExtracted.invoiceNo,
    });
  }
}
