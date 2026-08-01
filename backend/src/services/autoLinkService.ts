/**
 * Document Auto-Linking Service
 *
 * Automatically attaches uploaded Documents to Lr (Lorry Receipt) records by
 * comparing extracted OCR fields against the fields stored on Lr rows.
 *
 * Matching strategy (in priority order):
 *  1. lrNo      exact match                              → linked
 *  2. invoiceNo exact match (invoiceNo or companyInvoiceNo) → linked
 *  3. vehicleNo + date, tolerance depends on document type:
 *       - LR, WEIGHMENT_PARTY (seller weighment)  → same calendar day only
 *       - INVOICE, WEIGHMENT_SITE (buyer weighment) → 0-5 days AFTER the LR date
 *         (invoices are raised at the head office and can lag by up to 5 days;
 *          the buyer-side weighment happens after the trip, similarly delayed)
 *       - everything else                          → same calendar day only
 *     Documents never match a date *before* the LR date — the LR is always
 *     created first.
 *
 * Same-vehicle ambiguity guard: a vehicle can make more than one trip
 * (more than one LR) within the tolerance window. Rule 3 must never guess
 * which trip a weighment/invoice belongs to:
 *   - exactly one LR candidate in the window → auto-link
 *   - more than one candidate → narrow to a tight 1-day window; auto-link
 *     only if that narrower window still has exactly one candidate
 *   - still ambiguous → leave unlinked for manual review, never guess
 *
 * Duplicate links are prevented by the unique constraint on
 * document_link_records(documentId, lrId).
 */

import { db } from '../lib/db.js';
import type { Prisma } from '@prisma/client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MatchResult {
  lrId: string;
  matchedFields: string[];
}

export interface LinkResult {
  linked: boolean;
  lrId?: string;
  matchedFields?: string[];
}

export interface RelinkSummary {
  processed: number;
  linked: number;
}

// ── Normalisation helpers ─────────────────────────────────────────────────────

/** Normalise a vehicle number: uppercase, strip all whitespace. */
export function normalizeVehicleNo(v: string): string {
  return v.trim().toUpperCase().replace(/\s+/g, '');
}

/** Normalise an LR / invoice number: uppercase, strip leading/trailing space. */
export function normalizeRefNo(s: string): string {
  return s.trim().toUpperCase();
}

/**
 * Parse a date string (YYYY-MM-DD or similar) into a UTC midnight timestamp in
 * milliseconds.  Returns null if the string cannot be parsed.
 */
export function parseDateMs(dateStr: string): number | null {
  const ms = Date.parse(dateStr);
  return isNaN(ms) ? null : ms;
}

/**
 * Return the absolute difference in days between two date strings.
 * Returns null if either date cannot be parsed.
 */
export function daysBetween(dateA: string, dateB: string): number | null {
  const msA = parseDateMs(dateA);
  const msB = parseDateMs(dateB);
  if (msA === null || msB === null) return null;
  return Math.abs(msA - msB) / (1000 * 60 * 60 * 24);
}

/**
 * Return true when the two date strings are within `toleranceDays` of each
 * other.  Returns false (not null) when either date is unparseable — callers
 * treat unparseable as "no match".
 *
 * Retained as a utility for callers that need range-based date comparisons.
 * The auto-link pipeline itself uses exact (same-day) date matching.
 */
export function isDateWithinTolerance(
  dateA: string,
  dateB: string,
  toleranceDays: number = 3,
): boolean {
  const diff = daysBetween(dateA, dateB);
  return diff !== null && diff <= toleranceDays;
}

/**
 * Maximum number of days AFTER the LR date that a document of this type is
 * allowed to be dated and still auto-link via the vehicleNo+date fallback.
 *
 * LR and the seller/party weighment slip are created the same day as the LR.
 * The invoice (raised at the head office) and the buyer/site weighment slip
 * (taken after the trip) can legitimately lag by up to 5 days.
 */
