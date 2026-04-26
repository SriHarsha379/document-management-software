/**
 * Document Auto-Linking Service
 *
 * Automatically attaches uploaded Documents to Lr (Lorry Receipt) records by
 * comparing extracted OCR fields against the fields stored on Lr rows.
 *
 * Matching strategy (in priority order):
 *  1. lrNo   exact match               → confidence 1.00
 *  2. invoiceNo exact match            → confidence 0.90
 *  3. vehicleNo + date within ±3 days  → confidence 0.70–0.80 (scaled by proximity)
 *  4. vehicleNo only                   → confidence 0.40 (below auto-link threshold)
 *
 * A link is created automatically when confidence ≥ AUTO_LINK_THRESHOLD (0.60).
 * Below that threshold the document is left PENDING for manual review or a
 * later relink attempt (supporting delayed uploads at T+1, T+7, etc.).
 *
 * Duplicate links are prevented by the unique constraint on
 * document_link_records(documentId, lrId).
 */

import { db } from '../lib/db.js';
import type { Prisma } from '@prisma/client';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Documents with a match score ≥ this are linked automatically. */
export const AUTO_LINK_THRESHOLD = 0.6;

/** Maximum date difference (in calendar days) for a vehicleNo+date match. */
export const DATE_TOLERANCE_DAYS = 3;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MatchResult {
  lrId: string;
  confidence: number;
  matchedFields: string[];
}

