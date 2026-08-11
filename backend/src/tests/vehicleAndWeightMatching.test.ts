/**
 * Tests for the two new matching primitives that fix the duplicate-bundle-row
 * bug: OCR-tolerant vehicle canonicalisation and weight-based LR selection.
 *
 * The fixtures are taken from a real bundle (invoice MHQS001701 /
 * LR MH/DR/LR/26-27/1435), because the failure mode only shows up with the
 * specific character confusions and weighbridge deltas that real Indian
 * logistics paperwork produces.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeVehicleNo,
  canonicalVehicleNo,
  vehicleNumbersMatch,
  isPlausibleVehicleNo,
} from '../services/vehicleNormalization.js';
import {
  weightMatches,
  weightToleranceKg,
  selectByWeight,
  WEIGHT_TOLERANCE_MIN_KG,
} from '../services/weightMatching.js';

describe('normalizeVehicleNo', () => {
  it('strips separators the old whitespace-only normaliser left behind', () => {
    // These three are the same truck on the invoice, the LR and the gate slip.
    expect(normalizeVehicleNo('MH47AS3999')).toBe('MH47AS3999');
    expect(normalizeVehicleNo('MH-47-AS-3999')).toBe('MH47AS3999');
    expect(normalizeVehicleNo('MH 47 AS 3999')).toBe('MH47AS3999');
    expect(normalizeVehicleNo('mh.47.as.3999')).toBe('MH47AS3999');
  });

  it('never alters an alphanumeric character', () => {
    // Lossless with respect to A-Z0-9 — safe as a storage key.
    expect(normalizeVehicleNo('MH47A53999')).toBe('MH47A53999');
  });
});

describe('canonicalVehicleNo', () => {
  it('folds the OCR confusions that fork DocumentGroups', () => {
    const expected = canonicalVehicleNo('MH47AS3999');
    // S misread as 5 on a thermal-printed weighbridge ticket.
    expect(canonicalVehicleNo('MH47A53999')).toBe(expected);
    // O/0 and B/8 confusions on a different plate.
    expect(canonicalVehicleNo('MH12OB1234')).toBe(canonicalVehicleNo('MH12081234'));
  });

  it('is idempotent', () => {
    const once = canonicalVehicleNo('MH47AS3999');
    expect(canonicalVehicleNo(once)).toBe(once);
  });
});

describe('vehicleNumbersMatch', () => {
  it('matches every rendering of the same truck across the bundle', () => {
    const renderings = ['MH47AS3999', 'MH-47-AS-3999', 'MH 47 AS 3999', 'MH47A53999'];
    for (const r of renderings) {
      expect(vehicleNumbersMatch('MH47AS3999', r)).toBe(true);
    }
  });

  it('does NOT match two genuinely different trucks', () => {
    // One digit apart. Edit-distance matching would wrongly merge these; the
    // confusion-class approach correctly keeps them separate because 8 and 9
    // are not a confusable pair.
    expect(vehicleNumbersMatch('MH47AS3999', 'MH47AS3998')).toBe(false);
  });

  it('rejects a dropped character rather than forgiving it', () => {
    expect(vehicleNumbersMatch('MH47AS3999', 'MH47AS399')).toBe(false);
  });
});

describe('isPlausibleVehicleNo', () => {
  it('accepts standard plates and rejects OCR garbage', () => {
    expect(isPlausibleVehicleNo('MH47AS3999')).toBe(true);
    expect(isPlausibleVehicleNo('MH 47 AS 3999')).toBe(true);
    expect(isPlausibleVehicleNo('READYMIX')).toBe(false);
    expect(isPlausibleVehicleNo('34690')).toBe(false);
  });
});

describe('weightMatches', () => {
  // Invoice declares 34.690 MT for this consignment.
  const DECLARED_MT = 34.69;

  it('accepts the origin weighbridge reading exactly', () => {
    // MHIPL security gate: gross 50180, tare 15490, net 34690 kg.
    expect(weightMatches(34690, DECLARED_MT)).toBe(true);
  });

  it('accepts the destination reading despite transit loss', () => {
    // Rockway weighbridge at site: net 34680 kg — 10 kg lighter.
    expect(weightMatches(34680, DECLARED_MT)).toBe(true);
  });

  it('rejects the challan quantity, which is nominal not weighed', () => {
    // The gate challan says 35000 — the ordered load, not a calibrated
    // reading. Matching on it would link the wrong document.
    expect(weightMatches(35000, DECLARED_MT)).toBe(false);
  });

  it('rejects a different truckload', () => {
    expect(weightMatches(32500, DECLARED_MT)).toBe(false);
  });

  it('applies the absolute floor on small loads', () => {
    // 5 MT * 0.5% = 25 kg, below weighbridge resolution — floor kicks in.
    expect(weightToleranceKg(5)).toBe(WEIGHT_TOLERANCE_MIN_KG);
    expect(weightMatches(5200, 5)).toBe(true);
  });

  it('rejects nonsense input rather than throwing', () => {
    expect(weightMatches(0, DECLARED_MT)).toBe(false);
    expect(weightMatches(NaN, DECLARED_MT)).toBe(false);
    expect(weightMatches(34690, 0)).toBe(false);
  });
});

describe('selectByWeight', () => {
  it('picks the right trip when a vehicle runs two loads the same day', () => {
    const result = selectByWeight(34690, [
      { lrId: 'lr-morning', quantityInMt: 34.69 },
      { lrId: 'lr-evening', quantityInMt: 28.4 },
    ]);
    expect(result?.lrId).toBe('lr-morning');
    expect(result?.contested).toBe(false);
  });

  it('refuses to guess between two near-identical loads', () => {
    // 20 kg apart — inside the 50 kg ambiguity margin. A human or a seal
    // number has to decide; the matcher must not.
    const result = selectByWeight(34690, [
      { lrId: 'lr-a', quantityInMt: 34.69 },
      { lrId: 'lr-b', quantityInMt: 34.71 },
    ]);
    expect(result).toBeNull();
  });

  it('flags a contested win so confidence can be downgraded', () => {
    // Both inside tolerance, but 200 kg apart — a clear winner, still worth
    // marking as less than certain.
    const result = selectByWeight(34690, [
      { lrId: 'lr-a', quantityInMt: 34.69 },
      { lrId: 'lr-b', quantityInMt: 34.89 },
    ]);
    expect(result?.lrId).toBe('lr-a');
    expect(result?.contested).toBe(true);
  });

  it('returns null when no candidate has a declared quantity', () => {
    expect(selectByWeight(34690, [{ lrId: 'lr-a', quantityInMt: null }])).toBeNull();
    expect(selectByWeight(34690, [])).toBeNull();
  });
});
