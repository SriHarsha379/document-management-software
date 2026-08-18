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
 *       - TOLL                                     → 0-2 days AFTER the LR date
 *         (a late-departing LR routinely has its toll debits land in the early
 *          hours of the following calendar day — same trip, next date)
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
import { reconcileLr } from './reconciliationService.js';
import { canonicalVehicleNo } from './vehicleNormalization.js';
import { selectByWeightInfo, type WeightCandidate } from './weightMatching.js';
import type { WeighmentPoint } from './weighmentClassifier.js';

export { normalizeVehicleNo } from './vehicleNormalization.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Identifier for the rule that produced a link, ordered strongest first.
 * Persisted alongside the link so the UI can explain *why* a document was
 * attached, and so a review queue can be filtered by trustworthiness.
 */
export type MatchStrategy =
  | 'lrNo'
  | 'invoiceNo'
  | 'sealNo'
  | 'challanNo'
  | 'netWeight'
  | 'vehicleDateTime'
  | 'vehicleDate';

/**
 * Confidence assigned to each strategy. These are the values written to
 * `document_link_records.confidence`; anything below REVIEW_THRESHOLD should
 * surface in the manual-review queue rather than being dispatched blind.
 */
export const STRATEGY_CONFIDENCE: Record<MatchStrategy, number> = {
  lrNo: 1.0,
  invoiceNo: 1.0,
  sealNo: 0.95,
  challanNo: 1.0,
  netWeight: 0.92,
  vehicleDateTime: 0.7,
  vehicleDate: 0.5,
};

/** Links at or above this confidence are safe to auto-dispatch. */
export const REVIEW_THRESHOLD = 0.8;

export interface MatchResult {
  lrId: string;
  matchedFields: string[];
  strategy: MatchStrategy;
  confidence: number;
}

export interface LinkResult {
  linked: boolean;
  lrId?: string;
  matchedFields?: string[];
  strategy?: MatchStrategy;
  confidence?: number;
}

export interface RelinkSummary {
  processed: number;
  linked: number;
}

// ── Normalisation helpers ─────────────────────────────────────────────────────

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
 * Parse a time-of-day string ("HH:MM", "HH:MM:SS", or "hh:mm AM/PM") into
 * minutes since midnight. Returns null if it can't be parsed.
 */
