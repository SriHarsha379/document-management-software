/**
 * Unit tests for the Document Auto-Linking system.
 * Run with: npm test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeVehicleNo,
  normalizeRefNo,
  parseDateMs,
  daysBetween,
  isDateWithinTolerance,
  findBestMatchingLr,
  autoLinkDocument,
  relinkPendingDocuments,
} from '../services/autoLinkService.js';

// ── Normalisation helpers ────────────────────────────────────────────────────

describe('normalizeVehicleNo', () => {
  it('uppercases and strips spaces', () => {
    expect(normalizeVehicleNo('mh 12 ab 1234')).toBe('MH12AB1234');
  });
  it('handles already-normalised input', () => {
    expect(normalizeVehicleNo('MH12AB1234')).toBe('MH12AB1234');
  });
  it('strips leading/trailing whitespace', () => {
    expect(normalizeVehicleNo('  GJ05CD5678  ')).toBe('GJ05CD5678');
  });
});

describe('normalizeRefNo', () => {
  it('uppercases and trims', () => {
    expect(normalizeRefNo('  lr-123  ')).toBe('LR-123');
  });
});

describe('parseDateMs', () => {
  it('parses a valid YYYY-MM-DD date', () => {
    const ms = parseDateMs('2024-03-15');
    expect(typeof ms).toBe('number');
    expect(ms).toBeGreaterThan(0);
  });
  it('returns null for an invalid date string', () => {
    expect(parseDateMs('not-a-date')).toBeNull();
  });
  it('returns null for empty string', () => {
    expect(parseDateMs('')).toBeNull();
  });
});

describe('daysBetween', () => {
  it('returns 0 for identical dates', () => {
    expect(daysBetween('2024-03-15', '2024-03-15')).toBe(0);
  });
  it('returns 1 for consecutive days', () => {
    expect(daysBetween('2024-03-15', '2024-03-16')).toBe(1);
  });
  it('returns 3 for a 3-day gap', () => {
    expect(daysBetween('2024-03-15', '2024-03-18')).toBe(3);
  });
  it('is commutative', () => {
    expect(daysBetween('2024-03-10', '2024-03-20')).toBe(10);
    expect(daysBetween('2024-03-20', '2024-03-10')).toBe(10);
  });
  it('returns null when either date is invalid', () => {
    expect(daysBetween('2024-03-15', 'bad-date')).toBeNull();
    expect(daysBetween('bad-date', '2024-03-15')).toBeNull();
  });
});

describe('isDateWithinTolerance', () => {
  it('returns true for exact match', () => {
    expect(isDateWithinTolerance('2024-03-15', '2024-03-15')).toBe(true);
  });
  it('returns true for T+1', () => {
    expect(isDateWithinTolerance('2024-03-15', '2024-03-16')).toBe(true);
  });
  it('returns true for T+3', () => {
    expect(isDateWithinTolerance('2024-03-15', '2024-03-18')).toBe(true);
  });
  it('returns false for T+4 (beyond 3-day tolerance)', () => {
    expect(isDateWithinTolerance('2024-03-15', '2024-03-19')).toBe(false);
  });
  it('returns false for T+7', () => {
    expect(isDateWithinTolerance('2024-03-15', '2024-03-22')).toBe(false);
  });
  it('accepts custom tolerance', () => {
    expect(isDateWithinTolerance('2024-03-15', '2024-03-22', 7)).toBe(true);
    expect(isDateWithinTolerance('2024-03-15', '2024-03-23', 7)).toBe(false);
  });
  it('returns false when a date is invalid', () => {
    expect(isDateWithinTolerance('2024-03-15', 'invalid')).toBe(false);
  });
});

// ── Mock DB ───────────────────────────────────────────────────────────────────

vi.mock('../lib/db.js', () => {
  const mockDb = {
    lr: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    document: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    extractedData: {
      findUnique: vi.fn(),
    },
    documentLinkRecord: {
      upsert: vi.fn(),
    },
  };
  return { db: mockDb };
});

import { db } from '../lib/db.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as any;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── findBestMatchingLr — exact matching ───────────────────────────────────────

describe('findBestMatchingLr', () => {
  it('returns null when extracted fields are all empty', async () => {
    const result = await findBestMatchingLr({});
    expect(result).toBeNull();
    expect(mockDb.lr.findFirst).not.toHaveBeenCalled();
  });

  it('matches by lrNo (priority 1) and returns the Lr id', async () => {
    mockDb.lr.findFirst.mockResolvedValue({ id: 'lr-1' });
    const result = await findBestMatchingLr({ lrNo: 'LR001' });
    expect(result).not.toBeNull();
    expect(result!.lrId).toBe('lr-1');
    expect(result!.matchedFields).toEqual(['lrNo']);
  });

  it('is case-insensitive for lrNo', async () => {
    mockDb.lr.findFirst.mockResolvedValue({ id: 'lr-1' });
    const result = await findBestMatchingLr({ lrNo: 'lr001' });
    expect(result!.lrId).toBe('lr-1');
  });

  it('matches by invoiceNo (priority 2) when lrNo is absent', async () => {
    mockDb.lr.findFirst.mockResolvedValueOnce({ id: 'lr-2' }); // invoiceNo lookup
    const result = await findBestMatchingLr({ invoiceNo: 'INV-555' });
    expect(result!.lrId).toBe('lr-2');
    expect(result!.matchedFields).toEqual(['invoiceNo']);
  });

  it('matches by vehicleNo + exact date (priority 3)', async () => {
    mockDb.lr.findFirst.mockResolvedValue(null); // lrNo, invoiceNo absent
    mockDb.lr.findMany.mockResolvedValue([
      { id: 'lr-3', vehicleNo: 'MH12AB1234', date: '2024-03-15', lrDate: null },
    ]);
    const result = await findBestMatchingLr({
      vehicleNo: 'MH12AB1234',
      date: '2024-03-15',
    });
    expect(result!.lrId).toBe('lr-3');
    expect(result!.matchedFields).toContain('vehicleNo');
    expect(result!.matchedFields).toContain('date');
  });

  it('does NOT match vehicleNo + different date (exact required)', async () => {
    mockDb.lr.findFirst.mockResolvedValue(null);
    mockDb.lr.findMany.mockResolvedValue([
      { id: 'lr-3', vehicleNo: 'MH12AB1234', date: '2024-03-18', lrDate: null },
    ]);
    const result = await findBestMatchingLr({
      vehicleNo: 'MH12AB1234',
      date: '2024-03-15',
    });
    expect(result).toBeNull();
  });

  it('also checks lrDate field on Lr record for vehicleNo+date matching', async () => {
    mockDb.lr.findFirst.mockResolvedValue(null);
    mockDb.lr.findMany.mockResolvedValue([
      { id: 'lr-4', vehicleNo: 'MH12AB1234', date: null, lrDate: '2024-03-15' },
    ]);
    const result = await findBestMatchingLr({
      vehicleNo: 'MH12AB1234',
      date: '2024-03-15',
    });
    expect(result!.lrId).toBe('lr-4');
  });

  it('normalises vehicle numbers with spaces', async () => {
    mockDb.lr.findFirst.mockResolvedValue(null);
    mockDb.lr.findMany.mockResolvedValue([
      { id: 'lr-5', vehicleNo: 'MH12AB1234', date: '2024-03-15', lrDate: null },
    ]);
    const result = await findBestMatchingLr({
      vehicleNo: 'mh 12 ab 1234',
      date: '2024-03-15',
    });
    expect(result!.lrId).toBe('lr-5');
  });

  it('scopes the lrNo DB query to the given companyId', async () => {
    mockDb.lr.findFirst.mockResolvedValue(null);
    await findBestMatchingLr({ lrNo: 'LR001' }, 'company-abc');
    expect(mockDb.lr.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-abc' }) }),
    );
  });

  it('returns null when no candidates exist', async () => {
    mockDb.lr.findFirst.mockResolvedValue(null);
    mockDb.lr.findMany.mockResolvedValue([]);
    const result = await findBestMatchingLr({ vehicleNo: 'XX99ZZ9999', date: '2024-01-01' });
    expect(result).toBeNull();
  });

  // ── Type-aware tolerance (INVOICE / WEIGHMENT_SITE can lag up to 5 days) ────

  it('INVOICE matches vehicleNo+date up to 5 days after the LR date', async () => {
    mockDb.lr.findFirst.mockResolvedValue(null);
    mockDb.lr.findMany.mockResolvedValue([
      { id: 'lr-inv', vehicleNo: 'MH12AB1234', date: '2024-03-10', lrDate: null },
    ]);
    const result = await findBestMatchingLr(
      { vehicleNo: 'MH12AB1234', date: '2024-03-15' }, // 5 days after
      undefined,
      'INVOICE',
    );
    expect(result!.lrId).toBe('lr-inv');
  });

  it('INVOICE does NOT match more than 5 days after the LR date', async () => {
    mockDb.lr.findFirst.mockResolvedValue(null);
    mockDb.lr.findMany.mockResolvedValue([
      { id: 'lr-inv', vehicleNo: 'MH12AB1234', date: '2024-03-10', lrDate: null },
    ]);
    const result = await findBestMatchingLr(
      { vehicleNo: 'MH12AB1234', date: '2024-03-16' }, // 6 days after
      undefined,
      'INVOICE',
    );
    expect(result).toBeNull();
  });

  it('WEIGHMENT_SITE matches vehicleNo+date up to 5 days after the LR date', async () => {
    mockDb.lr.findFirst.mockResolvedValue(null);
    mockDb.lr.findMany.mockResolvedValue([
      { id: 'lr-site', vehicleNo: 'MH12AB1234', date: '2024-03-10', lrDate: null },
    ]);
    const result = await findBestMatchingLr(
      { vehicleNo: 'MH12AB1234', date: '2024-03-13' },
      undefined,
      'WEIGHMENT_SITE',
    );
    expect(result!.lrId).toBe('lr-site');
  });

  it('a document never matches an LR dated AFTER it (LR always comes first)', async () => {
    mockDb.lr.findFirst.mockResolvedValue(null);
    mockDb.lr.findMany.mockResolvedValue([
      { id: 'lr-future', vehicleNo: 'MH12AB1234', date: '2024-03-20', lrDate: null },
    ]);
    const result = await findBestMatchingLr(
      { vehicleNo: 'MH12AB1234', date: '2024-03-15' }, // document dated BEFORE the LR
      undefined,
      'INVOICE',
    );
    expect(result).toBeNull();
  });

  it('WEIGHMENT_PARTY (seller weighment) still requires the exact same day, even with a type passed', async () => {
    mockDb.lr.findFirst.mockResolvedValue(null);
    mockDb.lr.findMany.mockResolvedValue([
      { id: 'lr-party', vehicleNo: 'MH12AB1234', date: '2024-03-10', lrDate: null },
    ]);
    const result = await findBestMatchingLr(
      { vehicleNo: 'MH12AB1234', date: '2024-03-11' }, // 1 day after — outside 0-day tolerance
      undefined,
      'WEIGHMENT_PARTY',
    );
    expect(result).toBeNull();
  });

  it('generic WEIGHMENT (classifier does not distinguish party/site) gets the same 5-day tolerance as WEIGHMENT_SITE', async () => {
    mockDb.lr.findFirst.mockResolvedValue(null);
    mockDb.lr.findMany.mockResolvedValue([
      { id: 'lr-weighment', vehicleNo: 'MH12AB1234', date: '2024-03-10', lrDate: null },
    ]);
    const result = await findBestMatchingLr(
      { vehicleNo: 'MH12AB1234', date: '2024-03-11' }, // 1 day after — real-world site weighment lag
      undefined,
      'WEIGHMENT',
    );
    expect(result!.lrId).toBe('lr-weighment');
  });

  // ── Same-vehicle ambiguity guard (never confuse two separate trips) ────────

  it('auto-links when exactly one LR candidate falls in the tolerance window', async () => {
    mockDb.lr.findFirst.mockResolvedValue(null);
    mockDb.lr.findMany.mockResolvedValue([
      { id: 'lr-a', vehicleNo: 'MH12AB1234', date: '2024-03-10', lrDate: null },
      { id: 'lr-b', vehicleNo: 'MH12AB1234', date: '2024-01-01', lrDate: null }, // way outside window
    ]);
    const result = await findBestMatchingLr(
      { vehicleNo: 'MH12AB1234', date: '2024-03-12' },
      undefined,
      'INVOICE',
    );
    expect(result!.lrId).toBe('lr-a');
  });

  it('does NOT auto-link when the same vehicle has two LRs both within the tight 1-day window (two real trips, same/adjacent day)', async () => {
    mockDb.lr.findFirst.mockResolvedValue(null);
    mockDb.lr.findMany.mockResolvedValue([
      { id: 'lr-trip1', vehicleNo: 'MH12AB1234', date: '2024-03-10', lrDate: null },
      { id: 'lr-trip2', vehicleNo: 'MH12AB1234', date: '2024-03-10', lrDate: null },
    ]);
    const result = await findBestMatchingLr(
      { vehicleNo: 'MH12AB1234', date: '2024-03-10' },
      undefined,
      'WEIGHMENT_PARTY',
    );
    expect(result).toBeNull();
  });

  it('narrows to the tight 1-day window when the wide window has multiple candidates, auto-linking the sole close one', async () => {
    mockDb.lr.findFirst.mockResolvedValue(null);
    mockDb.lr.findMany.mockResolvedValue([
      { id: 'lr-close', vehicleNo: 'MH12AB1234', date: '2024-03-11', lrDate: null }, // 1 day before doc date
      { id: 'lr-far', vehicleNo: 'MH12AB1234', date: '2024-03-08', lrDate: null }, // 4 days before doc date
    ]);
    const result = await findBestMatchingLr(
      { vehicleNo: 'MH12AB1234', date: '2024-03-12' },
      undefined,
      'INVOICE',
    );
    expect(result!.lrId).toBe('lr-close');
  });

  it('stays unlinked when even the tight 1-day window has more than one candidate', async () => {
    mockDb.lr.findFirst.mockResolvedValue(null);
    mockDb.lr.findMany.mockResolvedValue([
      { id: 'lr-close1', vehicleNo: 'MH12AB1234', date: '2024-03-11', lrDate: null },
      { id: 'lr-close2', vehicleNo: 'MH12AB1234', date: '2024-03-12', lrDate: null },
      { id: 'lr-far', vehicleNo: 'MH12AB1234', date: '2024-03-08', lrDate: null },
    ]);
    const result = await findBestMatchingLr(
      { vehicleNo: 'MH12AB1234', date: '2024-03-12' },
      undefined,
      'INVOICE',
    );
    expect(result).toBeNull();
  });
});

// ── autoLinkDocument ──────────────────────────────────────────────────────────

describe('autoLinkDocument', () => {
  it('returns linked:false when no extracted data found', async () => {
    mockDb.extractedData.findUnique.mockResolvedValue(null);
    const result = await autoLinkDocument('doc-1');
    expect(result).toEqual({ linked: false });
  });

  it('returns linked:false when no matching LR is found', async () => {
    mockDb.extractedData.findUnique.mockResolvedValue({
      lrNo: 'LR999', invoiceNo: null, vehicleNo: null, date: null,
    });
    mockDb.lr.findFirst.mockResolvedValue(null);
    const result = await autoLinkDocument('doc-1');
    expect(result).toEqual({ linked: false });
  });

  it('returns linked:true when lrNo matches exactly', async () => {
    mockDb.extractedData.findUnique.mockResolvedValue({
      lrNo: 'LR001', invoiceNo: null, vehicleNo: null, date: null,
    });
    mockDb.lr.findFirst.mockResolvedValue({ id: 'lr-1' });
    mockDb.documentLinkRecord.upsert.mockResolvedValue({
      id: 'link-1', documentId: 'doc-1', lrId: 'lr-1',
      matchedFields: '["lrNo"]', confidence: 1.0, isManual: false, linkedAt: new Date(),
    });

    const result = await autoLinkDocument('doc-1');
    expect(result.linked).toBe(true);
    expect(result.lrId).toBe('lr-1');
    expect(result.matchedFields).toContain('lrNo');
  });
});

// ── relinkPendingDocuments ────────────────────────────────────────────────────

describe('relinkPendingDocuments', () => {
  it('returns processed=0 when no pending documents exist', async () => {
    mockDb.document.findMany.mockResolvedValue([]);
    const summary = await relinkPendingDocuments();
    expect(summary).toEqual({ processed: 0, linked: 0 });
  });

  it('counts successfully linked documents', async () => {
    mockDb.document.findMany.mockResolvedValue([{ id: 'doc-1' }, { id: 'doc-2' }]);

    // doc-1: matched with lrNo → linked
    // doc-2: no extracted data → not linked
    mockDb.extractedData.findUnique
      .mockResolvedValueOnce({ lrNo: 'LR001', invoiceNo: null, vehicleNo: null, date: null })
      .mockResolvedValueOnce(null);

    mockDb.lr.findFirst
      .mockResolvedValueOnce({ id: 'lr-1' })
      .mockResolvedValueOnce(null);

    mockDb.documentLinkRecord.upsert.mockResolvedValue({
      id: 'link-1', documentId: 'doc-1', lrId: 'lr-1',
      matchedFields: '["lrNo"]', confidence: 1.0, isManual: false, linkedAt: new Date(),
    });

    const summary = await relinkPendingDocuments();
    expect(summary.processed).toBe(2);
    expect(summary.linked).toBe(1);
  });
});
