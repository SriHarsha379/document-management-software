/**
 * Pairwise Weighment Resolution
 *
 * `weighmentClassifier` judges one slip in isolation. That is not always
 * enough, because real weighbridges print in whatever format they like:
 *
 *   MHIPL MBT gate slip   — labels "Gross weight" / "Tare weight", but the only
 *                           timestamps are "Date time In / Out" for the visit
 *                           as a whole, not per reading. Timestamp ordering
 *                           yields UNKNOWN.
 *   PROCON RMC slip       — labels "First Weight" / "Second Weight" with a
 *                           timestamp on each, and never says gross or tare at
 *                           all. Gross/tare keyword parsing yields nothing.
 *
 * Neither format is unusual and neither is fully readable by a single-slip
 * classifier. But a trip has exactly two ends, so once BOTH slips for an LR are
 * present they resolve each other.
 *
 * Two independent pairwise rules, both structural:
 *
 *   CHRONOLOGY — the origin weighing necessarily happens before the destination
 *                weighing. The earlier slip is the origin one.
 *
 *   MONOTONICITY — cement does not gain mass in transit. The heavier net
 *                  reading is the origin one.
 *
 * When both rules fire and agree, confidence is high. When they disagree,
 * something is wrong with the data and the pair is flagged rather than
 * resolved — a disagreement usually means the two slips are from different
 * trips that got grouped together.
 *
 * ── Sample bundle (LR MH/DR/LR/26-27/1391, invoice MHQS001647) ───────────────
 *
 *   MHIPL gate  12 May 19:01, net 34,730 kg  → earlier + heavier → ORIGIN
 *   PROCON RMC  13 May 23:23, net 34,710 kg  → later + lighter   → DESTINATION
 *
 * Both rules agree. Shortage: 20 kg. Note the PROCON readings straddle midnight
 * (first 13 May 23:23, second 14 May 00:50), which is why date-only comparison
 * is never used here.
 */

import type { WeighmentPoint } from './weighmentClassifier.js';

export interface WeighmentSlipInput {
  documentId: string;
  /** Net weight in kg. */
  netKg: number | null;
  /**
   * Best available timestamp for the weighing, ms epoch. Prefer the first
   * reading's timestamp; fall back to a gate "time in", then the document date.
   */
  weighedAtMs: number | null;
  /** Whatever the single-slip classifier concluded, if anything. */
  priorPoint?: WeighmentPoint;
  priorConfidence?: number;
}

export interface ResolvedSlip {
  documentId: string;
  point: WeighmentPoint;
  confidence: number;
  basis: 'chronology+weight' | 'chronology' | 'weight' | 'prior' | 'unresolved';
}

export interface PairResolution {
  slips: ResolvedSlip[];
  /** Populated when the pair could not be resolved coherently. */
  issue?: string;
}

/**
 * A single-slip classification is trusted as-is at or above this confidence
 * (i.e. it came from per-reading timestamp ordering). Below it, the pairwise
 * rules take over.
 */
const TRUST_PRIOR_THRESHOLD = 0.9;

/**
 * Minimum weight gap, in kg, before the monotonicity rule is willing to call a
 * winner. Two readings within this of each other are indistinguishable given
 * weighbridge resolution, so the rule abstains rather than guessing.
 */
const MONOTONICITY_MIN_GAP_KG = 15;

/**
 * Resolve origin vs destination across all weighment slips linked to one LR.
 *
 * Handles the common cases and refuses the ambiguous ones:
 *
 *   0 slips  → nothing to do
 *   1 slip   → the pairwise rules need two; keep whatever the single-slip
 *              classifier said
 *   2 slips  → apply chronology and monotonicity
 *   3+ slips → too many for a two-ended trip; flag rather than guess, since
 *              this usually means documents from two trips share a group
 */
