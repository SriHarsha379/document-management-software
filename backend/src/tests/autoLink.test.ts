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
  scoreMatch,
  findBestMatchingLr,
  autoLinkDocument,
  relinkPendingDocuments,
  AUTO_LINK_THRESHOLD,
  DATE_TOLERANCE_DAYS,
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

// ── scoreMatch ───────────────────────────────────────────────────────────────

function makeLr(overrides: Partial<{
  id: string; lrNo: string; invoiceNo: string | null;
  vehicleNo: string | null; date: string | null;
}> = {}) {
  return {
    id: 'lr-1',
    lrNo: 'LR001',
    invoiceNo: null,
    vehicleNo: null,
    date: null,
    status: 'DRAFT',
    consignor: null,
    consignee: null,
    source: 'INTERNAL',
    companyId: 'co-1',
    branchId: 'br-1',
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    // Extended fields (all nullable)
    serialNo: null,
    principalCompany: null,
    lrDate: null,
    loadingSlipNo: null,
    companyInvoiceDate: null,
    companyInvoiceNo: null,
    companyEwayBillNo: null,
    billToParty: null,
    shipToParty: null,
    deliveryDestination: null,
    tpt: null,
    orderType: null,
    productName: null,
    quantityInBags: null,
    quantityInMt: null,
    tollCharges: null,
    weighmentCharges: null,
    unloadingAtSite: null,
    driverBhatta: null,
    dayOpeningKm: null,
    dayClosingKm: null,
    totalRunningKm: null,
    fuelPerKm: null,
    fuelAmount: null,
    grandTotal: null,
    tptCode: null,
    transporterName: null,
    driverName: null,
    driverBillNo: null,
    billDate: null,
    billNo: null,
    billAmount: null,
    ...overrides,
  };
}

describe('scoreMatch', () => {
  it('returns confidence 1.0 for exact lrNo match', () => {
    const { confidence, matchedFields } = scoreMatch(
      { lrNo: 'LR001' },
      makeLr({ lrNo: 'LR001' }),
    );
    expect(confidence).toBe(1.0);
    expect(matchedFields).toContain('lrNo');
  });

  it('is case-insensitive for lrNo', () => {
    const { confidence } = scoreMatch(
      { lrNo: 'lr001' },
      makeLr({ lrNo: 'LR001' }),
    );
    expect(confidence).toBe(1.0);
  });

  it('returns confidence 0.9 for exact invoiceNo match', () => {
    const { confidence, matchedFields } = scoreMatch(
      { invoiceNo: 'INV-555' },
      makeLr({ invoiceNo: 'INV-555' }),
    );
    expect(confidence).toBe(0.9);
    expect(matchedFields).toContain('invoiceNo');
  });

  it('returns confidence 0.80 for vehicleNo + same date', () => {
    const { confidence, matchedFields } = scoreMatch(
      { vehicleNo: 'MH12AB1234', date: '2024-03-15' },
      makeLr({ vehicleNo: 'MH12AB1234', date: '2024-03-15' }),
    );
    expect(confidence).toBeCloseTo(0.80, 2);
    expect(matchedFields).toContain('vehicleNo');
    expect(matchedFields).toContain('date');
  });

  it('returns confidence ~0.70 for vehicleNo + 3-day tolerance', () => {
    const { confidence } = scoreMatch(
      { vehicleNo: 'MH12AB1234', date: '2024-03-15' },
      makeLr({ vehicleNo: 'MH12AB1234', date: '2024-03-18' }),
    );
    expect(confidence).toBeCloseTo(0.70, 2);
  });

  it('returns confidence 0.4 for vehicleNo only (no date)', () => {
    const { confidence, matchedFields } = scoreMatch(
      { vehicleNo: 'MH12AB1234' },
      makeLr({ vehicleNo: 'MH12AB1234' }),
    );
    expect(confidence).toBe(0.4);
    expect(matchedFields).toContain('vehicleNo');
    expect(matchedFields).not.toContain('date');
  });

  it('returns confidence 0 when nothing matches', () => {
    const { confidence, matchedFields } = scoreMatch(
      { lrNo: 'DIFFERENT', vehicleNo: 'XX99ZZ9999' },
      makeLr({ lrNo: 'LR001', vehicleNo: 'MH12AB1234' }),
    );
    expect(confidence).toBe(0);
    expect(matchedFields).toHaveLength(0);
  });

  it('prefers lrNo over invoiceNo when both match', () => {
    const { confidence } = scoreMatch(
      { lrNo: 'LR001', invoiceNo: 'INV-555' },
      makeLr({ lrNo: 'LR001', invoiceNo: 'INV-555' }),
    );
    expect(confidence).toBe(1.0);
  });

  it('normalises vehicle numbers with spaces', () => {
    const { confidence } = scoreMatch(
      { vehicleNo: 'mh 12 ab 1234', date: '2024-03-15' },
      makeLr({ vehicleNo: 'MH12AB1234', date: '2024-03-15' }),
    );
    expect(confidence).toBeGreaterThanOrEqual(0.70);
  });

  it('does not match beyond 3-day date tolerance', () => {
    const { matchedFields } = scoreMatch(
      { vehicleNo: 'MH12AB1234', date: '2024-03-15' },
      makeLr({ vehicleNo: 'MH12AB1234', date: '2024-03-20' }),
    );
    expect(matchedFields).not.toContain('date');
  });
});

// ── AUTO_LINK_THRESHOLD constant ─────────────────────────────────────────────

