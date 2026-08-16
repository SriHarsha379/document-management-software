import { db } from '../../lib/db.js';
import type { ScopeWhere } from '../rbac/rbac.middleware.js';
import type { Prisma } from '@prisma/client';

// ── LR Repository ─────────────────────────────────────────────────────────────
// All public methods accept a scopeWhere produced by buildScopeWhere(user).
// Callers MUST provide the scope — never call without it (except in tests with
// an explicit reason).

type LrWhereInput = Prisma.LrWhereInput;

export type LrCreateInput = {
  lrNo: string;
  companyId: string;
  branchId: string;
  source?: string;
  // Legacy
  consignor?: string;
  consignee?: string;
  date?: string;
  createdBy?: string;
  invoiceNo?: string;
  // Extended
  principalCompany?: string;
  lrDate?: string;
  loadingSlipNo?: string;
  companyInvoiceDate?: string;
  companyInvoiceNo?: string;
  companyEwayBillNo?: string;
  billToParty?: string;
  shipToParty?: string;
  deliveryDestination?: string;
  tpt?: string;
  orderType?: string;
  productName?: string;
  vehicleNo?: string;
  quantityInBags?: number;
  quantityInMt?: number;
  tollCharges?: number;
  weighmentCharges?: number;
  unloadingAtSite?: number;
  driverBhatta?: number;
  dayOpeningKm?: number;
  dayClosingKm?: number;
  totalRunningKm?: number;
  fuelPerKm?: number;
  fuelAmount?: number;
  grandTotal?: number;
  tptCode?: string;
  transporterName?: string;
  driverName?: string;
  driverCellNo?: string;
  driverBillNo?: string;
  billDate?: string;
  billNo?: string;
  billAmount?: number;
  // Additional logistics fields
  ewayBillDate?: string;
  approvedDestination?: string;
  orderNo?: string;
  workingCenter?: string;
  depotPlantCode?: string;
};

export type LrUpdateInput = Partial<Omit<LrCreateInput, 'companyId' | 'createdBy'> & { status: string }>;

// Whitelist of columns users may sort by.
// SECURITY: This set prevents arbitrary field injection into orderBy clauses.
// Keep in sync with the sortField values in LrRecordsDetails COLUMNS and any
// new sortable fields added to the Lr schema.
const SORTABLE_FIELDS = new Set([
  'lrDate', 'lrNo', 'date', 'companyInvoiceNo', 'companyEwayBillNo',
  'loadingSlipNo', 'billNo', 'shipToParty', 'deliveryDestination',
  'quantityInBags', 'quantityInMt', 'productName', 'vehicleNo',
  'tptCode', 'driverName', 'serialNo', 'createdAt',
  'principalCompany', 'ewayBillDate', 'approvedDestination', 'orderNo',
  'workingCenter', 'depotPlantCode', 'driverCellNo',
]);

export type LrFilters = {
  principalCompany?: string;
  branchId?: string;
  lrDate?: string;
  invoiceDate?: string;
  invoiceNo?: string;
  lrNo?: string;
  vehicleNo?: string;
  driverName?: string;
  productName?: string;
  tptCode?: string;
  workingCenter?: string;
  depotPlantCode?: string;
};

