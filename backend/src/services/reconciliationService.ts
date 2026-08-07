/**
 * reconciliationService.ts
 *
 * Rolls up data from documents linked to an Lr (trip) and cross-checks it,
 * instead of leaving each document's ExtractedData sitting in isolation.
 *
 * Problem this solves:
 *   - TOLL documents' `tollAmount` was extracted but never summed onto the
 *     Lr's `tollCharges`-equivalent, so the cost never reached the trip record.
 *   - Two independent weighment readings exist per trip (origin/party and
 *     destination/site) but nothing compared them, so a short-loaded or
 *     mis-weighed trip was invisible unless someone manually opened both slips.
 *   - Invoice / LR quantity vs actual weighbridge net weight was never
 *     cross-checked either.
 *
 * This module is intentionally read-only with respect to user-editable Lr
 * fields (e.g. it never touches the manually-entered `tollCharges`) — it only
 * writes to the dedicated `auto*`/`reconciliation*` columns so a human's
 * manual entry is never silently overwritten.
 *
 * Call `reconcileLr(lrId)` any time a document is linked or unlinked from an
 * Lr. It is deliberately cheap (a handful of indexed reads) so it's safe to
 * call synchronously after every link/unlink.
 */

import { db } from '../lib/db.js';

const WEIGHT_VARIANCE_WARN_PCT = 0.5; // origin vs destination net weight
const QUANTITY_VARIANCE_WARN_PCT = 2; // declared quantity vs actual net weight

export interface ReconciliationResult {
  autoTollAmount: number | null;
  originNetWeightKg: number | null;
  destinationNetWeightKg: number | null;
  weightVariancePct: number | null;
  issues: string[];
}

/**
 * Parse a currency string like "₹205.50", "Rs.150", "INR 411", or a bare
 * "411" into a plain number. Returns null when nothing numeric is found.
 */
export function parseAmount(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = parseFloat(match[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract the net weight in kg from a weightInfo string such as
 * "Gross: 50180 kg, Tare: 15490 kg, Net: 34690 kg". Falls back to
 * gross-minus-tare if a labelled "Net" is missing but both other readings
 * are present. Returns null when no usable weight can be recovered.
 */
export function parseNetWeightKg(value: string | null | undefined): number | null {
  if (!value) return null;
  const netMatch = value.match(/net[^0-9-]*(-?\d+(?:\.\d+)?)/i);
  if (netMatch) {
    const n = parseFloat(netMatch[1]);
    if (Number.isFinite(n)) return n;
  }
  const grossMatch = value.match(/gross[^0-9-]*(-?\d+(?:\.\d+)?)/i);
  const tareMatch = value.match(/tare[^0-9-]*(-?\d+(?:\.\d+)?)/i);
  if (grossMatch && tareMatch) {
    const gross = parseFloat(grossMatch[1]);
    const tare = parseFloat(tareMatch[1]);
    if (Number.isFinite(gross) && Number.isFinite(tare)) {
      return gross - tare;
    }
  }
  return null;
}

function pctDiff(a: number, b: number): number {
  const base = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return (Math.abs(a - b) / base) * 100;
}

/**
 * Recompute rollup/reconciliation fields for a single Lr from all of its
 * currently-linked documents, and persist the result.
 *
 * Safe to call repeatedly (e.g. after every link/unlink) — it always
 * recomputes from scratch rather than incrementally accumulating, so it
 * self-corrects if a document is unlinked or its OCR data is corrected.
 */
export async function reconcileLr(lrId: string): Promise<ReconciliationResult> {
  const [lr, links] = await Promise.all([
    db.lr.findUnique({
      where: { id: lrId },
      select: { quantityInMt: true },
    }),
    db.documentLinkRecord.findMany({
      where: { lrId },
      select: {
        document: {
          select: {
            type: true,
            extractedData: {
              select: { tollAmount: true, weightInfo: true, quantityInMt: true },
            },
          },
        },
      },
    }),
  ]);

  const result: ReconciliationResult = {
    autoTollAmount: null,
    originNetWeightKg: null,
    destinationNetWeightKg: null,
    weightVariancePct: null,
    issues: [],
  };

  if (!lr) {
    return result;
  }

  let tollSum = 0;
  let tollCount = 0;
  let invoiceQuantityMt: number | null = null;

  for (const link of links) {
    const doc = link.document;
    const extracted = doc.extractedData;
    if (!extracted) continue;

    if (doc.type === 'TOLL') {
      const amt = parseAmount(extracted.tollAmount);
      if (amt !== null) {
        tollSum += amt;
        tollCount += 1;
      }
    }

    if (doc.type === 'WEIGHMENT_PARTY' || doc.type === 'WEIGHMENT') {
      const kg = parseNetWeightKg(extracted.weightInfo);
      if (kg !== null) result.originNetWeightKg = kg;
    }

    if (doc.type === 'WEIGHMENT_SITE') {
      const kg = parseNetWeightKg(extracted.weightInfo);
      if (kg !== null) result.destinationNetWeightKg = kg;
    }

    if (doc.type === 'INVOICE' && extracted.quantityInMt != null) {
      invoiceQuantityMt = extracted.quantityInMt;
    }
  }

  result.autoTollAmount = tollCount > 0 ? Math.round(tollSum * 100) / 100 : null;

  if (result.originNetWeightKg !== null && result.destinationNetWeightKg !== null) {
    result.weightVariancePct =
      Math.round(pctDiff(result.originNetWeightKg, result.destinationNetWeightKg) * 100) / 100;
    if (result.weightVariancePct > WEIGHT_VARIANCE_WARN_PCT) {
      result.issues.push(
        `Origin weighment (${result.originNetWeightKg} kg) and destination weighment ` +
          `(${result.destinationNetWeightKg} kg) differ by ${result.weightVariancePct}% ` +
          `— above the ${WEIGHT_VARIANCE_WARN_PCT}% tolerance.`,
      );
    }
  }

  // Cross-check declared quantity (LR, or invoice as fallback) against the
  // actual weighbridge net weight, whichever weighment reading we have.
  const declaredQuantityMt = lr.quantityInMt ?? invoiceQuantityMt;
  const actualNetKg = result.destinationNetWeightKg ?? result.originNetWeightKg;
  if (declaredQuantityMt != null && actualNetKg !== null) {
    const declaredKg = declaredQuantityMt * 1000;
    const qtyVariancePct = Math.round(pctDiff(declaredKg, actualNetKg) * 100) / 100;
    if (qtyVariancePct > QUANTITY_VARIANCE_WARN_PCT) {
      result.issues.push(
        `Declared quantity (${declaredQuantityMt} MT = ${declaredKg} kg) differs from the ` +
          `weighbridge net weight (${actualNetKg} kg) by ${qtyVariancePct}% ` +
          `— above the ${QUANTITY_VARIANCE_WARN_PCT}% tolerance.`,
      );
    }
  }

  await db.lr.update({
    where: { id: lrId },
    data: {
      autoTollAmount: result.autoTollAmount,
      originNetWeightKg: result.originNetWeightKg,
      destinationNetWeightKg: result.destinationNetWeightKg,
      weightVariancePct: result.weightVariancePct,
      reconciliationIssues: result.issues.length > 0 ? JSON.stringify(result.issues) : null,
      reconciledAt: new Date(),
    },
  });

  return result;
}
