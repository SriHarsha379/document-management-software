/**
 * Weighment Slip Classification
 *
 * Splits the two axes that `DocumentType` currently conflates:
 *
 *   POINT — was this weighed at ORIGIN (loading) or DESTINATION (unloading)?
 *   OWNER — was it OUR bridge, the PARTY's, or a neutral THIRD_PARTY one?
 *
 * They coincide often enough to be mistaken for one thing (our bridge at the
 * loading point, the buyer's bridge at their plant) but they are independent:
 * a commercial weighbridge can be used at either end, and a buyer with a bridge
 * at the loading depot can weigh at origin.
 *
 * POINT drives arithmetic — which reading is the "before" and which the
 * "after" in the shortage calculation. Getting it wrong doesn't just mislabel
 * a column, it inverts the variance.
 *
 * OWNER drives commercial disputes — when there's a shortage claim, whose scale
 * produced the number determines how much weight it carries in a negotiation.
 * It is irrelevant to the arithmetic and must never influence POINT.
 *
 * ── Why timestamp ordering is the primary signal ─────────────────────────────
 *
 * It's structural rather than cosmetic. At origin the truck arrives empty, is
 * weighed (tare), loads, is weighed again (gross) — TARE PRECEDES GROSS. At
 * destination it arrives full (gross), unloads, is weighed empty (tare) —
 * GROSS PRECEDES TARE.
 *
 * That holds regardless of who owns the bridge, what the letterhead says, or
 * whether OCR read the company name correctly. Name and location matching are
 * fallbacks, used only when the slip doesn't carry both timestamps.
 *
 * Real example (LR MH/DR/LR/25-26/2532):
 *   ACM Readymix : gross 30 Mar 08:07, tare 30 Mar 09:12  → gross first → DESTINATION
 *   Gupta        : gross 30-03-2026,   tare 29-03-2026    → tare first  → ORIGIN
 *
 * Note the Gupta tare was taken the day BEFORE the trip — which is exactly the
 * case the bidirectional ±3-day DocumentGroup window exists to absorb.
 */

export type WeighmentPoint = 'ORIGIN' | 'DESTINATION' | 'UNKNOWN';
export type WeighmentOwner = 'OWN' | 'PARTY' | 'THIRD_PARTY' | 'UNKNOWN';

export interface WeighmentClassification {
  point: WeighmentPoint;
  owner: WeighmentOwner;
  /** 0–1. How much to trust `point`. Below 0.7 → send to manual review. */
  pointConfidence: number;
  /** Which rule decided `point`, for display in the review queue. */
  pointBasis:
    | 'timestampOrder'
    | 'firstSecondWeight'
    | 'partyNameMatch'
    | 'locationMatch'
    | 'documentType'
    | 'none';
}

/**
 * Decide ORIGIN vs DESTINATION from a slip that labels its readings
 * "First Weight" / "Second Weight" instead of gross / tare.
 *
 * PROCON RMC and many third-party bridges print it this way, with no gross or
 * tare keyword anywhere on the ticket. The sequence is still recoverable, and
 * it's arguably a cleaner signal than the gross/tare labels because it records
 * what actually happened rather than what the operator classified it as:
 *
 *   first reading HEAVIER than second → truck arrived loaded → DESTINATION
 *   first reading LIGHTER than second → truck arrived empty  → ORIGIN
 *
 * Sample: PROCON prints first 50,140 kg then second 15,430 kg → arrived loaded
 * → DESTINATION. Correct.
 *
 * Requires a gap of at least 1000 kg. Two readings closer than that are not a
 * loaded/empty pair, so the slip is something this rule can't interpret.
 */
export function classifyByFirstSecondWeight(
  firstWeightKg: number | null | undefined,
  secondWeightKg: number | null | undefined,
): WeighmentPoint {
  if (firstWeightKg == null || secondWeightKg == null) return 'UNKNOWN';
  if (!Number.isFinite(firstWeightKg) || !Number.isFinite(secondWeightKg)) return 'UNKNOWN';
  if (Math.abs(firstWeightKg - secondWeightKg) < 1000) return 'UNKNOWN';
  return firstWeightKg > secondWeightKg ? 'DESTINATION' : 'ORIGIN';
}

/**
 * Decide ORIGIN vs DESTINATION from the order of the two weighbridge readings.
 *
 * Returns UNKNOWN when either timestamp is missing or the two are equal —
 * equal timestamps mean a single-pass bridge that reused one reading, which
 * carries no directional signal at all. Guessing there would be worse than
 * admitting ignorance, because the guess feeds straight into a shortage figure.
 */