function getForwardToleranceDays(documentType?: string | null): number {
  switch (documentType) {
    case 'INVOICE':
    case 'WEIGHMENT_SITE':
    case 'WEIGHMENT':
      // The OCR classifier doesn't always distinguish party vs site
      // weighment slips and tags both generically as 'WEIGHMENT'. Real
      // uploads confirm the destination/site weighment slip can legitimately
      // land a day or more after the LR date, so the generic type gets the
      // same tolerance as WEIGHMENT_SITE rather than silently missing real
      // matches. WEIGHMENT_PARTY (explicitly classified) stays strict below
      // — that one is confirmed same-day.
      return 5;
    default:
      // LR, WEIGHMENT_PARTY, EWAYBILL, RECEIVING, TOLL, UNKNOWN
      return 0;
  }
}

// ── Database operations ───────────────────────────────────────────────────────

/**
 * Find the matching Lr row for the given extracted fields.
 *
 * Matching priority (first match wins):
 *  1. lrNo exact match
 *  2. invoiceNo or companyInvoiceNo exact match
 *  3. vehicleNo + date within the type-appropriate forward tolerance
 *     (see getForwardToleranceDays), with the same-vehicle ambiguity guard
 *     described in the file header — never auto-picks between two candidate
 *     trips it can't confidently tell apart.
 *
 * When a companyId is supplied the search is scoped to that company,
 * preventing cross-company data leaks.
 *
 * `documentType` (e.g. 'INVOICE', 'WEIGHMENT_SITE') controls the rule-3
 * tolerance window. Pass it whenever available.
 *
 * Returns null when no field produces a confident match.
 */
export async function findBestMatchingLr(
  extracted: {
    lrNo?: string | null;
    invoiceNo?: string | null;
    vehicleNo?: string | null;
    date?: string | null;
  },
  companyId?: string,
  documentType?: string | null,
): Promise<MatchResult | null> {
  const scope: Prisma.LrWhereInput = companyId ? { companyId } : {};

  // ── 1. lrNo exact match ───────────────────────────────────────────────────
  if (extracted.lrNo?.trim()) {
    const lr = await db.lr.findFirst({
      where: { lrNo: normalizeRefNo(extracted.lrNo), ...scope },
    });
    if (lr) return { lrId: lr.id, matchedFields: ['lrNo'] };
  }

  // ── 2. invoiceNo exact match (check both invoiceNo and companyInvoiceNo) ──
  if (extracted.invoiceNo?.trim()) {
    const normalizedInvoice = normalizeRefNo(extracted.invoiceNo);
    const lr = await db.lr.findFirst({
      where: {
        OR: [
          { invoiceNo: normalizedInvoice },
          { companyInvoiceNo: normalizedInvoice },
        ],
        ...scope,
      },
    });
    if (lr) return { lrId: lr.id, matchedFields: ['invoiceNo'] };
  }

  // ── 3. vehicleNo + date within tolerance, with same-vehicle ambiguity guard ─
  if (extracted.vehicleNo?.trim() && extracted.date?.trim()) {
    const normalizedVehicle = normalizeVehicleNo(extracted.vehicleNo);
    const extractedDateMs = parseDateMs(extracted.date);
    const toleranceDays = getForwardToleranceDays(documentType);

    if (extractedDateMs !== null) {
      const candidates = await db.lr.findMany({
        where: { vehicleNo: normalizedVehicle, ...scope },
        take: 20,
      });

      // A document can only be dated on/after its LR (the LR is always
      // created first), and never more than `toleranceDays` after it.
      const withinWindow: Array<{ lrId: string; diffDays: number }> = [];
      for (const lr of candidates) {
        const lrDateStr = lr.lrDate ?? lr.date;
        if (!lrDateStr) continue;
        const lrDateMs = parseDateMs(lrDateStr);
        if (lrDateMs === null) continue;
        const diffDays = (extractedDateMs - lrDateMs) / (1000 * 60 * 60 * 24);
        if (diffDays >= 0 && diffDays <= toleranceDays) {
          withinWindow.push({ lrId: lr.id, diffDays });
        }
      }

      if (withinWindow.length === 1) {
        // Unambiguous — only one trip for this vehicle falls in the window.
        return { lrId: withinWindow[0].lrId, matchedFields: ['vehicleNo', 'date'] };
      }

      if (withinWindow.length > 1) {
        // Same vehicle matches more than one LR in the window — likely two
        // separate trips close together. Never guess between them; only
        // auto-link if a tighter 1-day window narrows it down to exactly one.
        const tight = withinWindow.filter((c) => c.diffDays <= 1);
        if (tight.length === 1) {
          return { lrId: tight[0].lrId, matchedFields: ['vehicleNo', 'date'] };
        }
        // Still ambiguous — leave unlinked for manual review.
      }
    }
  }

  return null;
}

