import { prisma } from '../../services/documentService.js';
import type { ScopeWhere } from '../rbac/rbac.middleware.js';
import type { Prisma } from '@prisma/client';

// ── LR Repository ─────────────────────────────────────────────────────────────
// All public methods accept a scopeWhere produced by buildScopeWhere(user).
// Callers MUST provide the scope — never call without it (except in tests with
// an explicit reason).

type LrWhereInput = Prisma.LrWhereInput;

export const lrRepo = {
  // ── findMany ─────────────────────────────────────────────────────────────────
  async findMany(opts: {
    where: ScopeWhere;
    limit?: number;
    offset?: number;
  }) {
    const where: LrWhereInput = buildPrismaWhere(opts.where);
    return prisma.lr.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 50,
      skip: opts.offset ?? 0,
      include: { company: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } } },
    });
  },

  // ── findFirst — used for single-row access (update/delete guards) ─────────────
  async findFirst(opts: { where: ScopeWhere & { id?: string } }) {
    const where: LrWhereInput = buildPrismaWhere(opts.where);
    return prisma.lr.findFirst({ where });
  },

  // ── create ───────────────────────────────────────────────────────────────────
  async create(data: {
    lrNo: string;
    companyId: string;
    branchId: string;
    source?: string;
    consignor?: string;
    consignee?: string;
    vehicleNo?: string;
    date?: string;
    createdBy?: string;
  }) {
    return prisma.lr.create({ data: { ...data, source: data.source ?? 'INTERNAL' } });
  },

  // ── update ───────────────────────────────────────────────────────────────────
  async update(id: string, data: Partial<{
    lrNo: string;
    status: string;
    consignor: string;
    consignee: string;
    vehicleNo: string;
    date: string;
  }>) {
    return prisma.lr.update({ where: { id }, data });
  },

  // ── delete ───────────────────────────────────────────────────────────────────
  async delete(id: string) {
    return prisma.lr.delete({ where: { id } });
  },
};

// ── Internal helper: map ScopeWhere → Prisma WhereInput ───────────────────────

function buildPrismaWhere(scope: ScopeWhere & { id?: string }): LrWhereInput {
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

  return where;
}
