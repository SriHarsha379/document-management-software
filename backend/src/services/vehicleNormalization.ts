/**
 * Vehicle Number Normalisation
 *
 * Indian registration plates are the single most OCR-fragile join key in the
 * pipeline. The same truck legitimately appears as:
 *
 *   "MH47AS3999"      (tax invoice, laser print)
 *   "MH-47-AS-3999"   (lorry receipt, laser print)
 *   "MH 47 AS 3999"   (gate weighment slip, dot-matrix)
 *   "MH47A53999"      (site weighbridge, thermal print — S misread as 5)
 *
 * The previous normaliser only uppercased and stripped whitespace, so the
 * last two produced different keys from the first. Because DocumentGroup is
 * uniquely keyed on (vehicleNo, date) and the ±3-day tolerance search does an
 * *exact* equality lookup on vehicleNo, a single misread character silently
 * created a second group — which is what put one LR number on two rows of the
 * Bundle table.
 *
 * Two levels are provided:
 *
 *   normalizeVehicleNo()  — lossless-ish: uppercase, strip all non-alphanumerics.
 *                           Safe for DISPLAY-adjacent use and for the existing
 *                           unique key. Never collapses characters.
 *
 *   canonicalVehicleNo()  — lossy: additionally folds the OCR-confusable
 *                           character pairs (O/0, I/1, B/8, S/5, Z/2, G/6,
 *                           Q/0) to a single representative. This is a
 *                           MATCHING key only. It must never be shown to a
 *                           user or written back over the raw OCR value,
 *                           because "MH47A53999" and "MH47AS3999" both
 *                           canonicalise to the same string and you cannot
 *                           recover which was real.
 *
 * Store the canonical form in a SEPARATE indexed column alongside the raw
 * value. Match on canonical, display raw.
 */

/**
 * Uppercase and strip every character that isn't A-Z or 0-9.
 *
 * Handles spaces, hyphens, dots, slashes and the stray punctuation OCR emits
 * around plate text. Does not alter any alphanumeric character, so this is
 * safe to use as a stable storage key.
 */
export function normalizeVehicleNo(v: string): string {
  return v.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Character folding table for the confusions that actually occur on Indian
 * plates rendered by dot-matrix and thermal printers, then photographed or
 * scanned.
 *
 * Each pair folds to the DIGIT where a digit is available, because the
 * numeric portion of a plate is longer than the alphabetic portion and
 * therefore digits dominate. The choice of representative is arbitrary as
 * long as it is applied consistently.
 */
const OCR_CONFUSION_FOLDING: ReadonlyArray<readonly [RegExp, string]> = [
  [/[O0Q]/g, '0'],
  [/[I1L]/g, '1'],
  [/[B8]/g, '8'],
  [/[S5]/g, '5'],
  [/[Z2]/g, '2'],
  [/[G6]/g, '6'],
];

/**
 * Produce the lossy matching key for a vehicle number.
 *
 * MATCHING USE ONLY. Never display this value, never write it into a field a
 * human reads, and never use it to populate the raw `vehicleNo` column.
 *
 * Example: all four of these return "MH47A53999":
 *   "MH47AS3999", "MH-47-AS-3999", "MH 47 A5 3999", "mh47as3999"
 */
export function canonicalVehicleNo(v: string): string {
  let out = normalizeVehicleNo(v);
  for (const [pattern, replacement] of OCR_CONFUSION_FOLDING) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * True when two vehicle numbers refer to the same truck, tolerating the OCR
 * confusions above.
 *
 * Deliberately NOT a fuzzy/edit-distance comparison. Edit distance on plates
 * is dangerous: "MH47AS3999" and "MH47AS3998" are one edit apart and are two
 * different trucks. Only the specific, known-confusable character classes are
 * folded; everything else must match exactly.
 */
export function vehicleNumbersMatch(a: string, b: string): boolean {
  const ca = canonicalVehicleNo(a);
  const cb = canonicalVehicleNo(b);
  // Length must agree — a dropped or hallucinated character is a genuine
  // mismatch, not an OCR confusion we're willing to forgive.
  if (ca.length !== cb.length) return false;
  return ca === cb;
}

/**
 * Basic plausibility check for an Indian registration plate.
 *
 * Standard format: 2 letters (state) + 1-2 digits (RTO) + 1-3 letters (series)
 * + 4 digits (unique). Some older and some BH-series plates deviate, so this
 * is used only to decide whether a value is trustworthy enough to key a
 * DocumentGroup on — not to reject the value outright.
 *
 * Runs against the NORMALISED form, not the canonical one: canonicalisation
 * turns letters into digits and would break the pattern.
 */
export function isPlausibleVehicleNo(v: string): boolean {
  const n = normalizeVehicleNo(v);
  if (n.length < 8 || n.length > 11) return false;
  return /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/.test(n);
}