/**
 * Persist a document→LR link in `document_link_records`.
 *
 * If the link already exists (duplicate) the existing record is returned
 * unchanged — the unique constraint is the authoritative duplicate guard.
 */
export async function linkDocumentToLr(
  documentId: string,
  lrId: string,
  matchedFields: string[],
  confidence: number = 1.0,
  isManual: boolean = false,
): Promise<Prisma.DocumentLinkRecordGetPayload<object>> {
  return db.documentLinkRecord.upsert({
    where: { documentId_lrId: { documentId, lrId } },
    create: {
      documentId,
      lrId,
      matchedFields: JSON.stringify(matchedFields),
      confidence,
      isManual,
    },
    update: {
      ...(isManual
        ? { isManual: true, matchedFields: JSON.stringify(matchedFields), confidence }
        : { matchedFields: JSON.stringify(matchedFields), confidence }),
    },
  });
}

/**
 * Remove a specific document→LR link (manual unlink).
 * Silently succeeds when the link does not exist.
 */
export async function unlinkDocumentFromLr(
  documentId: string,
  lrId: string,
): Promise<void> {
  await db.documentLinkRecord
    .delete({ where: { documentId_lrId: { documentId, lrId } } })
    .catch(() => {
      // Record didn't exist — that's fine
    });
}

/**
 * Run the auto-link pipeline for a single document.
 *
 * 1. Loads the document's extracted OCR fields.
 * 2. Searches for an exactly matching Lr row (lrNo → invoiceNo → vehicleNo+date).
 * 3. If a match is found, persists the link.
 * 4. Returns a summary of what happened.
 *
 * `companyId` should be passed whenever available to scope the candidate search.
 */
export async function autoLinkDocument(
  documentId: string,
  companyId?: string,
): Promise<LinkResult> {
  const [document, extracted] = await Promise.all([
    db.document.findUnique({ where: { id: documentId }, select: { type: true } }),
    db.extractedData.findUnique({ where: { documentId } }),
  ]);
  if (!extracted) {
    return { linked: false };
  }

  const match = await findBestMatchingLr(
    {
      lrNo: extracted.lrNo,
      invoiceNo: extracted.invoiceNo,
      vehicleNo: extracted.vehicleNo,
      date: extracted.date,
    },
    companyId,
    document?.type,
  );

  if (!match) {
    return { linked: false };
  }

  await linkDocumentToLr(
    documentId,
    match.lrId,
    match.matchedFields,
    1.0,
    false,
  );

  return {
    linked: true,
    lrId: match.lrId,
    matchedFields: match.matchedFields,
  };
}

/**
 * Back-fill invoice-related fields on an Lr record from a linked Invoice document.
 *
 * Only writes fields that are currently null on the Lr row — never overwrites
 * data that was already captured from the LR document or entered manually.
 *
 * Called after an INVOICE-type document is successfully linked to an Lr record,
 * so that the dashboard INV. NO / INV. DATE / PRIN. COMPANY columns are
 * populated even when the LR document itself did not carry those values.
 */
