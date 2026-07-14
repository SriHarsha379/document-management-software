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
  driverBillNo?: string;
  billDate?: string;
  billNo?: string;
  billAmount?: number;
};

export type LrUpdateInput = Partial<Omit<LrCreateInput, 'companyId' | 'createdBy'> & { status: string }>;

// Whitelist of columns users may sort by (prevents injection via dynamic field names).
const SORTABLE_FIELDS = new Set([
  'lrDate', 'lrNo', 'date', 'companyInvoiceNo', 'companyEwayBillNo',
  'loadingSlipNo', 'billNo', 'shipToParty', 'deliveryDestination',
  'quantityInBags', 'quantityInMt', 'productName', 'vehicleNo',
  'tptCode', 'driverName', 'serialNo', 'createdAt',
]);

export type LrFilters = {
  principalCompany?: string;
  branchId?: string;
  lrDate?: string;
  invoiceDate?: string;
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
        include: { company: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } } },
      }),
      db.lr.count({ where }),
    ]);
    return { rows, total };
  },

  // ── filterValues — distinct dropdown options for the filter panel ─────────────
  async filterValues(companyId: string): Promise<{ principalCompanies: string[] }> {
    const rows = await db.lr.findMany({
      where: { companyId },
      select: { principalCompany: true },
      distinct: ['principalCompany'],
      orderBy: { principalCompany: 'asc' },
    });
    return {
      principalCompanies: rows
        .map((r) => r.principalCompany)
        .filter((v): v is string => v !== null && v.trim() !== ''),
    };
  },

  // ── findFirst — used for single-row access (update/delete guards) ─────────────
  async findFirst(opts: { where: ScopeWhere & { id?: string } }) {
    const where: LrWhereInput = buildPrismaWhere(opts.where);
    return db.lr.findFirst({ where });
  },

  // ── summary — count of LRs vs Invoices for pie chart ─────────────────────────
  async summary(companyId: string): Promise<{ lrCount: number; invoiceCount: number }> {
    const [lrCount, invoiceCount] = await Promise.all([
      db.lr.count({ where: { companyId } }),
      db.document.count({ where: { type: 'INVOICE' } }),
    ]);
    return { lrCount, invoiceCount };
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
    const inScope = !scope.branchId || scope.branchId.in.includes(filters.branchId);
    if (inScope) {
      where.branchId = filters.branchId;
    }
  }

  if (filters?.lrDate) {
    where.lrDate = filters.lrDate;
  }

  if (filters?.invoiceDate) {
    where.companyInvoiceDate = filters.invoiceDate;
  }

  // ── Global search ─────────────────────────────────────────────────────────────
  if (q) {
    const term = q.trim();
    if (term) {
      where.OR = [
        { lrNo:            { contains: term } },
        { vehicleNo:       { contains: term } },
        { principalCompany:{ contains: term } },
        { billToParty:     { contains: term } },
        { shipToParty:     { contains: term } },
        { transporterName: { contains: term } },
        { driverName:      { contains: term } },
        { productName:     { contains: term } },
        { loadingSlipNo:   { contains: term } },
        { companyInvoiceNo:{ contains: term } },
        { companyEwayBillNo:{ contains: term } },
        { deliveryDestination: { contains: term } },
      ];
    }
  }

  return where;
}
