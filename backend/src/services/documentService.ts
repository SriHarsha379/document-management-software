import { PrismaClient } from '@prisma/client';
import type { DocumentType, ReviewPayload } from '../types/index.js';
import { autoLinkDocument, relinkPendingDocuments, normalizeVehicleNo, backfillLrFromLinkedInvoice, daysBetween } from './autoLinkService.js';
import { getTrackedReviewFields, getOcrQualityMetrics, learnFromDocumentReview, shouldAutoAccept } from './ocrLearningService.js';

const prisma = new PrismaClient();

export { prisma };

const LOCATION_SUBSTRING_MIN_LENGTH = 4;
const LOCATION_EXACT_MATCH_SCORE = 1;
const LOCATION_CONTAINS_TARGET_SCORE = 0.85;
const LOCATION_CONTAINED_BY_TARGET_SCORE = 0.8;
const LOCATION_WORDS_MATCH_SCORE = 0.75;
const LOCATION_MATCH_CONFIDENCE_THRESHOLD = 0.8;
const DEFAULT_AUTO_CREATED_COMPANY_NAME = 'Default Company';
const DEFAULT_AUTO_CREATED_BRANCH_NAME = 'Head Office';

function nonEmptyTrimmed(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getAutoCreatedCompanyName(fields: {
  principalCompany?: string | null;
  billToParty?: string | null;
  shipToParty?: string | null;
}): string {
  return (
    nonEmptyTrimmed(fields.principalCompany) ||
    nonEmptyTrimmed(fields.billToParty) ||
    nonEmptyTrimmed(fields.shipToParty) ||
    DEFAULT_AUTO_CREATED_COMPANY_NAME
  );
}

function mapExtractedRecordToLearnedFields(
  extracted: {
    lrNo: string | null;
    invoiceNo: string | null;
    vehicleNo: string | null;
    quantity: string | null;
    date: string | null;
    partyNames: string | null;
    tollAmount: string | null;
    weightInfo: string | null;
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
  },
  documentType: DocumentType,
) {
  let partyNames: string[] | undefined;
  if (extracted.partyNames) {
    try {
      partyNames = JSON.parse(extracted.partyNames) as string[];
    } catch {
      partyNames = undefined;
    }
  }

  return {
    lrNo: extracted.lrNo ?? undefined,
    invoiceNo: extracted.invoiceNo ?? undefined,
    vehicleNo: extracted.vehicleNo ?? undefined,
    quantity: extracted.quantity ?? undefined,
    date: extracted.date ?? undefined,
    partyNames,
    tollAmount: extracted.tollAmount ?? undefined,
    weightInfo: extracted.weightInfo ?? undefined,
    billToParty: extracted.billToParty ?? undefined,
    shipToParty: extracted.shipToParty ?? undefined,
    principalCompany: extracted.principalCompany ?? undefined,
    branchName: extracted.branchName ?? undefined,
    loadingSlipNo: extracted.loadingSlipNo ?? undefined,
    companyInvoiceNo: extracted.companyInvoiceNo ?? undefined,
    companyInvoiceDate: extracted.companyInvoiceDate ?? undefined,
    companyEwayBillNo: extracted.companyEwayBillNo ?? undefined,
    ewayBillDate: extracted.ewayBillDate ?? undefined,
    approvedDestination: extracted.approvedDestination ?? undefined,
    deliveryDestination: extracted.deliveryDestination ?? undefined,
    orderNo: extracted.orderNo ?? undefined,
    productName: extracted.productName ?? undefined,
    transporterName: extracted.transporterName ?? undefined,
    orderType: extracted.orderType ?? undefined,
    tptCode: extracted.tptCode ?? undefined,
    quantityInMt: extracted.quantityInMt ?? undefined,
    quantityInBags: extracted.quantityInBags ?? undefined,
    driverName: extracted.driverName ?? undefined,
    driverCellNo: extracted.driverCellNo ?? undefined,
    workingCenter: extracted.workingCenter ?? undefined,
    depotPlantCode: extracted.depotPlantCode ?? undefined,
    source: extracted.source ?? undefined,
    documentType,
  };
}

/**
 * Auto-link a document to a DocumentGroup based on common fields.
 *
 * Matching strategy (in priority order):
 *  1. vehicleNo + date   — fuzzy match: if an existing group for the same
 *                          vehicleNo has a date within 3 days of the document's
 *                          date, the document joins that group (handles
 *                          late-arriving docs like site weighment slips and
 *                          acknowledgements that arrive 1-3 days after trip
 *                          start).  If no nearby group exists, a new group is
 *                          created with the document's exact date.
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

  // ── Strategy 1: vehicleNo + date (fuzzy match within 3 days, else create) ──
  //
  // Business rule: a lorry trip typically starts on the day the LR and party
  // weighment slip are generated.  The driver may take up to ~3 days to deliver
  // the goods and return; late-arriving documents (site weighment slip,
  // acknowledgement) therefore carry dates 1–3 days after the trip start date.
  // Rather than creating a separate DocumentGroup for those later documents,
  // we link them into the existing group for the same vehicle whose date is
  // closest within a 3-day window.
  if (vehicleNo?.trim() && date?.trim()) {
    const normalizedVehicle = vehicleNo.trim().toUpperCase().replace(/\s+/g, '');
    const normalizedDate = date.trim();

    // Look for an existing group for the same vehicle within the trip tolerance.
    //
    // The window is intentionally bidirectional (absolute diff): a party
    // weighment tare reading can be taken the day *before* the trip start, so
    // a doc dated 1 day prior to an existing group should still join it.
    // 3 days = the allowed ±3 day matching window across Invoice/LR/Weighment
    // documents for the same vehicle.
    const TRIP_TOLERANCE_DAYS = 3;
    const candidateGroups = await prisma.documentGroup.findMany({
      where: { vehicleNo: normalizedVehicle },
    });

    const nearbyGroup =
      candidateGroups
        .map((g) => ({ g, diff: daysBetween(g.date, normalizedDate) }))
        .filter(({ diff }) => diff !== null && (diff as number) <= TRIP_TOLERANCE_DAYS)
        .sort((a, b) => (a.diff as number) - (b.diff as number))[0]?.g ?? null;

    const group =
      nearbyGroup ??
      (await prisma.documentGroup.upsert({
        where: { vehicleNo_date: { vehicleNo: normalizedVehicle, date: normalizedDate } },
        update: {},
        create: { vehicleNo: normalizedVehicle, date: normalizedDate },
      }));

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
 * Branch resolution: reuses an existing branch if a name match is found;
 * otherwise auto-creates a new Branch record for the company using the OCR
 * branchName value. LR creation is never skipped due to a missing branch.
 *
 * Source: used directly from OCR output — no validation against
 * user_source_access or existing LR records, and no INTERNAL fallback.
 *
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
    billToParty?: string | null;
    shipToParty?: string | null;
    principalCompany?: string | null;
    loadingSlipNo?: string | null;
    companyInvoiceNo?: string | null;
    companyInvoiceDate?: string | null;
    companyEwayBillNo?: string | null;
    ewayBillDate?: string | null;
    approvedDestination?: string | null;
    deliveryDestination?: string | null;
    orderNo?: string | null;
    productName?: string | null;
    transporterName?: string | null;
    orderType?: string | null;
    tptCode?: string | null;
    quantityInMt?: number | null;
    quantityInBags?: number | null;
    branchName?: string | null;
    driverName?: string | null;
    driverCellNo?: string | null;
    workingCenter?: string | null;
    depotPlantCode?: string | null;
    source?: string | null;
    sealNo?: string | null;
    outTime?: string | null;
  },
): Promise<boolean> {
  if (documentType !== 'LR' || !fields.lrNo?.trim()) return false;

  const lrNo = fields.lrNo.trim().toUpperCase();

  // Look up the company (single-tenant default)
  let company = await prisma.company.findFirst();
  if (!company) {
    const companyName = getAutoCreatedCompanyName(fields);
    console.info(
      `[autoCreateLrRecord] No company found in the database. Auto-creating company "${companyName}".`,
    );
    company = await prisma.company.create({
      data: { name: companyName },
    });
  }

  const companyId = company.id;

  // ── Branch: reuse existing match or auto-create ───────────────────────────
  let branchId: string;
  if (fields.branchName?.trim()) {
    const branchNameRaw = fields.branchName.trim();

    // Try to find an existing branch with a case-insensitive name match
    const existingBranch = await prisma.branch.findFirst({
      where: {
        companyId,
        name: { equals: branchNameRaw},
      },
      select: { id: true },
    });

    if (existingBranch) {
      branchId = existingBranch.id;
    } else {
      // Auto-create a new branch using the OCR branchName value
      console.info(
        `[autoCreateLrRecord] Branch "${branchNameRaw}" not found for companyId="${companyId}". ` +
        'Auto-creating new branch record.',
      );
      const newBranch = await prisma.branch.create({
        data: { name: branchNameRaw, companyId },
        select: { id: true },
      });
      branchId = newBranch.id;
    }
  } else {
    // No branchName extracted — fall back to the first branch for this company
    let fallbackBranch = await prisma.branch.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!fallbackBranch) {
      console.info(
        '[autoCreateLrRecord] No branch found and no branchName extracted. ' +
        `Auto-creating fallback branch "${DEFAULT_AUTO_CREATED_BRANCH_NAME}" for companyId="${companyId}".`,
      );
      fallbackBranch = await prisma.branch.create({
        data: {
          companyId,
          name: DEFAULT_AUTO_CREATED_BRANCH_NAME,
        },
        select: { id: true },
      });
    }
    branchId = fallbackBranch.id;
  }

  // ── Source: use OCR value directly, no validation or fallback ────────────

  const source = fields.source?.trim() || undefined;

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
      source,
      lrDate,
      date: lrDate,
      vehicleNo,
      invoiceNo: fields.invoiceNo?.trim() || undefined,
      consignor: consignor || undefined,
      consignee: consignee || undefined,
      billToParty: fields.billToParty?.trim() || undefined,
      shipToParty: fields.shipToParty?.trim() || undefined,
      principalCompany: fields.principalCompany?.trim() || undefined,
      loadingSlipNo: fields.loadingSlipNo?.trim() || undefined,
      companyInvoiceNo: fields.companyInvoiceNo?.trim() || undefined,
      companyInvoiceDate: fields.companyInvoiceDate?.trim() || undefined,
      companyEwayBillNo: fields.companyEwayBillNo?.trim() || undefined,
      ewayBillDate: fields.ewayBillDate?.trim() || undefined,
      approvedDestination: fields.approvedDestination?.trim() || undefined,
      deliveryDestination: fields.deliveryDestination?.trim() || undefined,
      orderNo: fields.orderNo?.trim() || undefined,
      productName: fields.productName?.trim() || undefined,
      transporterName: fields.transporterName?.trim() || undefined,
      orderType: fields.orderType?.trim() || undefined,
      tptCode: fields.tptCode?.trim() || undefined,
      quantityInMt: fields.quantityInMt ?? undefined,
      quantityInBags: fields.quantityInBags ?? undefined,
      driverName: fields.driverName?.trim() || undefined,
      driverCellNo: fields.driverCellNo?.trim() || undefined,
      workingCenter: fields.workingCenter?.trim() || undefined,
      depotPlantCode: fields.depotPlantCode?.trim() || undefined,
      sealNo: fields.sealNo?.trim() || undefined,
      outTime: fields.outTime?.trim() || undefined,
    },
  });

  return true;
}

function normalizeLocationToken(value: string): string {
  return value
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLocationCandidates(...values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    const normalized = normalizeLocationToken(value);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  };

  for (const value of values) {
    if (!value?.trim()) continue;
    push(value);
    for (const segment of value.split(/[,\n;/|]+/g)) push(segment);
  }

  return out;
}

function getLocationMatchScore(candidate: string, target: string): number {
  if (!candidate || !target) return 0;
  if (candidate === target) return LOCATION_EXACT_MATCH_SCORE;
  if (target.length >= LOCATION_SUBSTRING_MIN_LENGTH && candidate.includes(target)) return LOCATION_CONTAINS_TARGET_SCORE;
  if (candidate.length >= LOCATION_SUBSTRING_MIN_LENGTH && target.includes(candidate)) return LOCATION_CONTAINED_BY_TARGET_SCORE;

  const targetWords = target.split(' ').filter(Boolean);
  if (
    targetWords.length > 1 &&
    targetWords.every((word) => candidate.includes(word))
  ) {
    return LOCATION_WORDS_MATCH_SCORE;
  }
  return 0;
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
  backfilled: number;
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
      billToParty: doc.extractedData.billToParty,
      shipToParty: doc.extractedData.shipToParty,
      principalCompany: doc.extractedData.principalCompany,
      loadingSlipNo: doc.extractedData.loadingSlipNo,
      companyInvoiceNo: doc.extractedData.companyInvoiceNo,
      companyInvoiceDate: doc.extractedData.companyInvoiceDate,
      companyEwayBillNo: doc.extractedData.companyEwayBillNo,
      ewayBillDate: doc.extractedData.ewayBillDate,
      approvedDestination: doc.extractedData.approvedDestination,
      deliveryDestination: doc.extractedData.deliveryDestination,
      orderNo: doc.extractedData.orderNo,
      productName: doc.extractedData.productName,
      transporterName: doc.extractedData.transporterName,
      orderType: doc.extractedData.orderType,
      tptCode: doc.extractedData.tptCode,
      quantityInMt: doc.extractedData.quantityInMt,
      quantityInBags: doc.extractedData.quantityInBags,
      driverName: doc.extractedData.driverName,
      driverCellNo: doc.extractedData.driverCellNo,
      branchName: doc.extractedData.branchName,
      workingCenter: doc.extractedData.workingCenter,
      depotPlantCode: doc.extractedData.depotPlantCode,
      source: doc.extractedData.source,
    });
    if (wasCreated) created++;
  }

  // Re-run auto-link for documents that have no LR link yet
  const { linked } = await relinkPendingDocuments();

  // Back-fill invoice fields on Lr records from already-linked INVOICE documents.
  // This covers invoices that were uploaded before the back-fill logic existed,
  // so that INV. NO and INV. DATE appear in the dashboard for historical records.
  const linkedInvoices = await prisma.document.findMany({
    where: {
      type: 'INVOICE',
      extractedData: { isNot: null },
      documentLinks: { some: {} },
    },
    select: {
      documentLinks: { select: { lrId: true }, take: 1 },
      extractedData: {
        select: {
          invoiceNo: true,
          companyInvoiceNo: true,
          companyInvoiceDate: true,
          companyEwayBillNo: true,
          date: true,
          principalCompany: true,
        },
      },
    },
  });

  let backfilled = 0;
  for (const inv of linkedInvoices) {
    const lrId = inv.documentLinks[0]?.lrId;
    if (!lrId || !inv.extractedData) continue;
    await backfillLrFromLinkedInvoice(lrId, {
      invoiceNo: inv.extractedData.invoiceNo,
      companyInvoiceNo: inv.extractedData.companyInvoiceNo,
      companyInvoiceDate: inv.extractedData.companyInvoiceDate,
      companyEwayBillNo: inv.extractedData.companyEwayBillNo,
      date: inv.extractedData.date,
      principalCompany: inv.extractedData.principalCompany,
    });
    backfilled++;
  }

  return { processed: docs.length, created, linked, backfilled };
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
    billToParty?: string;
    shipToParty?: string;
    principalCompany?: string;
    branchName?: string;
    loadingSlipNo?: string;
    companyInvoiceNo?: string;
    companyInvoiceDate?: string;
    companyEwayBillNo?: string;
    ewayBillDate?: string;
    approvedDestination?: string;
    deliveryDestination?: string;
    orderNo?: string;
    productName?: string;
    transporterName?: string;
    orderType?: string;
    tptCode?: string;
    quantityInMt?: number;
    quantityInBags?: number;
    driverName?: string;
    driverCellNo?: string;
    workingCenter?: string;
    depotPlantCode?: string;
    source?: string;
    sealNo?: string;
    documentTime?: string;
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
        billToParty: fields.billToParty ?? null,
        shipToParty: fields.shipToParty ?? null,
        principalCompany: fields.principalCompany ?? null,
        branchName: fields.branchName ?? null,
        loadingSlipNo: fields.loadingSlipNo ?? null,
        companyInvoiceNo: fields.companyInvoiceNo ?? null,
        companyInvoiceDate: fields.companyInvoiceDate ?? null,
        companyEwayBillNo: fields.companyEwayBillNo ?? null,
        ewayBillDate: fields.ewayBillDate ?? null,
        approvedDestination: fields.approvedDestination ?? null,
        deliveryDestination: fields.deliveryDestination ?? null,
        orderNo: fields.orderNo ?? null,
        productName: fields.productName ?? null,
        transporterName: fields.transporterName ?? null,
        orderType: fields.orderType ?? null,
        tptCode: fields.tptCode ?? null,
        quantityInMt: fields.quantityInMt ?? null,
        quantityInBags: fields.quantityInBags ?? null,
        driverName: fields.driverName ?? null,
        driverCellNo: fields.driverCellNo ?? null,
        workingCenter: fields.workingCenter ?? null,
        depotPlantCode: fields.depotPlantCode ?? null,
        source: fields.source ?? null,
        sealNo: fields.sealNo ?? null,
        documentTime: fields.documentTime ?? null,
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
        billToParty: fields.billToParty ?? null,
        shipToParty: fields.shipToParty ?? null,
        principalCompany: fields.principalCompany ?? null,
        branchName: fields.branchName ?? null,
        loadingSlipNo: fields.loadingSlipNo ?? null,
        companyInvoiceNo: fields.companyInvoiceNo ?? null,
        companyInvoiceDate: fields.companyInvoiceDate ?? null,
        companyEwayBillNo: fields.companyEwayBillNo ?? null,
        ewayBillDate: fields.ewayBillDate ?? null,
        approvedDestination: fields.approvedDestination ?? null,
        deliveryDestination: fields.deliveryDestination ?? null,
        orderNo: fields.orderNo ?? null,
        productName: fields.productName ?? null,
        transporterName: fields.transporterName ?? null,
        orderType: fields.orderType ?? null,
        tptCode: fields.tptCode ?? null,
        quantityInMt: fields.quantityInMt ?? null,
        quantityInBags: fields.quantityInBags ?? null,
        driverName: fields.driverName ?? null,
        driverCellNo: fields.driverCellNo ?? null,
        workingCenter: fields.workingCenter ?? null,
        depotPlantCode: fields.depotPlantCode ?? null,
        source: fields.source ?? null,
        sealNo: fields.sealNo ?? null,
        documentTime: fields.documentTime ?? null,
      },
    });

    const autoAccepted = shouldAutoAccept(fields, documentType);

    await tx.document.update({
      where: { id: documentId },
      data: { type: documentType, status: autoAccepted ? 'SAVED' : 'PENDING_REVIEW' },
    });
  });

  const autoAcceptedDoc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { status: true },
  });
  if (autoAcceptedDoc?.status === 'SAVED') {
    await learnFromDocumentReview(
      documentId,
      documentType,
      {
        ...fields,
        documentType,
      },
      []
    );
  }

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
      billToParty: fields.billToParty,
      shipToParty: fields.shipToParty,
      principalCompany: fields.principalCompany,
      loadingSlipNo: fields.loadingSlipNo,
      companyInvoiceNo: fields.companyInvoiceNo,
      companyInvoiceDate: fields.companyInvoiceDate,
      companyEwayBillNo: fields.companyEwayBillNo,
      ewayBillDate: fields.ewayBillDate,
      approvedDestination: fields.approvedDestination,
      deliveryDestination: fields.deliveryDestination,
      orderNo: fields.orderNo,
      productName: fields.productName,
      transporterName: fields.transporterName,
      orderType: fields.orderType,
      tptCode: fields.tptCode,
      quantityInMt: fields.quantityInMt,
      quantityInBags: fields.quantityInBags,
      driverName: fields.driverName,
      driverCellNo: fields.driverCellNo,
      branchName: fields.branchName,
      workingCenter: fields.workingCenter,
      depotPlantCode: fields.depotPlantCode,
      source: fields.source,
      sealNo: fields.sealNo,
      outTime: fields.documentTime,
    });
    const linkResult = await autoLinkDocument(documentId);
    // When an invoice arrives after the LR (e.g. from a remote office), back-fill
    // the Lr row's invoice fields so the dashboard columns show the correct values.
    if (linkResult.linked && linkResult.lrId && documentType === 'INVOICE') {
      await backfillLrFromLinkedInvoice(linkResult.lrId, {
        invoiceNo: fields.invoiceNo,
        companyInvoiceNo: fields.companyInvoiceNo,
        companyInvoiceDate: fields.companyInvoiceDate,
        companyEwayBillNo: fields.companyEwayBillNo,
        date: fields.date,
      });
    }
    await autoLinkDocumentToGroup(documentId, {
      vehicleNo: fields.vehicleNo,
      date: fields.date,
      lrNo: fields.lrNo,
      invoiceNo: fields.invoiceNo,
    });
  }
}

/**
 * When OCR finds MORE THAN ONE toll swipe or weighment slip on a single
 * source image (see `ExtractedFields.additionalTollEntries` /
 * `additionalWeighments`), the primary document/ExtractedData row can only
 * describe the first one. This creates one sibling Document + ExtractedData
 * row per additional entry so each becomes independently reviewable,
 * linkable to an Lr, and included in reconciliation — instead of being
 * silently dropped, which was the previous behaviour.
 *
 * Siblings share the same underlying file (rawFilePath/pageNumber) as the
 * primary document; they are distinguished only by their extracted fields.
 */
export async function createSiblingDocumentsForAdditionalEntries(
  primaryDocumentId: string,
  fields: {
    vehicleNo?: string;
    date?: string;
    additionalTollEntries?: Array<{ tollAmount?: string; documentTime?: string; vehicleNo?: string; date?: string }>;
    additionalWeighments?: Array<{ vehicleNo?: string; date?: string; weightInfo?: string; sealNo?: string; documentTime?: string; documentType?: DocumentType }>;
  },
  rawOcrResponse: string,
): Promise<string[]> {
  const additionalTollEntries = fields.additionalTollEntries ?? [];
  const additionalWeighments = fields.additionalWeighments ?? [];
  if (additionalTollEntries.length === 0 && additionalWeighments.length === 0) {
    return [];
  }

  const primary = await prisma.document.findUnique({ where: { id: primaryDocumentId } });
  if (!primary) return [];

  const createdIds: string[] = [];

  const finishSibling = async (
    documentId: string,
    entryVehicleNo?: string,
    entryDate?: string,
  ): Promise<void> => {
    const vehicleNo = entryVehicleNo ?? fields.vehicleNo;
    const date = entryDate ?? fields.date;
    if (!vehicleNo) return; // nothing to link/group by
    await autoLinkDocument(documentId);
    await autoLinkDocumentToGroup(documentId, { vehicleNo, date });
  };

  for (const entry of additionalTollEntries) {
    const sibling = await prisma.document.create({
      data: {
        type: 'TOLL',
        status: 'PENDING_REVIEW',
        originalFilename: primary.originalFilename,
        rawFilePath: primary.rawFilePath,
        mimeType: primary.mimeType,
        groupId: primary.groupId,
        sourceDocumentId: primary.sourceDocumentId ?? primary.id,
        pageNumber: primary.pageNumber,
      },
    });
    await prisma.extractedData.create({
      data: {
        documentId: sibling.id,
        vehicleNo: entry.vehicleNo ?? fields.vehicleNo ?? null,
        date: entry.date ?? fields.date ?? null,
        tollAmount: entry.tollAmount ?? null,
        documentTime: entry.documentTime ?? null,
        rawOcrResponse,
      },
    });
    createdIds.push(sibling.id);
    await finishSibling(sibling.id, entry.vehicleNo, entry.date);
  }

  for (const entry of additionalWeighments) {
    const docType: DocumentType = entry.documentType ?? 'WEIGHMENT';
    const sibling = await prisma.document.create({
      data: {
        type: docType,
        status: 'PENDING_REVIEW',
        originalFilename: primary.originalFilename,
        rawFilePath: primary.rawFilePath,
        mimeType: primary.mimeType,
        groupId: primary.groupId,
        sourceDocumentId: primary.sourceDocumentId ?? primary.id,
        pageNumber: primary.pageNumber,
      },
    });
    await prisma.extractedData.create({
      data: {
        documentId: sibling.id,
        vehicleNo: entry.vehicleNo ?? fields.vehicleNo ?? null,
        date: entry.date ?? fields.date ?? null,
        weightInfo: entry.weightInfo ?? null,
        sealNo: entry.sealNo ?? null,
        documentTime: entry.documentTime ?? null,
        rawOcrResponse,
      },
    });
    createdIds.push(sibling.id);
    await finishSibling(sibling.id, entry.vehicleNo, entry.date);
  }

  return createdIds;
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
  const fields = getTrackedReviewFields() as (keyof ReviewPayload)[];

  for (const field of fields) {
    const newVal = payload[field];
    const oldVal = field === 'partyNames'
      ? (existing.partyNames ? (JSON.parse(existing.partyNames) as string[]) : null)
      : existing[field as keyof typeof existing];

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
        billToParty: payload.billToParty ?? existing.billToParty,
        shipToParty: payload.shipToParty ?? existing.shipToParty,
        principalCompany: payload.principalCompany ?? existing.principalCompany,
        branchName: payload.branchName ?? existing.branchName,
        loadingSlipNo: payload.loadingSlipNo ?? existing.loadingSlipNo,
        companyInvoiceNo: payload.companyInvoiceNo ?? existing.companyInvoiceNo,
        companyInvoiceDate: payload.companyInvoiceDate ?? existing.companyInvoiceDate,
        companyEwayBillNo: payload.companyEwayBillNo ?? existing.companyEwayBillNo,
        ewayBillDate: payload.ewayBillDate ?? existing.ewayBillDate,
        approvedDestination: payload.approvedDestination ?? existing.approvedDestination,
        deliveryDestination: payload.deliveryDestination ?? existing.deliveryDestination,
        orderNo: payload.orderNo ?? existing.orderNo,
        productName: payload.productName ?? existing.productName,
        transporterName: payload.transporterName ?? existing.transporterName,
        orderType: payload.orderType ?? existing.orderType,
        tptCode: payload.tptCode ?? existing.tptCode,
        quantityInMt: payload.quantityInMt ?? existing.quantityInMt,
        quantityInBags: payload.quantityInBags ?? existing.quantityInBags,
        driverName: payload.driverName ?? existing.driverName,
        driverCellNo: payload.driverCellNo ?? existing.driverCellNo,
        workingCenter: payload.workingCenter ?? existing.workingCenter,
        depotPlantCode: payload.depotPlantCode ?? existing.depotPlantCode,
        source: payload.source ?? existing.source,
        sealNo: payload.sealNo ?? existing.sealNo,
        documentTime: payload.documentTime ?? existing.documentTime,
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
  if (updatedExtracted && updatedDoc?.type) {
    await learnFromDocumentReview(
      documentId,
      updatedDoc.type,
      mapExtractedRecordToLearnedFields(updatedExtracted, updatedDoc.type),
      Object.keys(userEdits)
    );
  }

  if (updatedExtracted?.vehicleNo || updatedExtracted?.lrNo || updatedExtracted?.invoiceNo) {
    // Auto-create LR record from confirmed reviewed data before linking.
    // For LR-type docs: always create the LR.
    // For INVOICE-type docs with an lrNo: ensure the corresponding LR exists so
    // the invoice becomes immediately visible in the Documents (LR) table.
    if (updatedDoc?.type === 'LR') {
      await autoCreateLrRecord('LR', {
        lrNo: updatedExtracted.lrNo,
        invoiceNo: updatedExtracted.invoiceNo,
        vehicleNo: updatedExtracted.vehicleNo,
        date: updatedExtracted.date,
        partyNames: updatedExtracted.partyNames,
        billToParty: updatedExtracted.billToParty,
        shipToParty: updatedExtracted.shipToParty,
        principalCompany: updatedExtracted.principalCompany,
        loadingSlipNo: updatedExtracted.loadingSlipNo,
        companyInvoiceNo: updatedExtracted.companyInvoiceNo,
        companyInvoiceDate: updatedExtracted.companyInvoiceDate,
        companyEwayBillNo: updatedExtracted.companyEwayBillNo,
        ewayBillDate: updatedExtracted.ewayBillDate,
        approvedDestination: updatedExtracted.approvedDestination,
        deliveryDestination: updatedExtracted.deliveryDestination,
        orderNo: updatedExtracted.orderNo,
        productName: updatedExtracted.productName,
        transporterName: updatedExtracted.transporterName,
        orderType: updatedExtracted.orderType,
        tptCode: updatedExtracted.tptCode,
        quantityInMt: updatedExtracted.quantityInMt,
        quantityInBags: updatedExtracted.quantityInBags,
        driverName: updatedExtracted.driverName,
        driverCellNo: updatedExtracted.driverCellNo,
        branchName: updatedExtracted.branchName,
        workingCenter: updatedExtracted.workingCenter,
        depotPlantCode: updatedExtracted.depotPlantCode,
        source: updatedExtracted.source,
        sealNo: updatedExtracted.sealNo,
        outTime: updatedExtracted.documentTime,
      });
    } else if (updatedDoc?.type === 'INVOICE' && updatedExtracted?.lrNo?.trim()) {
      // Invoice carries an explicit LR number → ensure the LR record exists.
      await autoCreateLrRecord('LR', {
        lrNo: updatedExtracted.lrNo,
        vehicleNo: updatedExtracted.vehicleNo,
        date: updatedExtracted.date,
        billToParty: updatedExtracted.billToParty,
        shipToParty: updatedExtracted.shipToParty,
        principalCompany: updatedExtracted.principalCompany,
        companyInvoiceNo: updatedExtracted.companyInvoiceNo,
        companyInvoiceDate: updatedExtracted.companyInvoiceDate,
        companyEwayBillNo: updatedExtracted.companyEwayBillNo,
        ewayBillDate: updatedExtracted.ewayBillDate,
        approvedDestination: updatedExtracted.approvedDestination,
        deliveryDestination: updatedExtracted.deliveryDestination,
        orderNo: updatedExtracted.orderNo,
        productName: updatedExtracted.productName,
        transporterName: updatedExtracted.transporterName,
        orderType: updatedExtracted.orderType,
        tptCode: updatedExtracted.tptCode,
        quantityInMt: updatedExtracted.quantityInMt,
        quantityInBags: updatedExtracted.quantityInBags,
        branchName: updatedExtracted.branchName,
        workingCenter: updatedExtracted.workingCenter,
        depotPlantCode: updatedExtracted.depotPlantCode,
        source: updatedExtracted.source,
      });
    }
    const reviewLinkResult = await autoLinkDocument(documentId);
    if (reviewLinkResult.linked && reviewLinkResult.lrId && updatedDoc?.type === 'INVOICE') {
      await backfillLrFromLinkedInvoice(reviewLinkResult.lrId, {
        invoiceNo: updatedExtracted.invoiceNo,
        companyInvoiceNo: updatedExtracted.companyInvoiceNo,
        companyInvoiceDate: updatedExtracted.companyInvoiceDate,
        companyEwayBillNo: updatedExtracted.companyEwayBillNo,
        date: updatedExtracted.date,
        principalCompany: updatedExtracted.principalCompany,
      });
    }
    await autoLinkDocumentToGroup(documentId, {
      vehicleNo: updatedExtracted.vehicleNo,
      date: updatedExtracted.date,
      lrNo: updatedExtracted.lrNo,
      invoiceNo: updatedExtracted.invoiceNo,
    });
  }
}

export async function getOcrMetrics() {
  return getOcrQualityMetrics();
}
