/**
 * Tests for multi-page PDF handling and pairwise weighment resolution.
 *
 * Fixtures come from LR MH/DR/LR/26-27/1391 (invoice MHQS001647), a 4-page PDF
 * containing an invoice, a lorry receipt, a page with TWO weighment slips, and
 * a page with TWO toll swipes. Under the old rasteriser only page 1 was read.
 *
 * The two weighment slips use incompatible formats, which is the point:
 *   MHIPL gate  — Gross/Tare labels, no per-reading timestamps
 *   PROCON RMC  — First/Second labels with timestamps, no gross/tare wording
 * Neither is fully classifiable alone by a single rule; together they resolve.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyByFirstSecondWeight,
  classifyByTimestampOrder,
  classifyWeighment,
} from '../services/weighmentClassifier.js';
import { resolveWeighmentPair } from '../services/weighmentPairResolver.js';
import { MAX_PDF_PAGES } from '../services/pdfSplitService.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MHIPL = {
  documentId: 'doc-mhipl',
  bridgeName: 'MHIPL MBT SECURITY GATE',
  grossKg: 50200,
  tareKg: 15470,
  netKg: 34730,
  // Only "Date time In 19:01 / Out 19:15" — the visit, not per reading.
  grossAtMs: null,
  tareAtMs: null,
  weighedAtMs: Date.parse('2026-05-12T19:01:00Z'),
  challanNo: '801664868',
};

const PROCON = {
  documentId: 'doc-procon',
  bridgeName: 'PROCON RMC',
  firstWeightKg: 50140,
  secondWeightKg: 15430,
  netKg: 34710,
  // Note: the readings straddle midnight.
  firstAtMs: Date.parse('2026-05-13T23:23:00Z'),
  secondAtMs: Date.parse('2026-05-14T00:50:00Z'),
  weighedAtMs: Date.parse('2026-05-13T23:23:00Z'),
  challanNo: 'MHQS001647',
};

describe('classifyByFirstSecondWeight', () => {
  it('reads first-heavier as a destination weighing', () => {
    // Truck arrived loaded (50140) and left empty (15430).
    expect(classifyByFirstSecondWeight(PROCON.firstWeightKg, PROCON.secondWeightKg)).toBe(
      'DESTINATION',
    );
  });

  it('reads first-lighter as an origin weighing', () => {
    expect(classifyByFirstSecondWeight(15470, 50200)).toBe('ORIGIN');
  });

  it('abstains when the two readings are not a loaded/empty pair', () => {
    expect(classifyByFirstSecondWeight(34730, 34710)).toBe('UNKNOWN');
    expect(classifyByFirstSecondWeight(50200, null)).toBe('UNKNOWN');
  });
});

describe('single-slip classification limits', () => {
  it('cannot classify the MHIPL gate slip alone', () => {
    // Gross/tare labels but no per-reading timestamps, and the bridge name
    // matches neither party. This is the case pairwise resolution exists for.
    expect(classifyByTimestampOrder(MHIPL.grossAtMs, MHIPL.tareAtMs)).toBe('UNKNOWN');
    const r = classifyWeighment({
      bridgeName: MHIPL.bridgeName,
      grossAtMs: MHIPL.grossAtMs,
      tareAtMs: MHIPL.tareAtMs,
    });
    expect(r.pointConfidence).toBeLessThan(0.7);
  });

  it('classifies the PROCON slip alone via first/second ordering', () => {
    const r = classifyWeighment({
      bridgeName: PROCON.bridgeName,
      firstWeightKg: PROCON.firstWeightKg,
      secondWeightKg: PROCON.secondWeightKg,
    });
    expect(r.point).toBe('DESTINATION');
    expect(r.pointBasis).toBe('firstSecondWeight');
    expect(r.pointConfidence).toBeGreaterThan(0.9);
  });
});

describe('resolveWeighmentPair', () => {
  const pair = [
    { documentId: MHIPL.documentId, netKg: MHIPL.netKg, weighedAtMs: MHIPL.weighedAtMs },
    { documentId: PROCON.documentId, netKg: PROCON.netKg, weighedAtMs: PROCON.weighedAtMs },
  ];

  it('resolves the real pair with both rules agreeing', () => {
    const r = resolveWeighmentPair(pair);
    const byId = Object.fromEntries(r.slips.map((s) => [s.documentId, s]));
    expect(byId[MHIPL.documentId]!.point).toBe('ORIGIN');
    expect(byId[PROCON.documentId]!.point).toBe('DESTINATION');
    expect(byId[MHIPL.documentId]!.basis).toBe('chronology+weight');
    expect(r.issue).toBeUndefined();
  });

  it('mirrors a high-confidence single-slip result onto the other slip', () => {
    // PROCON classified itself at 0.93 via first/second ordering; MHIPL is
    // therefore the origin without needing either pairwise rule.
    const r = resolveWeighmentPair([
      { documentId: MHIPL.documentId, netKg: null, weighedAtMs: null },
      {
        documentId: PROCON.documentId,
        netKg: PROCON.netKg,
        weighedAtMs: null,
        priorPoint: 'DESTINATION',
        priorConfidence: 0.93,
      },
    ]);
    const byId = Object.fromEntries(r.slips.map((s) => [s.documentId, s]));
    expect(byId[MHIPL.documentId]!.point).toBe('ORIGIN');
    expect(byId[PROCON.documentId]!.point).toBe('DESTINATION');
  });

  it('falls back to chronology alone when weights are too close', () => {
    const r = resolveWeighmentPair([
      { documentId: 'a', netKg: 34730, weighedAtMs: 1000 },
      { documentId: 'b', netKg: 34725, weighedAtMs: 2000 }, // 5 kg apart
    ]);
    expect(r.slips.find((s) => s.documentId === 'a')!.point).toBe('ORIGIN');
    expect(r.slips[0]!.basis).toBe('chronology');
  });

  it('refuses to resolve when the later slip is heavier', () => {
    // A load cannot gain mass in transit — these are two different trips.
    const r = resolveWeighmentPair([
      { documentId: 'a', netKg: 30000, weighedAtMs: 1000 },
      { documentId: 'b', netKg: 34000, weighedAtMs: 2000 },
    ]);
    expect(r.issue).toContain('cannot gain weight');
    expect(r.slips.every((s) => s.point === 'UNKNOWN')).toBe(true);
  });

  it('flags three or more slips instead of guessing', () => {
    const r = resolveWeighmentPair([
      { documentId: 'a', netKg: 34730, weighedAtMs: 1000 },
      { documentId: 'b', netKg: 34710, weighedAtMs: 2000 },
      { documentId: 'c', netKg: 30000, weighedAtMs: 3000 },
    ]);
    expect(r.issue).toContain('two ends');
    expect(r.slips.every((s) => s.point === 'UNKNOWN')).toBe(true);
  });

  it('leaves a lone slip to the single-slip classifier', () => {
    const r = resolveWeighmentPair([
      { documentId: 'a', netKg: 34730, weighedAtMs: 1000, priorPoint: 'ORIGIN', priorConfidence: 0.8 },
    ]);
    expect(r.slips).toHaveLength(1);
    expect(r.slips[0]!.point).toBe('ORIGIN');
    expect(r.slips[0]!.basis).toBe('prior');
  });

  it('reports when neither rule can fire', () => {
    const r = resolveWeighmentPair([
      { documentId: 'a', netKg: null, weighedAtMs: null },
      { documentId: 'b', netKg: null, weighedAtMs: null },
    ]);
    expect(r.issue).toBeDefined();
  });

  it('handles an empty set', () => {
    expect(resolveWeighmentPair([]).slips).toHaveLength(0);
  });
});

describe('page cap', () => {
  it('is set high enough for a trip bundle and low enough to bound cost', () => {
    // Each page is one vision API call.
    expect(MAX_PDF_PAGES).toBeGreaterThanOrEqual(10);
    expect(MAX_PDF_PAGES).toBeLessThanOrEqual(50);
  });
});
