/**
 * Document Auto-Linking Service
 *
 * Automatically attaches uploaded Documents to Lr (Lorry Receipt) records by
 * comparing extracted OCR fields against the fields stored on Lr rows.
 *
 * Matching strategy (in priority order — all comparisons are exact):
 *  1. lrNo   exact match        → linked
 *  2. invoiceNo exact match     → linked
 *  3. vehicleNo + date (same calendar day, normalised) → linked
 *
 * No confidence scoring or fuzzy thresholds are used.  A link is created
 * whenever any of the above fields match exactly.
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

// ── Database operations ───────────────────────────────────────────────────────

/**
 * Find the matching Lr row for the given extracted fields using exact matching.
 *
 * Matching priority (first match wins):
 *  1. lrNo exact match
 *  2. invoiceNo or companyInvoiceNo exact match
 *  3. vehicleNo + same calendar day (date normalised via Date.parse)
 *
 * When a companyId is supplied the search is scoped to that company,
 * preventing cross-company data leaks.
 *
 * Returns null when no field produces an exact match.
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

  // ── 3. vehicleNo + exact same calendar day ────────────────────────────────
  if (extracted.vehicleNo?.trim() && extracted.date?.trim()) {
    const normalizedVehicle = normalizeVehicleNo(extracted.vehicleNo);
    const extractedDateMs = parseDateMs(extracted.date);
    if (extractedDateMs !== null) {
      const candidates = await db.lr.findMany({
        where: { vehicleNo: normalizedVehicle, ...scope },
        take: 20,
      });
      for (const lr of candidates) {
        // Check both date and lrDate fields on the Lr record
        const lrDateStr = lr.lrDate ?? lr.date;
        if (lrDateStr) {
          const lrDateMs = parseDateMs(lrDateStr);
          if (lrDateMs !== null && lrDateMs === extractedDateMs) {
            return { lrId: lr.id, matchedFields: ['vehicleNo', 'date'] };
          }
        }
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
    select: { id: true },
  });

  let linked = 0;

  for (const { id } of candidates) {
    const result = await autoLinkDocument(id, companyId);
    if (result.linked) linked += 1;
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