export const lrRepo = {
  // ── findMany ─────────────────────────────────────────────────────────────────
  async findMany(opts: {
    where: ScopeWhere;
    limit?: number;
    offset?: number;
    q?: string;
    filters?: LrFilters;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
  }) {
    const where: LrWhereInput = buildPrismaWhere(opts.where, opts.q, opts.filters);

    const safeSort = opts.sortBy && SORTABLE_FIELDS.has(opts.sortBy) ? opts.sortBy : null;
    const orderBy: Prisma.LrOrderByWithRelationInput[] = safeSort
      ? [{ [safeSort]: opts.sortDir ?? 'asc' }]
      : [{ serialNo: 'asc' }, { createdAt: 'desc' }];

    const [rows, total] = await Promise.all([
      db.lr.findMany({
        where,
        orderBy,
        take: opts.limit ?? 50,
        skip: opts.offset ?? 0,
        include: {
          company: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
          uploadedDocuments: {
            select: {
              id: true,
              type: true,
              status: true,
              originalFilename: true,
              mimeType: true,
              rawFilePath: true,
              uploadedAt: true,
              updatedAt: true,
              groupId: true,
              sourceDocumentId: true,
              pageNumber: true,
              lrDocumentCategory: true,
              uploadedById: true,
              uploadedBy: {
                select: { id: true, name: true, email: true },
              },
            },
            orderBy: [{ uploadedAt: 'desc' }],
          },
          // The real source of truth for "which documents belong to this LR":
          // confirmed matches from the auto-link pipeline (lrNo / invoiceNo /
          // vehicleNo+date within tolerance) or a manual link. Unlike
          // uploadedDocuments (direct lrId FK, rarely populated) or raw
          // groupId membership (shared across every LR for the same
          // vehicle+date, including separate trips), this only contains
          // documents actually confirmed to belong to this specific LR.
          documentLinks: {
            select: {
              lrId: true,
              matchedFields: true,
              confidence: true,
              isManual: true,
              linkedAt: true,
              document: {
                select: {
                  id: true,
                  type: true,
                  status: true,
                  originalFilename: true,
                  mimeType: true,
                  rawFilePath: true,
                  uploadedAt: true,
                  updatedAt: true,
                  sourceDocumentId: true,
                  pageNumber: true,
                  lrDocumentCategory: true,
                  uploadedById: true,
                  uploadedBy: {
                    select: { id: true, name: true, email: true },
                  },
                },
              },
            },
            orderBy: [{ linkedAt: 'desc' }],
          },
        },
      }),
      db.lr.count({ where }),
    ]);
    return { rows, total };
  },

  // ── filterValues — distinct dropdown options for the filter panel ─────────────
  async filterValues(companyId: string): Promise<{
    principalCompanies: string[];
    vehicleNos: string[];
    productNames: string[];
    tptCodes: string[];
    driverNames: string[];
    workingCenters: string[];
    depotPlantCodes: string[];
  }> {
    const [pcRows, vnRows, pnRows, tcRows, dnRows, wcRows, dpRows] = await Promise.all([
      db.lr.findMany({
        where: { companyId },
        select: { principalCompany: true },
        distinct: ['principalCompany'],
        orderBy: { principalCompany: 'asc' },
      }),
      db.lr.findMany({
        where: { companyId },
        select: { vehicleNo: true },
        distinct: ['vehicleNo'],
        orderBy: { vehicleNo: 'asc' },
      }),
      db.lr.findMany({
        where: { companyId },
        select: { productName: true },
        distinct: ['productName'],
        orderBy: { productName: 'asc' },
      }),
      db.lr.findMany({
        where: { companyId },
        select: { tptCode: true },
        distinct: ['tptCode'],
        orderBy: { tptCode: 'asc' },
      }),
      db.lr.findMany({
        where: { companyId },
        select: { driverName: true },
        distinct: ['driverName'],
        orderBy: { driverName: 'asc' },
      }),
      db.lr.findMany({
        where: { companyId },
        select: { workingCenter: true },
        distinct: ['workingCenter'],
        orderBy: { workingCenter: 'asc' },
      }),
      db.lr.findMany({
        where: { companyId },
        select: { depotPlantCode: true },
        distinct: ['depotPlantCode'],
        orderBy: { depotPlantCode: 'asc' },
      }),
    ]);

    const toStrings = <T extends { [K in keyof T]: string | null }>(
      rows: T[],
      key: keyof T,
    ): string[] =>
      rows
        .map((r) => r[key] as string | null)
        .filter((v): v is string => v !== null && v.trim() !== '');

    return {
      principalCompanies: toStrings(pcRows, 'principalCompany'),
      vehicleNos:         toStrings(vnRows, 'vehicleNo'),
      productNames:       toStrings(pnRows, 'productName'),
      tptCodes:           toStrings(tcRows, 'tptCode'),
      driverNames:        toStrings(dnRows, 'driverName'),
      workingCenters:     toStrings(wcRows, 'workingCenter'),
      depotPlantCodes:    toStrings(dpRows, 'depotPlantCode'),
    };
  },

  // ── findFirst — used for single-row access (update/delete guards) ─────────────
  async findFirst(opts: { where: ScopeWhere & { id?: string } }) {
    const where: LrWhereInput = buildPrismaWhere(opts.where);
    return db.lr.findFirst({ where });
  },

  // ── summary — count of acknowledged LRs and Invoices for dashboard cards ─────
  async summary(companyId: string): Promise<{
    generatedLrCount: number | null;
    generatedInvoiceCount: number | null;
    acknowledgedLrCount: number;
    acknowledgedInvoiceCount: number;
    totalUploadedDocuments: number;
    /** Uploaded-document count per LrDocumentCategory, company-scoped. Used
     *  to show "N uploaded" per document type at the top of the Documents tab. */
    documentCountsByCategory: Record<string, number>;
    /** Same idea, grouped by DocumentType instead — the Bundle page's columns
     *  key off DocumentType (checkType) rather than LrDocumentCategory for
     *  everything except the two free-form "Additional Document" slots. */
    documentCountsByType: Record<string, number>;
  }> {
    // A document reaches a company through THREE possible paths, and a real
    // document only ever uses one of them at a time — but all three must be
    // checked, or documents connected only via the auto-link join table
    // silently vanish from every count below:
    //   1. Document.lrId set directly    (the LR-scoped manual per-slot upload)
    //   2. DocumentLinkRecord join table (the auto-link pipeline — this is how
    //      MOST documents actually get connected; linkDocumentToLr() only ever
    //      writes here, never touches Document.lrId)
    //   3. Document.uploadedById         (fallback for a document not yet
    //      linked to any LR at all, so it isn't invisible before linking runs)
    const companyScope: Prisma.DocumentWhereInput['OR'] = [
      { lr: { companyId } },
      { documentLinks: { some: { lr: { companyId } } } },
      { uploadedBy: { companyId } },
    ];

    const [
      generatedLrCount,
      generatedInvoiceRows,
      acknowledgedLrCount,
      acknowledgedInvoiceCount,
      totalUploadedDocuments,
      categoryCountRows,
      typeCountRows,
    ] = await Promise.all([
      db.lr.count({ where: { companyId } }),
      db.lr.findMany({
        where: { companyId, companyInvoiceNo: { not: null } },
        select: { companyInvoiceNo: true },
        distinct: ['companyInvoiceNo'],
      }),
      // "Acknowledged LR" = any uploaded LR-side document (either the
      // generated LR itself, or the RECEIVING copy that comes back from the
      // customer) that has BOTH a stamp and a signature. Previously this only
      // looked at ACKNOWLEDGED_LR_COPY (RECEIVING), so a stamped/signed copy
      // uploaded under LR_GENERATED never reflected here.
      db.document.count({
        where: {
          OR: companyScope,
          lrDocumentCategory: { in: ['LR_GENERATED', 'ACKNOWLEDGED_LR_COPY'] },
          extractedData: {
            is: {
              hasStamp: true,
              hasSignature: true,
            },
          },
        },
      }),
      db.document.count({
        where: {
          OR: companyScope,
          lrDocumentCategory: 'ACKNOWLEDGED_INVOICE',
          extractedData: {
            is: {
              hasStamp: true,
              hasSignature: true,
            },
          },
        },
      }),
      db.document.count({
        where: { OR: companyScope },
      }),
      db.document.groupBy({
        by: ['lrDocumentCategory'],
        where: {
          lrDocumentCategory: { not: null },
          OR: companyScope,
        },
        _count: { _all: true },
      }),
      db.document.groupBy({
        by: ['type'],
        where: { OR: companyScope },
        _count: { _all: true },
      }),
    ]);
    const documentCountsByCategory: Record<string, number> = {};
    for (const row of categoryCountRows) {
      if (row.lrDocumentCategory) documentCountsByCategory[row.lrDocumentCategory] = row._count._all;
    }
    const documentCountsByType: Record<string, number> = {};
    for (const row of typeCountRows) {
      documentCountsByType[row.type] = row._count._all;
    }
    return {
      generatedLrCount,
      generatedInvoiceCount: generatedInvoiceRows
        .filter((row) => typeof row.companyInvoiceNo === 'string' && row.companyInvoiceNo.trim() !== '')
        .length,
      acknowledgedLrCount,
      acknowledgedInvoiceCount,
      totalUploadedDocuments,
      documentCountsByCategory,
      documentCountsByType,
    };
  },

  // ── create ───────────────────────────────────────────────────────────────────
  async create(data: LrCreateInput) {
    // Auto-assign next serialNo per company inside a transaction to prevent
    // concurrent requests from receiving the same serial number.
    return db.$transaction(async (tx) => {
      const last = await tx.lr.findFirst({
        where: { companyId: data.companyId },
        orderBy: { serialNo: 'desc' },
        select: { serialNo: true },
      });
      const serialNo = (last?.serialNo ?? 0) + 1;

      return tx.lr.create({
        data: {
          ...data,
          serialNo,
          source: data.source ?? 'INTERNAL',
          // Keep legacy date in sync with lrDate
          date: data.lrDate ?? data.date,
        },
      });
    });
  },

  // ── update ───────────────────────────────────────────────────────────────────
  async update(id: string, data: LrUpdateInput) {
    // Keep legacy date in sync with lrDate when lrDate is explicitly provided
    const syncedData = data.lrDate !== undefined
      ? { ...data, date: data.lrDate ?? data.date }
      : data;
    return db.lr.update({ where: { id }, data: syncedData });
  },

  // ── delete ───────────────────────────────────────────────────────────────────
  async delete(id: string) {
    return db.lr.delete({ where: { id } });
  },
};