export function parseTimeToMinutes(timeStr: string): number | null {
  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return null;
  let hours = parseInt(m[1]!, 10);
  const minutes = parseInt(m[2]!, 10);
  const ampm = m[4]?.toUpperCase();
  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Combine a date string and an optional time-of-day string into a single UTC
 * timestamp (ms). Falls back to UTC midnight for the date when the time is
 * missing or unparseable, so callers can always get a rough comparison point.
 * Returns null when the date itself can't be parsed.
 */
export function combineDateTimeMs(dateStr: string, timeStr?: string | null): number | null {
  const dateMs = parseDateMs(dateStr);
  if (dateMs === null) return null;
  if (!timeStr?.trim()) return dateMs;
  const minutes = parseTimeToMinutes(timeStr);
  if (minutes === null) return dateMs;
  return dateMs + minutes * 60 * 1000;
}

/**
 * Document types whose sealNo can be cross-checked against the LR's own
 * printed Seal No. field. Weighment slips at the loading/origin point are
 * sometimes hand-annotated with the LR's seal number as a manual
 * cross-check; the generic 'WEIGHMENT' type is included since the OCR
 * classifier doesn't always distinguish party vs site weighment.
 */
const SEAL_MATCH_TYPES = new Set(['WEIGHMENT', 'WEIGHMENT_PARTY', 'WEIGHMENT_SITE']);

/**
 * Document types whose extracted `weightInfo` can be compared against the
 * LR's declared `quantityInMt`. Only weighbridge tickets carry a gross/tare/
 * net triple; anything else that happens to mention a weight is not a
 * calibrated reading and must not drive a link.
 */
const WEIGHT_MATCH_TYPES = new Set(['WEIGHMENT', 'WEIGHMENT_PARTY', 'WEIGHMENT_SITE']);

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
    case 'TOLL':
      // A FASTag swipe is a trip-in-progress event, not a headoffice
      // document, so it doesn't need the 5-day invoice-lag window — but it
      // does need to survive crossing midnight. Real bundles show several
      // LRs with a late outTime (19:45, 21:30, 22:54, 23:00, 00:04) whose
      // toll debits land in the early hours of the FOLLOWING calendar day
      // (e.g. LR dated 28/03 with tolls debited 29/03; a 12/05 LR with tolls
      // debited ~05:00 AM, i.e. the morning after departure). A same-day-only
      // window would silently fail to link exactly these overnight trips.
      return 2;
    default:
      // LR, WEIGHMENT_PARTY, EWAYBILL, RECEIVING, UNKNOWN
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
 *  3. sealNo exact match (weighment documents only) — a weighment slip is
 *     sometimes hand-annotated with the LR's seal number as a manual
 *     cross-check; treat it as a confident exact match when present.
 *  4. vehicleNo + date within the type-appropriate forward tolerance
 *     (see getForwardToleranceDays), with the same-vehicle ambiguity guard
 *     described in the file header — never auto-picks between two candidate
 *     trips it can't confidently tell apart. When the date alone leaves more
 *     than one candidate trip, documentTime (if extracted) is used to prefer
 *     the LR whose own outTime precedes the document's time most closely,
 *     before falling back to the tighter 1-day window.
 *
 * When a companyId is supplied the search is scoped to that company,
 * preventing cross-company data leaks.
 *
 * `documentType` (e.g. 'INVOICE', 'WEIGHMENT_SITE') controls the rule-4
 * tolerance window and whether the sealNo tier applies. Pass it whenever
 * available.
 *
 * Returns null when no field produces a confident match.
 */
export async function findBestMatchingLr(
  extracted: {
    lrNo?: string | null;
    invoiceNo?: string | null;
    vehicleNo?: string | null;
    date?: string | null;
    sealNo?: string | null;
    documentTime?: string | null;
    weightInfo?: string | null;
    challanNo?: string | null;
    weighmentPoint?: string | null;
  },
  companyId?: string,
  documentType?: string | null,
): Promise<MatchResult | null> {
  const scope: Prisma.LrWhereInput = companyId ? { companyId } : {};

  /** Build a MatchResult, stamping the strategy's default confidence. */
  const result = (
    lrId: string,
    matchedFields: string[],
    strategy: MatchStrategy,
    confidenceOverride?: number,
  ): MatchResult => ({
    lrId,
    matchedFields,
    strategy,
    confidence: confidenceOverride ?? STRATEGY_CONFIDENCE[strategy],
  });

  // ── 1. lrNo exact match ───────────────────────────────────────────────────
  if (extracted.lrNo?.trim()) {
    const lr = await db.lr.findFirst({
      where: { lrNo: normalizeRefNo(extracted.lrNo), ...scope },
    });
    if (lr) return result(lr.id, ['lrNo'], 'lrNo');
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
    if (lr) return result(lr.id, ['invoiceNo'], 'invoiceNo');
  }

  // ── 2b. challanNo exact match against the invoice number ──────────────────
  //
  // Some weighbridge slips print the invoice number in their Challan No field
  // verbatim — the ACM Readymix slip for LR MH/DR/LR/25-26/2532 carries
  // "MHPS003248", which is exactly the tax invoice number. That turns an
  // otherwise weight-only document into an exact match.
  //
  // Strictly equality, never fuzzy. Gate challans often use a DIFFERENT number
  // series that merely resembles the invoice's OA number (801665599 vs
  // 801665638 in an earlier bundle), so a near-miss must fall through silently
  // rather than produce a confident wrong link.
  if (extracted.challanNo?.trim()) {
    const normalizedChallan = normalizeRefNo(extracted.challanNo);
    const lr = await db.lr.findFirst({
      where: {
        OR: [
          { invoiceNo: normalizedChallan },
          { companyInvoiceNo: normalizedChallan },
        ],
        ...scope,
      },
    });
    if (lr) return result(lr.id, ['challanNo'], 'challanNo');
  }

  // ── 3. sealNo exact match (weighment documents only) ──────────────────────
  if (
    extracted.sealNo?.trim() &&
    documentType &&
    SEAL_MATCH_TYPES.has(documentType)
  ) {
    const normalizedSeal = normalizeRefNo(extracted.sealNo);
    const lr = await db.lr.findFirst({
      where: { sealNo: normalizedSeal, ...scope },
    });
    if (lr) return result(lr.id, ['sealNo'], 'sealNo');
  }

  // ── 4/5. vehicle-scoped candidate set ─────────────────────────────────────
  //
  // Both the weight tier and the date fallback need the same candidate list:
  // every LR for this vehicle. The lookup is done on the CANONICAL vehicle
  // number so that an OCR confusion (S↔5, O↔0, B↔8) on a thermal-printed
  // weighbridge ticket doesn't hide the correct LR. Because the canonical
  // form is lossy, the DB query fetches a slightly wider set by vehicle and
  // the exact canonical comparison is applied in memory.
  if (extracted.vehicleNo?.trim() && extracted.date?.trim()) {
    const canonicalVehicle = canonicalVehicleNo(extracted.vehicleNo);
    const extractedDateMs = parseDateMs(extracted.date);
    const toleranceDays = getForwardToleranceDays(documentType);

    if (extractedDateMs !== null) {
      const rawCandidates = await db.lr.findMany({
        where: { vehicleNoCanonical: canonicalVehicle, ...scope },
        take: 20,
      });

      // Defensive: rows written before the canonical column was backfilled
      // may hold a null/stale value, so re-verify in memory.
      const candidates = rawCandidates.filter(
        (lr) => !lr.vehicleNo || canonicalVehicleNo(lr.vehicleNo) === canonicalVehicle,
      );

      // ── 4. Net weight vs declared quantity (weighment slips) ──────────────
      //
      // A weighbridge ticket carries no LR or invoice number, but its net
      // weight IS the consignment quantity. This is the only tier that can
      // separate two same-day trips by the same vehicle on real evidence
      // rather than on a time heuristic, so it runs BEFORE the date fallback.
      if (WEIGHT_MATCH_TYPES.has(documentType ?? '') && extracted.weightInfo?.trim()) {
        // Restrict to LRs whose own date is inside the forward window before
        // comparing weights — two trips a month apart can share a load size.
        const datedCandidates: WeightCandidate[] = [];
        for (const lr of candidates) {
          const lrDateStr = lr.lrDate ?? lr.date;
          if (!lrDateStr) continue;
          const lrDateMs = parseDateMs(lrDateStr);
          if (lrDateMs === null) continue;
          const diffDays = (extractedDateMs - lrDateMs) / (1000 * 60 * 60 * 24);
          if (diffDays >= 0 && diffDays <= toleranceDays) {
            datedCandidates.push({
              lrId: lr.id,
              quantityInMt: lr.quantityInMt,
              // Lets a destination slip be compared against the actual loaded
              // weight rather than the declared quantity.
              originNetWeightKg: lr.originNetWeightKg,
            });
          }
        }

        // A destination reading gets the wider transit-loss tolerance, so a
        // genuine shortage still links instead of being silently dropped.
        const point: WeighmentPoint =
          extracted.weighmentPoint === 'DESTINATION'
            ? 'DESTINATION'
            : extracted.weighmentPoint === 'ORIGIN'
              ? 'ORIGIN'
              : documentType === 'WEIGHMENT_SITE'
                ? 'DESTINATION'
                : 'ORIGIN';

        const byWeight = selectByWeightInfo(extracted.weightInfo, datedCandidates, point);
        if (byWeight) {
          return result(
            byWeight.lrId,
            ['vehicleNo', 'netWeight'],
            'netWeight',
            // A contested win (another LR also inside tolerance, but further
            // away) is still a win, just a less certain one.
            byWeight.contested ? STRATEGY_CONFIDENCE.netWeight - 0.07 : undefined,
          );
        }
      }

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
        return result(withinWindow[0].lrId, ['vehicleNo', 'date'], 'vehicleDate');
      }

      if (withinWindow.length > 1) {
        // Same vehicle matches more than one LR in the window — likely two
        // separate trips close together. Never guess between them unless we
        // can narrow it down with real evidence.

        // 4a. Time-aware narrowing: if the document carries a time-of-day and
        // the candidate LRs have their own outTime recorded, prefer the LR
        // whose outTime precedes the document's time most closely — a
        // weighment/toll can only belong to a trip that had already left.
        // Only trust this when it produces a single, unambiguous winner.
        if (extracted.documentTime?.trim()) {
          const docMs = combineDateTimeMs(extracted.date!, extracted.documentTime);
          if (docMs !== null) {
            const withTimeDiff: Array<{ lrId: string; diffMinutes: number }> = [];
            for (const candidate of withinWindow) {
              const lr = candidates.find((c) => c.id === candidate.lrId);
              const lrDateStr = lr?.lrDate ?? lr?.date;
              if (!lr?.outTime?.trim() || !lrDateStr) continue;
              const lrMs = combineDateTimeMs(lrDateStr, lr.outTime);
              if (lrMs === null) continue;
              const diffMinutes = (docMs - lrMs) / (1000 * 60);
              // The document must postdate the LR's own departure.
              if (diffMinutes >= 0) {
                withTimeDiff.push({ lrId: candidate.lrId, diffMinutes });
              }
            }
            if (withTimeDiff.length > 0) {
              withTimeDiff.sort((a, b) => a.diffMinutes - b.diffMinutes);
              const isUnambiguous =
                withTimeDiff.length === 1 || withTimeDiff[0]!.diffMinutes < withTimeDiff[1]!.diffMinutes;
              if (isUnambiguous) {
                return result(
                  withTimeDiff[0]!.lrId,
                  ['vehicleNo', 'date', 'documentTime'],
                  'vehicleDateTime',
                );
              }
            }
          }
        }

        // 4b. Fall back to a tighter 1-day window when no time evidence
        // resolved it (older documents, or LRs without a recorded outTime).
        const tight = withinWindow.filter((c) => c.diffDays <= 1);
        if (tight.length === 1) {
          return result(tight[0].lrId, ['vehicleNo', 'date'], 'vehicleDate');
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

  // The linked-document set changed — recompute rollups so a removed TOLL/
  // WEIGHMENT link doesn't leave stale totals on the Lr.
  try {
    await reconcileLr(lrId);
  } catch (err) {
    console.error(`reconcileLr failed for lrId=${lrId}:`, err);
  }
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
      sealNo: extracted.sealNo,
      documentTime: extracted.documentTime,
      weightInfo: extracted.weightInfo,
      challanNo: extracted.challanNo,
      weighmentPoint: extracted.weighmentPoint,
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
    match.confidence,
    false,
  );

  // Roll up TOLL/WEIGHMENT data and cross-check quantities onto the Lr now
  // that its set of linked documents has changed. Never let a reconciliation
  // failure (e.g. a transient DB hiccup) fail the link itself — the link is
  // the important part and reconciliation can be re-run later.
  try {
    await reconcileLr(match.lrId);
  } catch (err) {
    console.error(`reconcileLr failed for lrId=${match.lrId}:`, err);
  }

  return {
    linked: true,
    lrId: match.lrId,
    matchedFields: match.matchedFields,
    strategy: match.strategy,
    confidence: match.confidence,
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