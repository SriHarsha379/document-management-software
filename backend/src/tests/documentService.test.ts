import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockPrisma,
  relinkPendingDocuments,
  backfillLrFromLinkedInvoice,
} = vi.hoisted(() => ({
  mockPrisma: {
    company: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    branch: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    lr: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    document: {
      findMany: vi.fn(),
    },
  },
  relinkPendingDocuments: vi.fn(),
  backfillLrFromLinkedInvoice: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

vi.mock('../services/autoLinkService.js', () => ({
  autoLinkDocument: vi.fn(),
  relinkPendingDocuments,
  normalizeVehicleNo: vi.fn((value: string) => value),
  backfillLrFromLinkedInvoice,
  daysBetween: vi.fn(),
}));

vi.mock('../services/ocrLearningService.js', () => ({
  getTrackedReviewFields: vi.fn(),
  getOcrQualityMetrics: vi.fn(),
  learnFromDocumentReview: vi.fn(),
  shouldAutoAccept: vi.fn(),
}));

import { getAcknowledgedLrDocumentCategory, syncLrRecordsFromDocuments } from '../services/documentService.js';

beforeEach(() => {
  vi.clearAllMocks();
  relinkPendingDocuments.mockResolvedValue({ linked: 0 });
  backfillLrFromLinkedInvoice.mockResolvedValue(undefined);
  mockPrisma.document.findMany.mockResolvedValue([]);
});

describe('syncLrRecordsFromDocuments', () => {
  it('auto-creates a company from OCR fields and a fallback branch after a reset', async () => {
    mockPrisma.document.findMany
      .mockResolvedValueOnce([
        {
          extractedData: {
            lrNo: 'LR-001',
            invoiceNo: null,
            vehicleNo: null,
            date: null,
            partyNames: null,
            billToParty: null,
            shipToParty: null,
            principalCompany: 'Acme Logistics',
            loadingSlipNo: null,
            companyInvoiceNo: null,
            companyInvoiceDate: null,
            companyEwayBillNo: null,
            ewayBillDate: null,
            approvedDestination: null,
            deliveryDestination: null,
            orderNo: null,
            productName: null,
            transporterName: null,
            orderType: null,
            tptCode: null,
            quantityInMt: null,
            quantityInBags: null,
            driverName: null,
            driverCellNo: null,
            branchName: null,
            workingCenter: null,
            depotPlantCode: null,
            source: null,
          },
        },
      ])
      .mockResolvedValueOnce([]);
    mockPrisma.company.findFirst.mockResolvedValueOnce(null);
    mockPrisma.company.create.mockResolvedValueOnce({ id: 'company-1', name: 'Acme Logistics' });
    mockPrisma.branch.findFirst.mockResolvedValueOnce(null);
    mockPrisma.branch.create.mockResolvedValueOnce({ id: 'branch-1' });
    mockPrisma.lr.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ serialNo: 4 });
    mockPrisma.lr.create.mockResolvedValueOnce({ id: 'lr-1' });

    const result = await syncLrRecordsFromDocuments();

    expect(mockPrisma.company.create).toHaveBeenCalledWith({
      data: { name: 'Acme Logistics' },
    });
    expect(mockPrisma.branch.create).toHaveBeenCalledWith({
      data: { companyId: 'company-1', name: 'Head Office' },
      select: { id: true },
    });
    expect(mockPrisma.lr.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lrNo: 'LR-001',
        companyId: 'company-1',
        branchId: 'branch-1',
        serialNo: 5,
        principalCompany: 'Acme Logistics',
      }),
    }));
    expect(result).toEqual({ processed: 1, created: 1, linked: 0, backfilled: 0 });
  });

  it('uses the default company name when OCR company fields are unavailable', async () => {
    mockPrisma.document.findMany
      .mockResolvedValueOnce([
        {
          extractedData: {
            lrNo: 'LR-002',
            invoiceNo: null,
            vehicleNo: null,
            date: null,
            partyNames: null,
            billToParty: '   ',
            shipToParty: null,
            principalCompany: '   ',
            loadingSlipNo: null,
            companyInvoiceNo: null,
            companyInvoiceDate: null,
            companyEwayBillNo: null,
            ewayBillDate: null,
            approvedDestination: null,
            deliveryDestination: null,
            orderNo: null,
            productName: null,
            transporterName: null,
            orderType: null,
            tptCode: null,
            quantityInMt: null,
            quantityInBags: null,
            driverName: null,
            driverCellNo: null,
            branchName: null,
            workingCenter: null,
            depotPlantCode: null,
            source: null,
          },
        },
      ])
      .mockResolvedValueOnce([]);
    mockPrisma.company.findFirst.mockResolvedValueOnce(null);
    mockPrisma.company.create.mockResolvedValueOnce({ id: 'company-2', name: 'Default Company' });
    mockPrisma.branch.findFirst.mockResolvedValueOnce(null);
    mockPrisma.branch.create.mockResolvedValueOnce({ id: 'branch-2' });
    mockPrisma.lr.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockPrisma.lr.create.mockResolvedValueOnce({ id: 'lr-2' });

    await syncLrRecordsFromDocuments();

    expect(mockPrisma.company.create).toHaveBeenCalledWith({
      data: { name: 'Default Company' },
    });
  });
});

describe('getAcknowledgedLrDocumentCategory', () => {
  it('routes acknowledged invoices and LRs to the correct dashboard categories', () => {
    expect(getAcknowledgedLrDocumentCategory('INVOICE', true, true)).toBe('ACKNOWLEDGED_INVOICE');
    expect(getAcknowledgedLrDocumentCategory('LR', true, true)).toBe('ACKNOWLEDGED_LR_COPY');
  });

  it('does not route documents without both recipient acknowledgement marks', () => {
    expect(getAcknowledgedLrDocumentCategory('INVOICE', true, false)).toBeUndefined();
    expect(getAcknowledgedLrDocumentCategory('TOLL', true, true)).toBeUndefined();
  });
});