export function classifyByTimestampOrder(
  grossAtMs: number | null | undefined,
  tareAtMs: number | null | undefined,
): WeighmentPoint {
  if (grossAtMs == null || tareAtMs == null) return 'UNKNOWN';
  if (grossAtMs === tareAtMs) return 'UNKNOWN';
  return tareAtMs < grossAtMs ? 'ORIGIN' : 'DESTINATION';
}

/** Reduce a company/place name to a comparable token for loose matching. */
function nameToken(s: string): string {
  return s
    .toUpperCase()
    .replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|ENTERPRISES|INDUSTRIES|COMPANY|CO)\b/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * True when two names plausibly refer to the same organisation or place.
 *
 * Containment rather than equality, because a weighbridge letterhead
 * ("ACM READYMIX") is routinely a prefix of the LR's ship-to party
 * ("ACM READMIX - PANVEL"), and vice versa. Requires at least 4 significant
 * characters so that short tokens don't produce accidental hits.
 */
/**
 * Levenshtein distance, capped for early exit.
 *
 * Used ONLY for organisation and place names — never for vehicle numbers or
 * reference numbers, where a one-character difference is a different entity.
 */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      curr.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length]!;
}

/**
 * True when two names plausibly refer to the same organisation or place.
 *
 * Containment first: a weighbridge letterhead ("ACM READMIX") is routinely a
 * prefix of the LR's ship-to party ("ACM READMIX - PANVEL").
 *
 * Containment alone is not enough. In a real bundle the LR spells the
 * consignee READMIX while the slip spells it READYMIX — one character apart,
 * so neither contains the other, and a party-owned bridge was misclassified as
 * a neutral commercial one. Party names are typed by hand into several systems
 * and disagree constantly; strictness here loses the match without buying
 * safety.
 *
 * Guards against false positives: both tokens at least 8 characters, at most
 * 2 edits, and no more than 20% of the shorter token's length. At worst this
 * over-matches two similarly-named parties, which affects only
 * `weighmentOwner` — commercial metadata that never feeds the arithmetic.
 */
export function namesOverlap(a?: string | null, b?: string | null): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  const ta = nameToken(a);
  const tb = nameToken(b);
  if (ta.length < 4 || tb.length < 4) return false;

  if (ta.includes(tb) || tb.includes(ta)) return true;

  const MIN_FUZZY_LENGTH = 8;
  if (ta.length < MIN_FUZZY_LENGTH || tb.length < MIN_FUZZY_LENGTH) return false;

  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const maxEdits = Math.min(2, Math.floor(shorter.length * 0.2));
  if (maxEdits < 1) return false;

  for (let len = shorter.length - maxEdits; len <= shorter.length + maxEdits; len += 1) {
    if (len < MIN_FUZZY_LENGTH || len > longer.length) continue;
    if (editDistance(shorter, longer.slice(0, len), maxEdits) <= maxEdits) return true;
  }
  return false;
}


export interface WeighmentContext {
  /** First reading in kg, on slips that label readings First/Second. */
  firstWeightKg?: number | null;
  /** Second reading in kg, on slips that label readings First/Second. */
  secondWeightKg?: number | null;
  /** Weighbridge / letterhead name printed on the slip. */
  bridgeName?: string | null;
  /** Location printed on the slip, if any. */
  bridgeLocation?: string | null;
  /** Timestamp of the gross reading, ms. */
  grossAtMs?: number | null;
  /** Timestamp of the tare reading, ms. */
  tareAtMs?: number | null;
  /** `Lr.shipToParty` — the consignee. */
  shipToParty?: string | null;
  /** `Lr.billToParty` — the buyer. */
  billToParty?: string | null;
  /** `Lr.transporterName` — us, in most bundles. */
  transporterName?: string | null;
  /** LR "From Destination" — the loading point. */
  fromDestination?: string | null;
  /** LR "To Destination" — the delivery point. */
  toDestination?: string | null;
  /** Existing DocumentType, used only as a last-resort hint. */
  documentType?: string | null;
}

/**
 * Classify a weighment slip on both axes.
 *
 * Signals for POINT, strongest first:
 *   1. timestamp ordering                (structural, 0.95)
 *   1b. first/second reading magnitude   (structural, 0.93)
 *   2. bridge name matches the consignee → DESTINATION  (0.8)
 *   3. bridge location matches the LR's from/to destination  (0.75)
 *   4. the existing DocumentType  (0.5 — kept only for legacy rows)
 *
 * OWNER is decided independently and never influences POINT.
 */
