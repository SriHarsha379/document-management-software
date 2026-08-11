/**
 * Weight-based LR matching for weighment slips.
 *
 * Weighment slips are the hardest document to link: unlike the invoice (which
 * prints an invoice number) and the LR (which prints both), a weighbridge
 * ticket carries only a vehicle number, a timestamp, and three weights. It has
 * no reference to the LR or the invoice at all.
 *
 * But the net weight IS the consignment quantity. From a real bundle:
 *
 *   Tax invoice quantity      : 34.690 MT
 *   Party weighment (origin)  : gross 50180, tare 15490, net 34690 kg  → exact
 *   Site weighment (dest.)    : gross 50130, tare 15450, net 34680 kg  → -10 kg
 *
 * So net weight, converted to MT, is a strong discriminator against
 * `Lr.quantityInMt` — strong enough to pick between two trips by the same
 * vehicle on the same day, which the vehicle+date fallback cannot do.
 *
 * The tolerance has to absorb two real effects:
 *   - genuine transit loss / spillage on bulk cement (tens of kg)
 *   - calibration drift between two different weighbridges (origin gate vs a
 *     third-party bridge at the delivery site)
 * while staying far tighter than the gap between two different truckloads.
 */

import { parseNetWeightKg } from './reconciliationService.js';
import type { WeighmentPoint } from './weighmentClassifier.js';

/**
 * Relative tolerance for an ORIGIN reading compared against the declared LR
 * quantity: 0.5%. Loading is a controlled operation — a large gap here is a
 * data error, not transit loss.
 */
export const WEIGHT_TOLERANCE_PCT = 0.005;

/**
 * Relative tolerance for a DESTINATION reading: 2%.
 *
 * A destination slip must never be held to the origin tolerance. Real bundle
 * (LR MH/DR/LR/25-26/2532): declared 30.120 MT, ACM Readymix destination net
 * 29,890 kg — a 230 kg shortage, which under the 250 kg origin tolerance
 * linked with only 20 kg to spare. A 1% shortage (301 kg) would have failed to
 * link entirely.
 *
 * That failure mode is backwards: the slip that fails to link is precisely the
 * one documenting the shortage claim — the commercially important document.
 * Shortage is a business outcome to MEASURE AND REPORT, never a reason to
 * refuse the link.
 */
export const DESTINATION_WEIGHT_TOLERANCE_PCT = 0.02;

/**
 * Absolute floor on the tolerance, in kg. Prevents the relative tolerance from
 * becoming uselessly tight on small loads — a 5 MT load would otherwise get a
 * 25 kg window, which is inside normal weighbridge resolution.
 */
export const WEIGHT_TOLERANCE_MIN_KG = 250;

/** Absolute floor for the wider destination window. */
export const DESTINATION_WEIGHT_TOLERANCE_MIN_KG = 500;

/**
 * The tolerance window in kg for a given declared quantity.
 * Whichever of (relative, absolute floor) is larger.
 *
 * Pass the weighment point so a destination reading gets the wider window that
 * absorbs genuine transit loss.
 */
export function weightToleranceKg(
  declaredQuantityMt: number,
  point: WeighmentPoint = 'ORIGIN',
): number {
  const [pct, floor] =
    point === 'DESTINATION'
      ? [DESTINATION_WEIGHT_TOLERANCE_PCT, DESTINATION_WEIGHT_TOLERANCE_MIN_KG]
      : [WEIGHT_TOLERANCE_PCT, WEIGHT_TOLERANCE_MIN_KG];
  return Math.max(declaredQuantityMt * 1000 * pct, floor);
}

/**
 * True when a weighbridge net reading is consistent with a declared LR
 * quantity.
 *
 * PREFER `destinationMatchesOrigin` when an origin reading is already on the
 * Lr — comparing destination-to-origin isolates transit loss, whereas
 * comparing destination-to-invoice conflates transit loss with any
 * loading-side discrepancy.
 */
export function weightMatches(
  netWeightKg: number,
  declaredQuantityMt: number,
  point: WeighmentPoint = 'ORIGIN',
): boolean {
  if (!Number.isFinite(netWeightKg) || !Number.isFinite(declaredQuantityMt)) return false;
  if (netWeightKg <= 0 || declaredQuantityMt <= 0) return false;
  const declaredKg = declaredQuantityMt * 1000;
  return Math.abs(netWeightKg - declaredKg) <= weightToleranceKg(declaredQuantityMt, point);
}

/**
 * Compare a destination reading against the ORIGIN reading already recorded on
 * the Lr, rather than against the invoice. This is the correct comparison for
 * a destination slip: it measures transit loss and nothing else.
 */