export async function backfillLrFromLinkedInvoice(
  lrId: string,
  fields: {
    invoiceNo?: string | null;
    companyInvoiceNo?: string | null;
    companyInvoiceDate?: string | null;
    companyEwayBillNo?: string | null;
    date?: string | null;
    principalCompany?: string | null;
  },
): Promise<void> {
  const lr = await db.lr.findUnique({
    where: { id: lrId },
    select: {
      invoiceNo: true,
      companyInvoiceNo: true,
      companyInvoiceDate: true,
      companyEwayBillNo: true,
      principalCompany: true,
    },
  });
  if (!lr) return;

  const update: Prisma.LrUpdateInput = {};

  // Prefer the dedicated company invoice fields; fall back to generic invoiceNo/date.
  const incomingInvoiceNo = fields.companyInvoiceNo?.trim() || fields.invoiceNo?.trim() || null;
  const incomingInvoiceDate = fields.companyInvoiceDate?.trim() || fields.date?.trim() || null;

  if (!lr.companyInvoiceNo && incomingInvoiceNo) update.companyInvoiceNo = incomingInvoiceNo;
  if (!lr.companyInvoiceDate && incomingInvoiceDate) update.companyInvoiceDate = incomingInvoiceDate;
  if (!lr.companyEwayBillNo && fields.companyEwayBillNo?.trim()) update.companyEwayBillNo = fields.companyEwayBillNo.trim();
  // Also fill legacy invoiceNo if blank (used by the auto-link matcher)
  if (!lr.invoiceNo && incomingInvoiceNo) update.invoiceNo = incomingInvoiceNo;
  // Backfill principal company from the invoice when the LR record has none
  if (!lr.principalCompany && fields.principalCompany?.trim()) update.principalCompany = fields.principalCompany.trim();

  if (Object.keys(update).length > 0) {
    await db.lr.update({ where: { id: lrId }, data: update });
  }
}

/**
 * Batch-relink all documents that have no confirmed link yet.
 *
 * Designed for scheduled runs (e.g. nightly cron) to handle delayed uploads
 * (T+1, T+7) where the corresponding LR may not have existed at upload time.
 *
 * `companyId` may be provided to limit scope (useful for multi-tenant jobs).
 */
export async function relinkPendingDocuments(
  companyId?: string,
): Promise<RelinkSummary> {
  // Find documents with extracted data but no link records at all
  const candidates = await db.document.findMany({
    where: {
      extractedData: { isNot: null },
      documentLinks: { none: {} },
    },
    select: {
      id: true,
      type: true,
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

  let linked = 0;

  for (const doc of candidates) {
    const result = await autoLinkDocument(doc.id, companyId);
    if (result.linked) {
      linked += 1;
      if (doc.type === 'INVOICE' && result.lrId && doc.extractedData) {
        await backfillLrFromLinkedInvoice(result.lrId, {
          invoiceNo: doc.extractedData.invoiceNo,
          companyInvoiceNo: doc.extractedData.companyInvoiceNo,
          companyInvoiceDate: doc.extractedData.companyInvoiceDate,
          companyEwayBillNo: doc.extractedData.companyEwayBillNo,
          date: doc.extractedData.date,
          principalCompany: doc.extractedData.principalCompany,
        });
      }
    }
  }

  return { processed: candidates.length, linked };
}

/**
 * Return all LR link records for a given document, enriched with LR metadata.
 */
export async function getDocumentLinks(documentId: string) {
  const records = await db.documentLinkRecord.findMany({
    where: { documentId },
    include: {
      lr: {
        select: {
          id: true,
          lrNo: true,
          invoiceNo: true,
          vehicleNo: true,
          date: true,
          status: true,
          consignor: true,
          consignee: true,
        },
      },
    },
    orderBy: { linkedAt: 'desc' },
  });

  return records.map((r) => ({
    lrId: r.lrId,
    matchedFields: JSON.parse(r.matchedFields) as string[],
    confidence: r.confidence,
    isManual: r.isManual,
    linkedAt: r.linkedAt,
    lr: r.lr,
  }));
}