export function classifyWeighment(ctx: WeighmentContext): WeighmentClassification {
  // ── POINT ──────────────────────────────────────────────────────────────────
  let point: WeighmentPoint = 'UNKNOWN';
  let pointConfidence = 0;
  let pointBasis: WeighmentClassification['pointBasis'] = 'none';

  const byTime = classifyByTimestampOrder(ctx.grossAtMs, ctx.tareAtMs);
  const byFirstSecond = classifyByFirstSecondWeight(ctx.firstWeightKg, ctx.secondWeightKg);

  if (byTime !== 'UNKNOWN') {
    point = byTime;
    pointConfidence = 0.95;
    pointBasis = 'timestampOrder';
  } else if (byFirstSecond !== 'UNKNOWN') {
    // Equally structural — it records the actual loaded/empty sequence.
    point = byFirstSecond;
    pointConfidence = 0.93;
    pointBasis = 'firstSecondWeight';
  } else if (namesOverlap(ctx.bridgeName, ctx.shipToParty)) {
    // The slip was printed by the consignee — they weigh on receipt.
    point = 'DESTINATION';
    pointConfidence = 0.8;
    pointBasis = 'partyNameMatch';
  } else if (
    namesOverlap(ctx.bridgeLocation, ctx.fromDestination) ||
    namesOverlap(ctx.bridgeName, ctx.fromDestination)
  ) {
    point = 'ORIGIN';
    pointConfidence = 0.75;
    pointBasis = 'locationMatch';
  } else if (
    namesOverlap(ctx.bridgeLocation, ctx.toDestination) ||
    namesOverlap(ctx.bridgeName, ctx.toDestination)
  ) {
    point = 'DESTINATION';
    pointConfidence = 0.75;
    pointBasis = 'locationMatch';
  } else if (ctx.documentType === 'WEIGHMENT_PARTY') {
    point = 'ORIGIN';
    pointConfidence = 0.5;
    pointBasis = 'documentType';
  } else if (ctx.documentType === 'WEIGHMENT_SITE') {
    point = 'DESTINATION';
    pointConfidence = 0.5;
    pointBasis = 'documentType';
  }

  // ── OWNER ──────────────────────────────────────────────────────────────────
  let owner: WeighmentOwner = 'UNKNOWN';
  if (namesOverlap(ctx.bridgeName, ctx.transporterName)) {
    owner = 'OWN';
  } else if (
    namesOverlap(ctx.bridgeName, ctx.shipToParty) ||
    namesOverlap(ctx.bridgeName, ctx.billToParty)
  ) {
    owner = 'PARTY';
  } else if (ctx.bridgeName?.trim()) {
    // A named bridge that matches nobody in the trip is a commercial one —
    // "GUPTA WEIGH BRIDGE" is neither us nor the buyer.
    owner = 'THIRD_PARTY';
  }

  return { point, owner, pointConfidence, pointBasis };
}

/**
 * Internal consistency check on a weighbridge slip.
 *
 * The printed net should equal gross minus tare. When it doesn't, the slip is
 * either misread (thermal prints fade badly — the Gupta slip in the sample
 * bundle is barely legible) or genuinely inconsistent, and the arithmetic is
 * the more trustworthy of the two.
 *
 * Returns the value to use plus whether the document needs a human look.
 */
export function reconcileSlipArithmetic(
  grossKg: number | null | undefined,
  tareKg: number | null | undefined,
  printedNetKg: number | null | undefined,
): { netKg: number | null; needsReview: boolean; note?: string } {
  const TOLERANCE_KG = 20;

  const computed =
    grossKg != null && tareKg != null && Number.isFinite(grossKg) && Number.isFinite(tareKg)
      ? grossKg - tareKg
      : null;

  if (computed === null) {
    return { netKg: printedNetKg ?? null, needsReview: printedNetKg == null };
  }
  if (printedNetKg == null) {
    return { netKg: computed, needsReview: false };
  }

  const delta = Math.abs(printedNetKg - computed);
  if (delta <= TOLERANCE_KG) {
    return { netKg: printedNetKg, needsReview: false };
  }

  // Trust the arithmetic over a possibly-misread printed figure, but flag it.
  return {
    netKg: computed,
    needsReview: true,
    note:
      `Printed net (${printedNetKg} kg) disagrees with gross − tare ` +
      `(${grossKg} − ${tareKg} = ${computed} kg) by ${Math.round(delta)} kg. ` +
      `Using the computed value; verify the slip.`,
  };
}