export interface LinkResult {
  linked: boolean;
  lrId?: string;
  confidence?: number;
  matchedFields?: string[];
  /** true when confidence ≥ threshold; false means the link was stored as pending */
  autoLinked?: boolean;
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
 */
export function isDateWithinTolerance(
  dateA: string,
  dateB: string,
  toleranceDays: number = DATE_TOLERANCE_DAYS,
): boolean {
  const diff = daysBetween(dateA, dateB);
  return diff !== null && diff <= toleranceDays;
}

// ── Core matching logic ───────────────────────────────────────────────────────

type LrRow = Awaited<ReturnType<typeof db.lr.findFirst>>;

/**
 * Compute a confidence score and the list of matched field names for a single
 * (extractedData fields) vs (Lr row) comparison.
 */
export function scoreMatch(
  extracted: {
    lrNo?: string | null;
    invoiceNo?: string | null;
    vehicleNo?: string | null;
    date?: string | null;
  },
  lr: NonNullable<LrRow>,
): { confidence: number; matchedFields: string[] } {
  const matchedFields: string[] = [];
  let confidence = 0;

  // ── 1. lrNo exact match (highest priority) ────────────────────────────────
  if (extracted.lrNo && lr.lrNo) {
    if (normalizeRefNo(extracted.lrNo) === normalizeRefNo(lr.lrNo)) {
      matchedFields.push('lrNo');
      confidence = Math.max(confidence, 1.0);
    }
  }

  // ── 2. invoiceNo exact match ──────────────────────────────────────────────
  if (extracted.invoiceNo && lr.invoiceNo) {
    if (normalizeRefNo(extracted.invoiceNo) === normalizeRefNo(lr.invoiceNo)) {
      matchedFields.push('invoiceNo');
      confidence = Math.max(confidence, 0.9);
    }
  }

  // ── 3. vehicleNo + date proximity ─────────────────────────────────────────
  const vehicleMatch =
    extracted.vehicleNo &&
    lr.vehicleNo &&
    normalizeVehicleNo(extracted.vehicleNo) === normalizeVehicleNo(lr.vehicleNo);

  if (vehicleMatch) {
    matchedFields.push('vehicleNo');

    if (extracted.date && lr.date) {
      const diff = daysBetween(extracted.date, lr.date);
      if (diff !== null && diff <= DATE_TOLERANCE_DAYS) {
        matchedFields.push('date');
        // Scale 0.70–0.80 based on proximity: 0 days → 0.80, 3 days → 0.70
        const proximityScore = 0.80 - (diff / DATE_TOLERANCE_DAYS) * 0.10;
        confidence = Math.max(confidence, proximityScore);
      }
    } else {
      // vehicleNo only — below threshold, but store the score
      confidence = Math.max(confidence, 0.4);
    }
  }

  return { confidence, matchedFields };
}

// ── Database operations ───────────────────────────────────────────────────────

/**
 * Find the best-matching Lr row for the given extracted fields.
 *
 * When a companyId is supplied (most callers should supply it) the search is
 * scoped to that company, preventing cross-company data leaks.
 *
 * Returns null when no candidate exceeds 0 confidence.
 */
export async function findBestMatchingLr(
  extracted: {
    lrNo?: string | null;
    invoiceNo?: string | null;
    vehicleNo?: string | null;
    date?: string | null;
  },
  companyId?: string,
): Promise<MatchResult | null> {
  const conditions: Prisma.LrWhereInput[] = [];

  if (extracted.lrNo?.trim()) {
    conditions.push({ lrNo: { equals: normalizeRefNo(extracted.lrNo) } });
  }
  if (extracted.invoiceNo?.trim()) {
    conditions.push({ invoiceNo: { equals: normalizeRefNo(extracted.invoiceNo) } });
  }
  if (extracted.vehicleNo?.trim()) {
    conditions.push({ vehicleNo: normalizeVehicleNo(extracted.vehicleNo) });
  }

  if (conditions.length === 0) return null;

  const where: Prisma.LrWhereInput = {
    OR: conditions,
    ...(companyId ? { companyId } : {}),
  };

  const candidates = await db.lr.findMany({ where, take: 50 });

  let best: MatchResult | null = null;

  for (const lr of candidates) {
    const { confidence, matchedFields } = scoreMatch(extracted, lr);
    if (confidence > 0 && (best === null || confidence > best.confidence)) {
      best = { lrId: lr.id, confidence, matchedFields };
    }
  }

  return best;
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
  confidence: number,
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
      // Re-running auto-link refreshes confidence and matched fields on
      // non-manual links so scores stay current as the algorithm improves.
      // Manual links are never overwritten by auto-link passes.
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

// ── High-level orchestration ─────────────────────────────────────────────────

/**
 * Run the auto-link pipeline for a single document.
 *
 * 1. Loads the document's extracted OCR fields.
 * 2. Scores all candidate Lr rows.
 * 3. If the best match confidence ≥ AUTO_LINK_THRESHOLD, persists the link.
 * 4. Returns a summary of what happened.
 *
 * `companyId` should be passed whenever available to scope the candidate search.
 */
export async function autoLinkDocument(
  documentId: string,
  companyId?: string,
): Promise<LinkResult> {
  const extracted = await db.extractedData.findUnique({ where: { documentId } });
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
  );

  if (!match) {
    return { linked: false };
  }

  // Always persist the link record so we can surface near-matches for manual
  // review.  The `autoLinked` flag tells the caller whether it passed the
  // threshold.
  await linkDocumentToLr(
    documentId,
    match.lrId,
    match.matchedFields,
    match.confidence,
    false,
  );

  return {
    linked: true,
    lrId: match.lrId,
    confidence: match.confidence,
    matchedFields: match.matchedFields,
    autoLinked: match.confidence >= AUTO_LINK_THRESHOLD,
  };
}

/**
 * Batch-relink all documents that have no confirmed auto-links yet.
 *
 * Designed for scheduled runs (e.g. nightly cron) to handle delayed uploads
 * (T+1, T+7) where the corresponding LR may not have existed at upload time.
 *
 * `companyId` may be provided to limit scope (useful for multi-tenant jobs).
 */
export async function relinkPendingDocuments(
  companyId?: string,
): Promise<RelinkSummary> {
  // Find documents with extracted data but no link with confidence ≥ threshold
  const candidates = await db.document.findMany({
    where: {
      extractedData: { isNot: null },
      documentLinks: {
        none: { confidence: { gte: AUTO_LINK_THRESHOLD } },
      },
    },
    select: { id: true },
  });

  let linked = 0;

  for (const { id } of candidates) {
    const result = await autoLinkDocument(id, companyId);
    if (result.autoLinked) linked += 1;
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
    orderBy: { confidence: 'desc' },
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