export function destinationMatchesOrigin(
  destinationNetKg: number,
  originNetKg: number,
): boolean {
  if (!Number.isFinite(destinationNetKg) || !Number.isFinite(originNetKg)) return false;
  if (destinationNetKg <= 0 || originNetKg <= 0) return false;
  const tolerance = Math.max(
    originNetKg * DESTINATION_WEIGHT_TOLERANCE_PCT,
    DESTINATION_WEIGHT_TOLERANCE_MIN_KG,
  );
  return Math.abs(destinationNetKg - originNetKg) <= tolerance;
}

/**
 * Tare readings from two independent bridges on the same trip should agree
 * closely — the truck is the same truck. A large gap means a different vehicle,
 * a different trip, or a fuel/driver change worth noting.
 *
 * Used as a CONFIRMING signal only. Never link on tare alone: many trucks in a
 * fleet share a similar unladen weight.
 */
export function taresAgree(tareA: number, tareB: number, toleranceKg = 100): boolean {
  if (!Number.isFinite(tareA) || !Number.isFinite(tareB)) return false;
  return Math.abs(tareA - tareB) <= toleranceKg;
}

/**
 * How far off the reading is, in kg. Used to rank candidates when more than
 * one LR falls inside the tolerance window.
 */
export function weightDeviationKg(netWeightKg: number, declaredQuantityMt: number): number {
  return Math.abs(netWeightKg - declaredQuantityMt * 1000);
}

export interface WeightCandidate {
  lrId: string;
  quantityInMt: number | null;
  /**
   * Origin weighbridge net already recorded on this Lr, when one has been
   * linked. Lets a destination slip be compared against the actual loaded
   * weight rather than the declared quantity.
   */
  originNetWeightKg?: number | null;
}

export interface WeightMatchOutcome {
  lrId: string;
  deviationKg: number;
  /** True when a second candidate also fell inside the tolerance window. */
  contested: boolean;
}

/**
 * Pick the single best LR for a weighbridge reading.
 *
 * Returns null when nothing matches, or when two candidates match so closely
 * that choosing between them would be a guess. "So closely" is defined as the
 * runner-up being within 50 kg of the winner — at that point the two LRs are
 * for practical purposes the same load and only a human (or a seal number) can
 * separate them.
 *
 * Callers should downgrade confidence when `contested` is true.
 */
export function selectByWeight(
  netWeightKg: number,
  candidates: WeightCandidate[],
  point: WeighmentPoint = 'ORIGIN',
): WeightMatchOutcome | null {
  const AMBIGUITY_MARGIN_KG = 50;

  const scored = candidates
    .filter((c): c is WeightCandidate & { quantityInMt: number } => c.quantityInMt != null)
    .filter((c) => {
      // When the Lr already carries an origin reading, compare a destination
      // slip against THAT instead of the declared quantity.
      if (point === 'DESTINATION' && c.originNetWeightKg != null) {
        return destinationMatchesOrigin(netWeightKg, c.originNetWeightKg);
      }
      return weightMatches(netWeightKg, c.quantityInMt, point);
    })
    .map((c) => ({ lrId: c.lrId, deviationKg: weightDeviationKg(netWeightKg, c.quantityInMt) }))
    .sort((a, b) => a.deviationKg - b.deviationKg);

  if (scored.length === 0) return null;

  const best = scored[0]!;
  const runnerUp = scored[1];

  if (runnerUp && runnerUp.deviationKg - best.deviationKg < AMBIGUITY_MARGIN_KG) {
    // Two loads of effectively identical weight — refuse to guess.
    return null;
  }

  return {
    lrId: best.lrId,
    deviationKg: best.deviationKg,
    contested: scored.length > 1,
  };
}

/**
 * Convenience wrapper: parse a raw `weightInfo` string straight off an
 * ExtractedData row and select the best LR from it.
 *
 * `weightInfo` is free text produced by OCR, e.g.
 * "Gross weight: 50180.00 Kgs, Tare weight: 15490.00 Kgs, Net weight: 34690.00 Kgs".
 * `parseNetWeightKg` handles the labelled form and falls back to gross-minus-tare.
 */
export function selectByWeightInfo(
  weightInfo: string | null | undefined,
  candidates: WeightCandidate[],
  point: WeighmentPoint = 'ORIGIN',
): WeightMatchOutcome | null {
  const netKg = parseNetWeightKg(weightInfo);
  if (netKg === null) return null;
  return selectByWeight(netKg, candidates, point);
}
