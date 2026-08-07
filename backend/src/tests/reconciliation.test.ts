/**
 * Unit tests for reconciliationService.ts — the rollup/cross-check logic
 * that turns isolated TOLL/WEIGHMENT ExtractedData rows into totals and
 * mismatch flags on the Lr record.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseAmount, parseNetWeightKg } from '../services/reconciliationService.js';

// ── Pure parsing helpers ─────────────────────────────────────────────────────

describe('parseAmount', () => {
  it('parses a rupee-symbol amount', () => {
    expect(parseAmount('₹205.50')).toBe(205.5);
  });
  it('parses an "Rs." prefixed amount', () => {
    expect(parseAmount('Rs.150')).toBe(150);
  });
  it('parses a bare number', () => {
    expect(parseAmount('411')).toBe(411);
  });
  it('strips thousands separators', () => {
    expect(parseAmount('₹1,205.50')).toBe(1205.5);
  });
  it('returns null for null/undefined/empty', () => {
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
  it('returns null when there is no number', () => {
    expect(parseAmount('no amount here')).toBeNull();
  });
});

describe('parseNetWeightKg', () => {
  it('extracts a labelled Net weight', () => {
    expect(parseNetWeightKg('Gross: 50180 kg, Tare: 15490 kg, Net: 34690 kg')).toBe(34690);
  });
  it('extracts Net regardless of label order', () => {
    expect(parseNetWeightKg('Net: 28040 kg, Gross: 41620 kg, Empty: 13580 kg')).toBe(28040);
  });
  it('falls back to gross-minus-tare when Net is not labelled', () => {
    expect(parseNetWeightKg('Gross: 50130 kg, Tare: 15450 kg')).toBe(50130 - 15450);
  });
  it('returns null when nothing usable is present', () => {
    expect(parseNetWeightKg('no weight data')).toBeNull();
    expect(parseNetWeightKg(null)).toBeNull();
    expect(parseNetWeightKg(undefined)).toBeNull();
  });
});

// ── reconcileLr — mocked DB ──────────────────────────────────────────────────

vi.mock('../lib/db.js', () => {
  const mockDb = {
    lr: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    documentLinkRecord: {
      findMany: vi.fn(),
    },
  };
  return { db: mockDb };
});

import { db } from '../lib/db.js';
import { reconcileLr } from '../services/reconciliationService.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as any;

function link(type: string, extracted: Record<string, unknown> | null) {
  return { document: { type, extractedData: extracted } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.lr.update.mockResolvedValue({});
});

describe('reconcileLr', () => {
  it('returns an empty result when the Lr does not exist', async () => {
    mockDb.lr.findUnique.mockResolvedValue(null);
    mockDb.documentLinkRecord.findMany.mockResolvedValue([]);
    const result = await reconcileLr('missing-lr');
    expect(result.autoTollAmount).toBeNull();
    expect(mockDb.lr.update).not.toHaveBeenCalled();
  });

  it('sums multiple linked TOLL documents into autoTollAmount', async () => {
    mockDb.lr.findUnique.mockResolvedValue({ quantityInMt: null });
    mockDb.documentLinkRecord.findMany.mockResolvedValue([
      link('TOLL', { tollAmount: '₹205.50', weightInfo: null, quantityInMt: null }),
      link('TOLL', { tollAmount: '₹411', weightInfo: null, quantityInMt: null }),
    ]);

    const result = await reconcileLr('lr-1');

    expect(result.autoTollAmount).toBe(616.5);
    expect(mockDb.lr.update).toHaveBeenCalledWith({
      where: { id: 'lr-1' },
      data: expect.objectContaining({ autoTollAmount: 616.5 }),
    });
  });

  it('does not flag a variance for two closely-matching weighments (real-world tolerance)', async () => {
    // Matches doc MHQS001701: 34690 kg origin vs 34680 kg destination (~0.03%)
    mockDb.lr.findUnique.mockResolvedValue({ quantityInMt: 34.69 });
    mockDb.documentLinkRecord.findMany.mockResolvedValue([
      link('WEIGHMENT_PARTY', { tollAmount: null, weightInfo: 'Gross: 50180 kg, Tare: 15490 kg, Net: 34690 kg', quantityInMt: null }),
      link('WEIGHMENT_SITE', { tollAmount: null, weightInfo: 'Gross: 50130 kg, Tare: 15450 kg, Net: 34680 kg', quantityInMt: null }),
    ]);

    const result = await reconcileLr('lr-2');

    expect(result.originNetWeightKg).toBe(34690);
    expect(result.destinationNetWeightKg).toBe(34680);
    expect(result.weightVariancePct).toBeLessThan(0.5);
    expect(result.issues).toHaveLength(0);
  });

  it('flags a weight variance above the 0.5% tolerance', async () => {
    mockDb.lr.findUnique.mockResolvedValue({ quantityInMt: null });
    mockDb.documentLinkRecord.findMany.mockResolvedValue([
      link('WEIGHMENT_PARTY', { tollAmount: null, weightInfo: 'Net: 34690 kg', quantityInMt: null }),
      link('WEIGHMENT_SITE', { tollAmount: null, weightInfo: 'Net: 33000 kg', quantityInMt: null }),
    ]);

    const result = await reconcileLr('lr-3');

    expect(result.weightVariancePct).toBeGreaterThan(0.5);
    expect(result.issues.some((i) => i.includes('weighment'))).toBe(true);
  });

  it('flags a quantity-vs-weighbridge mismatch above the 2% tolerance', async () => {
    // Declared 34.69 MT (34690 kg) but the weighbridge shows a real short-load
    mockDb.lr.findUnique.mockResolvedValue({ quantityInMt: 34.69 });
    mockDb.documentLinkRecord.findMany.mockResolvedValue([
      link('WEIGHMENT_SITE', { tollAmount: null, weightInfo: 'Net: 32000 kg', quantityInMt: null }),
    ]);

    const result = await reconcileLr('lr-4');

    expect(result.issues.some((i) => i.includes('Declared quantity'))).toBe(true);
  });

  it('ignores documents with no ExtractedData', async () => {
    mockDb.lr.findUnique.mockResolvedValue({ quantityInMt: null });
    mockDb.documentLinkRecord.findMany.mockResolvedValue([link('TOLL', null)]);

    const result = await reconcileLr('lr-5');

    expect(result.autoTollAmount).toBeNull();
  });
});