describe('AUTO_LINK_THRESHOLD', () => {
  it('is 0.6', () => {
    expect(AUTO_LINK_THRESHOLD).toBe(0.6);
  });

  it('vehicleNo-only score (0.4) is below the threshold', () => {
    expect(0.4).toBeLessThan(AUTO_LINK_THRESHOLD);
  });

  it('vehicleNo+date score (0.70) is above the threshold', () => {
    expect(0.70).toBeGreaterThanOrEqual(AUTO_LINK_THRESHOLD);
  });
});

// ── DATE_TOLERANCE_DAYS constant ─────────────────────────────────────────────

describe('DATE_TOLERANCE_DAYS', () => {
  it('is 3', () => {
    expect(DATE_TOLERANCE_DAYS).toBe(3);
  });
});

// ── findBestMatchingLr (mocked DB) ───────────────────────────────────────────

vi.mock('../lib/db.js', () => {
  const mockDb = {
    lr: {
      findMany: vi.fn(),
    },
    document: {
      findMany: vi.fn(),
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

describe('findBestMatchingLr', () => {
  it('returns the best match when multiple candidates exist', async () => {
    mockDb.lr.findMany.mockResolvedValue([
      makeLr({ id: 'lr-low',  lrNo: 'OTHER', vehicleNo: 'MH12AB1234', date: '2024-03-15' }),
      makeLr({ id: 'lr-high', lrNo: 'LR001' }),
    ]);

    const result = await findBestMatchingLr({ lrNo: 'LR001', vehicleNo: 'MH12AB1234', date: '2024-03-15' });
    expect(result).not.toBeNull();
    expect(result!.lrId).toBe('lr-high');
    expect(result!.confidence).toBe(1.0);
  });

  it('returns null when no candidates exist', async () => {
    mockDb.lr.findMany.mockResolvedValue([]);
    const result = await findBestMatchingLr({ vehicleNo: 'XX99ZZ9999' });
    expect(result).toBeNull();
  });

  it('returns null when extracted fields are all empty', async () => {
    const result = await findBestMatchingLr({});
    expect(result).toBeNull();
    expect(mockDb.lr.findMany).not.toHaveBeenCalled();
  });

  it('scopes the DB query to the given companyId', async () => {
    mockDb.lr.findMany.mockResolvedValue([]);
    await findBestMatchingLr({ lrNo: 'LR001' }, 'company-abc');
    expect(mockDb.lr.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-abc' }) }),
    );
  });
});

// ── autoLinkDocument (mocked DB) ─────────────────────────────────────────────

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
    mockDb.lr.findMany.mockResolvedValue([]);
    const result = await autoLinkDocument('doc-1');
    expect(result).toEqual({ linked: false });
  });

  it('returns autoLinked:true when confidence ≥ threshold', async () => {
    mockDb.extractedData.findUnique.mockResolvedValue({
      lrNo: 'LR001', invoiceNo: null, vehicleNo: null, date: null,
    });
    mockDb.lr.findMany.mockResolvedValue([makeLr({ id: 'lr-1', lrNo: 'LR001' })]);
    mockDb.documentLinkRecord.upsert.mockResolvedValue({
      id: 'link-1', documentId: 'doc-1', lrId: 'lr-1',
      matchedFields: '["lrNo"]', confidence: 1.0, isManual: false, linkedAt: new Date(),
    });

    const result = await autoLinkDocument('doc-1');
    expect(result.linked).toBe(true);
    expect(result.autoLinked).toBe(true);
    expect(result.confidence).toBe(1.0);
    expect(result.matchedFields).toContain('lrNo');
  });

  it('returns autoLinked:false when confidence < threshold (vehicleNo only)', async () => {
    mockDb.extractedData.findUnique.mockResolvedValue({
      lrNo: null, invoiceNo: null, vehicleNo: 'MH12AB1234', date: null,
    });
    mockDb.lr.findMany.mockResolvedValue([
      makeLr({ id: 'lr-1', lrNo: 'LR001', vehicleNo: 'MH12AB1234' }),
    ]);
    mockDb.documentLinkRecord.upsert.mockResolvedValue({
      id: 'link-1', documentId: 'doc-1', lrId: 'lr-1',
      matchedFields: '["vehicleNo"]', confidence: 0.4, isManual: false, linkedAt: new Date(),
    });

    const result = await autoLinkDocument('doc-1');
    expect(result.linked).toBe(true);
    expect(result.autoLinked).toBe(false);
    expect(result.confidence).toBe(0.4);
  });
});

// ── relinkPendingDocuments (mocked DB) ───────────────────────────────────────

describe('relinkPendingDocuments', () => {
  it('returns processed=0 when no pending documents exist', async () => {
    mockDb.document.findMany.mockResolvedValue([]);
    const summary = await relinkPendingDocuments();
    expect(summary).toEqual({ processed: 0, linked: 0 });
  });

  it('counts successfully auto-linked documents', async () => {
    mockDb.document.findMany.mockResolvedValue([{ id: 'doc-1' }, { id: 'doc-2' }]);

    // doc-1: matched with lrNo → auto-linked
    // doc-2: no extracted data → not linked
    mockDb.extractedData.findUnique
      .mockResolvedValueOnce({ lrNo: 'LR001', invoiceNo: null, vehicleNo: null, date: null })
      .mockResolvedValueOnce(null);

    mockDb.lr.findMany
      .mockResolvedValueOnce([makeLr({ id: 'lr-1', lrNo: 'LR001' })])
      .mockResolvedValueOnce([]);

    mockDb.documentLinkRecord.upsert.mockResolvedValue({
      id: 'link-1', documentId: 'doc-1', lrId: 'lr-1',
      matchedFields: '["lrNo"]', confidence: 1.0, isManual: false, linkedAt: new Date(),
    });

    const summary = await relinkPendingDocuments();
    expect(summary.processed).toBe(2);
    expect(summary.linked).toBe(1);
  });
});