export function resolveWeighmentPair(slips: WeighmentSlipInput[]): PairResolution {
  if (slips.length === 0) return { slips: [] };

  const keepPrior = (s: WeighmentSlipInput): ResolvedSlip => ({
    documentId: s.documentId,
    point: s.priorPoint ?? 'UNKNOWN',
    confidence: s.priorConfidence ?? 0,
    basis: s.priorPoint && s.priorPoint !== 'UNKNOWN' ? 'prior' : 'unresolved',
  });

  if (slips.length === 1) {
    return { slips: [keepPrior(slips[0]!)] };
  }

  if (slips.length > 2) {
    return {
      slips: slips.map(keepPrior),
      issue:
        `${slips.length} weighment slips are linked to this trip, but a trip has ` +
        `two ends. This usually means documents from two separate trips have been ` +
        `grouped together. Origin/destination was not auto-assigned — please review.`,
    };
  }

  const [a, b] = slips as [WeighmentSlipInput, WeighmentSlipInput];

  // A high-confidence single-slip result (per-reading timestamp ordering) is
  // better evidence than either pairwise rule — it read the actual sequence off
  // the slip. Trust it and mirror the other slip to the opposite end.
  for (const [known, other] of [
    [a, b],
    [b, a],
  ] as const) {
    if (
      (known.priorConfidence ?? 0) >= TRUST_PRIOR_THRESHOLD &&
      (known.priorPoint === 'ORIGIN' || known.priorPoint === 'DESTINATION')
    ) {
      const opposite: WeighmentPoint = known.priorPoint === 'ORIGIN' ? 'DESTINATION' : 'ORIGIN';
      return {
        slips: [
          { documentId: known.documentId, point: known.priorPoint, confidence: known.priorConfidence!, basis: 'prior' },
          { documentId: other.documentId, point: opposite, confidence: 0.9, basis: 'prior' },
        ],
      };
    }
  }

  // ── Chronology ─────────────────────────────────────────────────────────────
  let byTime: { originId: string; destinationId: string } | null = null;
  if (a.weighedAtMs != null && b.weighedAtMs != null && a.weighedAtMs !== b.weighedAtMs) {
    byTime =
      a.weighedAtMs < b.weighedAtMs
        ? { originId: a.documentId, destinationId: b.documentId }
        : { originId: b.documentId, destinationId: a.documentId };
  }

  // ── Monotonicity ───────────────────────────────────────────────────────────
  let byWeight: { originId: string; destinationId: string } | null = null;
  if (
    a.netKg != null &&
    b.netKg != null &&
    Math.abs(a.netKg - b.netKg) >= MONOTONICITY_MIN_GAP_KG
  ) {
    byWeight =
      a.netKg > b.netKg
        ? { originId: a.documentId, destinationId: b.documentId }
        : { originId: b.documentId, destinationId: a.documentId };
  }

  const assign = (
    r: { originId: string; destinationId: string },
    confidence: number,
    basis: ResolvedSlip['basis'],
  ): PairResolution => ({
    slips: [
      { documentId: r.originId, point: 'ORIGIN', confidence, basis },
      { documentId: r.destinationId, point: 'DESTINATION', confidence, basis },
    ],
  });

  if (byTime && byWeight) {
    if (byTime.originId === byWeight.originId) {
      // Both structural rules agree — as strong as this gets without reading
      // the sequence directly off a single slip.
      return assign(byTime, 0.93, 'chronology+weight');
    }
    // The later slip is HEAVIER. Cement doesn't gain mass, so one of these
    // slips does not belong to this trip. Don't pick a side.
    return {
      slips: slips.map(keepPrior),
      issue:
        `The later weighment reading is heavier than the earlier one ` +
        `(${a.netKg} kg and ${b.netKg} kg). A load cannot gain weight in transit, ` +
        `so these two slips probably belong to different trips. ` +
        `Origin/destination was not auto-assigned — please review.`,
    };
  }

  if (byTime) return assign(byTime, 0.85, 'chronology');
  if (byWeight) return assign(byWeight, 0.75, 'weight');

  return {
    slips: slips.map(keepPrior),
    issue:
      'Two weighment slips are linked to this trip but neither carries a usable ' +
      'timestamp or a distinguishable net weight, so origin and destination could ' +
      'not be told apart. Please assign them manually.',
  };
}