// ── Internal helper: map ScopeWhere → Prisma WhereInput ───────────────────────

function buildPrismaWhere(
  scope: ScopeWhere & { id?: string },
  q?: string,
  filters?: LrFilters,
): LrWhereInput {
  const where: LrWhereInput = {};

  if (scope.id) where.id = scope.id;
  if (scope.companyId) where.companyId = scope.companyId;

  if (scope.branchId) {
    where.branchId = scope.branchId.in.length === 1
      ? scope.branchId.in[0]
      : { in: scope.branchId.in };
  }

  if (scope.source) {
    where.source = scope.source.in.length === 1
      ? scope.source.in[0]
      : { in: scope.source.in };
  }

  // ── Additional filters ────────────────────────────────────────────────────────
  if (filters?.principalCompany) {
    where.principalCompany = filters.principalCompany;
  }

  if (filters?.branchId) {
    // Narrow only if the requested branch is within the user's allowed scope.
    const inScope = !scope.branchId || (Array.isArray(scope.branchId.in) && scope.branchId.in.includes(filters.branchId));
    if (inScope) {
      where.branchId = filters.branchId;
    } else {
      // The requested branch is outside the caller's scope; log a warning and
      // leave the existing scope restriction in place so no cross-branch data leaks.
      console.warn(`[lr.repo] branchId filter "${filters.branchId}" is outside caller scope — filter ignored`);
    }
  }

  if (filters?.lrDate) {
    where.lrDate = filters.lrDate;
  }

  if (filters?.invoiceDate) {
    where.companyInvoiceDate = filters.invoiceDate;
  }

  if (filters?.invoiceNo) {
    where.companyInvoiceNo = { contains: filters.invoiceNo };
  }

  if (filters?.lrNo) {
    where.lrNo = { contains: filters.lrNo };
  }

  if (filters?.vehicleNo) {
    where.vehicleNo = { contains: filters.vehicleNo };
  }

  if (filters?.driverName) {
    where.driverName = { contains: filters.driverName };
  }

  if (filters?.productName) {
    where.productName = { contains: filters.productName };
  }

  if (filters?.tptCode) {
    where.tptCode = { contains: filters.tptCode };
  }

  if (filters?.workingCenter) {
    where.workingCenter = { contains: filters.workingCenter };
  }

  if (filters?.depotPlantCode) {
    where.depotPlantCode = { contains: filters.depotPlantCode };
  }

  // ── Global search ─────────────────────────────────────────────────────────────
  if (q) {
    const term = q.trim();
    if (term) {
      where.OR = [
        { lrNo:               { contains: term } },
        { vehicleNo:          { contains: term } },
        { principalCompany:   { contains: term } },
        { billToParty:        { contains: term } },
        { shipToParty:        { contains: term } },
        { transporterName:    { contains: term } },
        { driverName:         { contains: term } },
        { driverCellNo:       { contains: term } },
        { productName:        { contains: term } },
        { loadingSlipNo:      { contains: term } },
        { companyInvoiceNo:   { contains: term } },
        { companyEwayBillNo:  { contains: term } },
        { deliveryDestination: { contains: term } },
      ];
    }
  }

  return where;
}