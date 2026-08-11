/**
 * Tests for weighment point/owner classification and the two-stage weight
 * tolerance.
 *
 * Fixtures come from LR MH/DR/LR/25-26/2532 (invoice MHPS003248), which has
 * both a party-owned destination bridge (ACM Readymix, Panvel) and our own
 * origin bridge (Gupta Weigh Bridge, Dronagiri) on the same trip — the exact
 * scenario that the old DocumentType-only classification got wrong.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyByTimestampOrder,
  classifyWeighment,
  namesOverlap,
  reconcileSlipArithmetic,
} from '../services/weighmentClassifier.js';
import {
  weightMatches,
  weightToleranceKg,
  destinationMatchesOrigin,
  taresAgree,
  selectByWeight,
} from '../services/weightMatching.js';

// ── Fixtures from the real bundle ────────────────────────────────────────────

const ACM = {
  bridgeName: 'ACM READYMIX',
  bridgeLocation: 'SHELGHAR PANVEL, GAVHAN, PATALGANGA',
  grossAtMs: Date.parse('2026-03-30T08:07:00Z'),
  tareAtMs: Date.parse('2026-03-30T09:12:00Z'),
  grossKg: 43450,
  tareKg: 13560,
  netKg: 29890,
  statedDiffKg: -230,
};

const GUPTA = {
  bridgeName: 'GUPTA WEIGH BRIDGE',
  bridgeLocation: 'Sector 2, Dronagiri, Navasheva',
  grossAtMs: Date.parse('2026-03-30T00:00:00Z'),
  tareAtMs: Date.parse('2026-03-29T00:00:00Z'),
  grossKg: 43660,
  tareKg: 13560,
  netKg: 30130,
};

const LR = {
  quantityInMt: 30.12,
  shipToParty: 'ACM READMIX - PANVEL',
  billToParty: 'MUMBAIKAR ENTERPRISES',
  transporterName: 'VISION REAL VENTURES LLP',
  fromDestination: 'DRONAGIRI',
  toDestination: 'PANVEL',
};

describe('classifyByTimestampOrder', () => {
  it('reads gross-then-tare as a destination weighing', () => {
    // Truck arrives full, unloads, is weighed empty.
    expect(classifyByTimestampOrder(ACM.grossAtMs, ACM.tareAtMs)).toBe('DESTINATION');
  });

  it('reads tare-then-gross as an origin weighing', () => {
    // Truck arrives empty, is weighed, loads, is weighed again. Note the tare
    // here was taken the day BEFORE the trip — legitimate, and the reason the
    // DocumentGroup window is bidirectional.
    expect(classifyByTimestampOrder(GUPTA.grossAtMs, GUPTA.tareAtMs)).toBe('ORIGIN');
  });

  it('refuses to guess when a timestamp is missing', () => {
    expect(classifyByTimestampOrder(ACM.grossAtMs, null)).toBe('UNKNOWN');
    expect(classifyByTimestampOrder(null, null)).toBe('UNKNOWN');
  });

  it('refuses to guess on a single-pass bridge', () => {
    // Equal timestamps carry no directional signal. Guessing would invert the
    // shortage half the time.
    expect(classifyByTimestampOrder(ACM.grossAtMs, ACM.grossAtMs)).toBe('UNKNOWN');
  });
});

describe('namesOverlap', () => {
  it('matches a letterhead against a longer party name', () => {
    // Exact prefix — plain containment.
    expect(namesOverlap('ACM READMIX', 'ACM READMIX - PANVEL')).toBe(true);
  });

  it('tolerates the misspelling between the slip and the LR', () => {
    // The weighbridge letterhead says READYMIX; the LR says READMIX. One
    // character apart, so containment alone fails and the party-owned bridge
    // was being misread as a neutral commercial one.
    expect(namesOverlap('ACM READYMIX', 'ACM READMIX - PANVEL')).toBe(true);
  });

  it('does not match two genuinely different parties', () => {
    expect(namesOverlap('ACM READYMIX', 'MUMBAIKAR ENTERPRISES')).toBe(false);
    expect(namesOverlap('BALAJI BUILDMAT', 'BALAJI TRANSPORT')).toBe(false);
  });

  it('ignores corporate suffixes', () => {
    expect(namesOverlap('VISION REAL VENTURES LLP', 'Vision Real Ventures')).toBe(true);
  });

  it('rejects short or empty tokens', () => {
    expect(namesOverlap('AB', 'ABCDEF')).toBe(false);
    expect(namesOverlap('', 'ACM READYMIX')).toBe(false);
    expect(namesOverlap(null, undefined)).toBe(false);
  });
});

describe('classifyWeighment', () => {
  it('classifies the party-owned destination slip on both axes', () => {
    const r = classifyWeighment({ ...ACM, ...LR, documentType: 'WEIGHMENT' });
    expect(r.point).toBe('DESTINATION');
    expect(r.pointBasis).toBe('timestampOrder');
    expect(r.pointConfidence).toBeGreaterThanOrEqual(0.9);
    expect(r.owner).toBe('PARTY');
  });

  it('classifies our own origin slip as a third-party commercial bridge', () => {
    // Gupta is a commercial weighbridge — neither us nor the buyer. OWNER and
    // POINT are genuinely independent here, which is the whole point of the
    // split.
    const r = classifyWeighment({ ...GUPTA, ...LR, documentType: 'WEIGHMENT' });
    expect(r.point).toBe('ORIGIN');
    expect(r.owner).toBe('THIRD_PARTY');
  });

  it('falls back to DocumentType at low confidence when nothing else is known', () => {
    const r = classifyWeighment({ documentType: 'WEIGHMENT_SITE' });
    expect(r.point).toBe('DESTINATION');
    expect(r.pointBasis).toBe('documentType');
    expect(r.pointConfidence).toBeLessThan(0.7); // → review queue
  });

  it('never lets ownership decide the custody point', () => {
    // A party-owned bridge used at ORIGIN must still classify as ORIGIN.
    const r = classifyWeighment({
      bridgeName: 'ACM READMIX',
      grossAtMs: Date.parse('2026-03-30T10:00:00Z'),
      tareAtMs: Date.parse('2026-03-30T09:00:00Z'), // tare first → origin
      ...LR,
    });
    expect(r.point).toBe('ORIGIN');
    expect(r.owner).toBe('PARTY');
  });
});

describe('two-stage weight tolerance', () => {
  it('holds an origin reading to the tight window', () => {
    expect(weightToleranceKg(LR.quantityInMt, 'ORIGIN')).toBe(250);
    expect(weightMatches(GUPTA.netKg, LR.quantityInMt, 'ORIGIN')).toBe(true);
  });

  it('gives a destination reading room for transit loss', () => {
    expect(weightToleranceKg(LR.quantityInMt, 'DESTINATION')).toBeCloseTo(602.4, 1);
  });

  it('links a 1% shortage that the old single tolerance would have dropped', () => {
    // THE BUG: 30.12 MT declared, 1% short = 29819 kg. Under the old 250 kg
    // origin tolerance this failed to link — and the slip that fails to link
    // is precisely the one documenting the shortage claim.
    const oneepercentShort = 29819;
    expect(weightMatches(oneepercentShort, LR.quantityInMt, 'ORIGIN')).toBe(false);
    expect(weightMatches(oneepercentShort, LR.quantityInMt, 'DESTINATION')).toBe(true);
  });

  it('still rejects a genuinely different truckload', () => {
    expect(weightMatches(24000, LR.quantityInMt, 'DESTINATION')).toBe(false);
  });
});

describe('destinationMatchesOrigin', () => {
  it('matches the real destination reading against the real origin reading', () => {
    // 30130 → 29890 is a 240 kg loss. This comparison isolates transit loss
    // rather than conflating it with any loading-side discrepancy.
    expect(destinationMatchesOrigin(ACM.netKg, GUPTA.netKg)).toBe(true);
  });

  it('rejects a load that lost a implausible amount', () => {
    expect(destinationMatchesOrigin(24000, GUPTA.netKg)).toBe(false);
  });
});

describe('taresAgree', () => {
  it('confirms both bridges weighed the same truck', () => {
    // Both slips print tare 13560 — strong same-truck evidence.
    expect(taresAgree(GUPTA.tareKg, ACM.tareKg)).toBe(true);
  });

  it('flags a different vehicle', () => {
    expect(taresAgree(13560, 15490)).toBe(false);
  });
});

describe('reconcileSlipArithmetic', () => {
  it('accepts a slip whose printed net matches gross minus tare', () => {
    const r = reconcileSlipArithmetic(ACM.grossKg, ACM.tareKg, ACM.netKg);
    expect(r.netKg).toBe(29890);
    expect(r.needsReview).toBe(false);
  });

  it('prefers the arithmetic over a misread printed net, and flags it', () => {
    // Faded thermal print misread as 30150 when gross-tare says 30100.
    // (30120 would be exactly on the 20 kg tolerance boundary, which is
    // accepted by design — the disagreement has to EXCEED the threshold.)
    const r = reconcileSlipArithmetic(43660, 13560, 30150);
    expect(r.netKg).toBe(30100);
    expect(r.needsReview).toBe(true);
    expect(r.note).toContain('verify');
  });

  it('falls back to arithmetic when the net is unreadable', () => {
    const r = reconcileSlipArithmetic(GUPTA.grossKg, GUPTA.tareKg, null);
    expect(r.netKg).toBe(30100);
    expect(r.needsReview).toBe(false);
  });

  it('reports needsReview when nothing usable is present', () => {
    const r = reconcileSlipArithmetic(null, null, null);
    expect(r.netKg).toBeNull();
    expect(r.needsReview).toBe(true);
  });
});

describe('selectByWeight with an origin reading already on the Lr', () => {
  it('compares a destination slip against the origin, not the invoice', () => {
    const result = selectByWeight(
      ACM.netKg,
      [{ lrId: 'lr-1', quantityInMt: LR.quantityInMt, originNetWeightKg: GUPTA.netKg }],
      'DESTINATION',
    );
    expect(result?.lrId).toBe('lr-1');
  });

  it('still works before any origin slip has arrived', () => {
    const result = selectByWeight(
      ACM.netKg,
      [{ lrId: 'lr-1', quantityInMt: LR.quantityInMt, originNetWeightKg: null }],
      'DESTINATION',
    );
    expect(result?.lrId).toBe('lr-1');
  });
});