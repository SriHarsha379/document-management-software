/**
 * masterService.ts
 *
 * CRUD and dropdown helpers for all five master-data entities:
 *   Transporter, Officer, Party, Product, WorkingCentre
 *
 * Design principles:
 * - All records are scoped to a companyId — never cross-company leakage.
 * - Soft-delete via isActive=false to preserve referential integrity.
 * - Hard validation before any write to the DB.
 * - Dropdowns return the minimal {id, label} shape needed for <select> components.
 */

import { db } from '../lib/db.js';

// ── Validation helpers ────────────────────────────────────────────────────────

// Use a length-bounded email check that avoids catastrophic backtracking.
// We split at '@' and validate each part separately to prevent ReDoS.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}$/;
const PHONE_RE = /^[+\d\s\-().]{7,20}$/;
const CODE_RE  = /^[A-Za-z0-9\-_]{1,30}$/;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function assertRequired(value: unknown, field: string): void {
  if (!value || (typeof value === 'string' && !value.trim())) {
    throw new ValidationError(`${field} is required`);
  }
}

function assertEmail(value: string | undefined | null, field: string): void {
  if (!value) return;
  const trimmed = value.trim();
  // Split at '@' and check both parts — avoids ReDoS from nested quantifiers
  const atIndex = trimmed.lastIndexOf('@');
  const isValid =
    atIndex > 0 &&
    atIndex < trimmed.length - 1 &&
    EMAIL_RE.test(trimmed) &&
    trimmed.slice(atIndex + 1).includes('.');
  if (!isValid) {
    throw new ValidationError(`${field} must be a valid email address`);
  }
}

function assertPhone(value: string | undefined | null, field: string): void {
  if (value && !PHONE_RE.test(value.trim())) {
    throw new ValidationError(`${field} must be a valid phone number (7-20 digits)`);
  }
}

function assertCode(value: string, field: string): void {
  if (!CODE_RE.test(value.trim())) {
    throw new ValidationError(`${field} must be 1-30 alphanumeric characters (hyphens and underscores allowed)`);
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function optStr(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : null;
  return s || null;
}

// ── Pagination helpers ────────────────────────────────────────────────────────

export const MASTER_DEFAULT_LIMIT = 50;
export const MASTER_MAX_LIMIT = 200;

export function clampMasterLimit(raw: number | undefined): number {
  if (raw === undefined || isNaN(raw)) return MASTER_DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(raw)), MASTER_MAX_LIMIT);
}

export function clampMasterPage(raw: number | undefined): number {
  if (raw === undefined || isNaN(raw)) return 1;
  return Math.max(1, Math.floor(raw));
}

export interface PaginationMeta {
  total: number;
  page:  number;
  limit: number;
  pages: number;
}

// ── Transporter ───────────────────────────────────────────────────────────────

export interface TransporterCreateInput {
  code:        string;
  name:        string;
  contactName?: string | null;
  phone?:       string | null;
  email?:       string | null;
  address?:     string | null;
}

export interface TransporterUpdateInput extends Partial<TransporterCreateInput> {
  isActive?: boolean;
}

function validateTransporter(data: TransporterCreateInput): void {
  assertRequired(data.code, 'code');
  assertCode(data.code, 'code');
  assertRequired(data.name, 'name');
  assertEmail(data.email, 'email');
  assertPhone(data.phone, 'phone');
}

export async function createTransporter(companyId: string, data: TransporterCreateInput) {
  validateTransporter(data);
  try {
    return await db.transporter.create({
      data: {
        companyId,
        code:        str(data.code).toUpperCase(),
        name:        str(data.name),
        contactName: optStr(data.contactName),
        phone:       optStr(data.phone),
        email:       optStr(data.email),
        address:     optStr(data.address),
      },
    });
  } catch (err: unknown) {
    if (isUniqueConstraintError(err)) {
      throw new ValidationError(`A transporter with code "${data.code}" already exists in this company`);
    }
    throw err;
  }
}

export async function listTransporters(
  companyId: string,
  opts: { page?: number; limit?: number; includeInactive?: boolean; search?: string },
) {
  const page  = clampMasterPage(opts.page);
  const limit = clampMasterLimit(opts.limit);

  const where = buildMasterWhere(companyId, opts.includeInactive, opts.search
    ? { OR: [{ name: { contains: opts.search } }, { code: { contains: opts.search } }] }
    : undefined);

  const [items, total] = await Promise.all([
    db.transporter.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
    db.transporter.count({ where }),
  ]);

  return { items, pagination: makePagination(total, page, limit) };
}

export async function getTransporter(id: string, companyId: string) {
  const item = await db.transporter.findFirst({ where: { id, companyId } });
  if (!item) throw new NotFoundError('Transporter');
  return item;
}

export async function updateTransporter(id: string, companyId: string, data: TransporterUpdateInput) {
  await getTransporter(id, companyId); // ownership check
  if (data.code !== undefined) {
    assertCode(data.code!, 'code');
  }
  if (data.email !== undefined) assertEmail(data.email, 'email');
  if (data.phone !== undefined) assertPhone(data.phone, 'phone');

  try {
    return await db.transporter.update({
      where: { id },
      data:  filterUndefined({
        code:        data.code ? str(data.code).toUpperCase() : undefined,
        name:        data.name ? str(data.name) : undefined,
        contactName: data.contactName !== undefined ? optStr(data.contactName) : undefined,
        phone:       data.phone !== undefined ? optStr(data.phone) : undefined,
        email:       data.email !== undefined ? optStr(data.email) : undefined,
        address:     data.address !== undefined ? optStr(data.address) : undefined,
        isActive:    data.isActive,
      }),
    });
  } catch (err: unknown) {
    if (isUniqueConstraintError(err)) {
      throw new ValidationError(`A transporter with code "${data.code}" already exists in this company`);
    }
    throw err;
  }
}

export async function deactivateTransporter(id: string, companyId: string) {
  await getTransporter(id, companyId);
  return db.transporter.update({ where: { id }, data: { isActive: false } });
}

export async function transporterDropdown(companyId: string) {
  const rows = await db.transporter.findMany({
    where: { companyId, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, code: true, name: true },
  });
  return rows.map((r) => ({ id: r.id, label: `${r.name} (${r.code})`, code: r.code, name: r.name }));
}

// ── Officer ───────────────────────────────────────────────────────────────────

export interface OfficerCreateInput {
  name:   string;
  phone?: string | null;
  email?: string | null;
  role?:  string | null;
}

export interface OfficerUpdateInput extends Partial<OfficerCreateInput> {
  isActive?: boolean;
}

function validateOfficer(data: OfficerCreateInput): void {
  assertRequired(data.name, 'name');
  assertEmail(data.email, 'email');
  assertPhone(data.phone, 'phone');
}

export async function createOfficer(companyId: string, data: OfficerCreateInput) {
  validateOfficer(data);
  return db.officer.create({
    data: {
      companyId,
      name:  str(data.name),
      phone: optStr(data.phone),
      email: optStr(data.email),
      role:  optStr(data.role),
    },
  });
}

export async function listOfficers(
  companyId: string,
  opts: { page?: number; limit?: number; includeInactive?: boolean; search?: string },
) {
  const page  = clampMasterPage(opts.page);
  const limit = clampMasterLimit(opts.limit);

  const where = buildMasterWhere(companyId, opts.includeInactive, opts.search
    ? { name: { contains: opts.search } }
    : undefined);

  const [items, total] = await Promise.all([
    db.officer.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
    db.officer.count({ where }),
  ]);

  return { items, pagination: makePagination(total, page, limit) };
}

export async function getOfficer(id: string, companyId: string) {
  const item = await db.officer.findFirst({ where: { id, companyId } });
  if (!item) throw new NotFoundError('Officer');
  return item;
}

export async function updateOfficer(id: string, companyId: string, data: OfficerUpdateInput) {
  await getOfficer(id, companyId);
  if (data.email !== undefined) assertEmail(data.email, 'email');
  if (data.phone !== undefined) assertPhone(data.phone, 'phone');
  return db.officer.update({
    where: { id },
    data:  filterUndefined({
      name:     data.name ? str(data.name) : undefined,
      phone:    data.phone !== undefined ? optStr(data.phone) : undefined,
      email:    data.email !== undefined ? optStr(data.email) : undefined,
      role:     data.role  !== undefined ? optStr(data.role)  : undefined,
      isActive: data.isActive,
    }),
  });
}

export async function deactivateOfficer(id: string, companyId: string) {
  await getOfficer(id, companyId);
  return db.officer.update({ where: { id }, data: { isActive: false } });
}

export async function officerDropdown(companyId: string) {
  const rows = await db.officer.findMany({
    where: { companyId, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, role: true },
  });
  return rows.map((r) => ({ id: r.id, label: r.role ? `${r.name} (${r.role})` : r.name, name: r.name }));
}

// ── Party ─────────────────────────────────────────────────────────────────────

export interface PartyCreateInput {
  code:          string;
  name:          string;
  contactPerson?: string | null;
  phone?:         string | null;
  email?:         string | null;
  gstNo?:         string | null;
  address?:       string | null;
}

export interface PartyUpdateInput extends Partial<PartyCreateInput> {
  isActive?: boolean;
}

function validateParty(data: PartyCreateInput): void {
  assertRequired(data.code, 'code');
  assertCode(data.code, 'code');
  assertRequired(data.name, 'name');
  assertEmail(data.email, 'email');
  assertPhone(data.phone, 'phone');
}

export async function createParty(companyId: string, data: PartyCreateInput) {
  validateParty(data);
  try {
    return await db.party.create({
      data: {
        companyId,
        code:          str(data.code).toUpperCase(),
        name:          str(data.name),
        contactPerson: optStr(data.contactPerson),
        phone:         optStr(data.phone),
        email:         optStr(data.email),
        gstNo:         optStr(data.gstNo),
        address:       optStr(data.address),
      },
    });
  } catch (err: unknown) {
    if (isUniqueConstraintError(err)) {
      throw new ValidationError(`A party with code "${data.code}" already exists in this company`);
    }
    throw err;
  }
}

export async function listParties(
  companyId: string,
  opts: { page?: number; limit?: number; includeInactive?: boolean; search?: string },
) {
  const page  = clampMasterPage(opts.page);
  const limit = clampMasterLimit(opts.limit);

  const where = buildMasterWhere(companyId, opts.includeInactive, opts.search
    ? { OR: [{ name: { contains: opts.search } }, { code: { contains: opts.search } }] }
    : undefined);

  const [items, total] = await Promise.all([
    db.party.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
    db.party.count({ where }),
  ]);

  return { items, pagination: makePagination(total, page, limit) };
}

export async function getParty(id: string, companyId: string) {
  const item = await db.party.findFirst({ where: { id, companyId } });
  if (!item) throw new NotFoundError('Party');
  return item;
}

export async function updateParty(id: string, companyId: string, data: PartyUpdateInput) {
  await getParty(id, companyId);
  if (data.code !== undefined) assertCode(data.code!, 'code');
  if (data.email !== undefined) assertEmail(data.email, 'email');
  if (data.phone !== undefined) assertPhone(data.phone, 'phone');
  try {
    return await db.party.update({
      where: { id },
      data:  filterUndefined({
        code:          data.code ? str(data.code).toUpperCase() : undefined,
        name:          data.name ? str(data.name) : undefined,
        contactPerson: data.contactPerson !== undefined ? optStr(data.contactPerson) : undefined,
        phone:         data.phone   !== undefined ? optStr(data.phone)   : undefined,
        email:         data.email   !== undefined ? optStr(data.email)   : undefined,
        gstNo:         data.gstNo   !== undefined ? optStr(data.gstNo)   : undefined,
        address:       data.address !== undefined ? optStr(data.address) : undefined,
        isActive:      data.isActive,
      }),
    });
  } catch (err: unknown) {
    if (isUniqueConstraintError(err)) {
      throw new ValidationError(`A party with code "${data.code}" already exists in this company`);
    }
    throw err;
  }
}

export async function deactivateParty(id: string, companyId: string) {
  await getParty(id, companyId);
  return db.party.update({ where: { id }, data: { isActive: false } });
}

export async function partyDropdown(companyId: string) {
  const rows = await db.party.findMany({
    where: { companyId, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, code: true, name: true },
  });
  return rows.map((r) => ({ id: r.id, label: `${r.name} (${r.code})`, code: r.code, name: r.name }));
}

// ── Product ───────────────────────────────────────────────────────────────────

export interface ProductCreateInput {
  name:      string;
  brand?:    string | null;
  category?: string | null;
  unit?:     string | null;
}

export interface ProductUpdateInput extends Partial<ProductCreateInput> {
  isActive?: boolean;
}

function validateProduct(data: ProductCreateInput): void {
  assertRequired(data.name, 'name');
}

export async function createProduct(companyId: string, data: ProductCreateInput) {
  validateProduct(data);
  try {
    return await db.product.create({
      data: {
        companyId,
        name:     str(data.name),
        brand:    optStr(data.brand),
        category: optStr(data.category),
        unit:     optStr(data.unit),
      },
    });
  } catch (err: unknown) {
    if (isUniqueConstraintError(err)) {
      throw new ValidationError(`A product with this name and brand already exists in this company`);
    }
    throw err;
  }
}

export async function listProducts(
  companyId: string,
  opts: { page?: number; limit?: number; includeInactive?: boolean; search?: string; category?: string },
) {
  const page  = clampMasterPage(opts.page);
  const limit = clampMasterLimit(opts.limit);

  const extraWhere: Record<string, unknown> = {};
  if (opts.search) extraWhere.OR = [{ name: { contains: opts.search } }, { brand: { contains: opts.search } }];
  if (opts.category) extraWhere.category = opts.category;

  const where = buildMasterWhere(companyId, opts.includeInactive, Object.keys(extraWhere).length ? extraWhere : undefined);

  const [items, total] = await Promise.all([
    db.product.findMany({ where, orderBy: [{ category: 'asc' }, { name: 'asc' }], skip: (page - 1) * limit, take: limit }),
    db.product.count({ where }),
  ]);

  return { items, pagination: makePagination(total, page, limit) };
}

export async function getProduct(id: string, companyId: string) {
  const item = await db.product.findFirst({ where: { id, companyId } });
  if (!item) throw new NotFoundError('Product');
  return item;
}

export async function updateProduct(id: string, companyId: string, data: ProductUpdateInput) {
  await getProduct(id, companyId);
  if (data.name !== undefined) assertRequired(data.name, 'name');
  try {
    return await db.product.update({
      where: { id },
      data:  filterUndefined({
        name:     data.name     ? str(data.name)     : undefined,
        brand:    data.brand    !== undefined ? optStr(data.brand)    : undefined,
        category: data.category !== undefined ? optStr(data.category) : undefined,
        unit:     data.unit     !== undefined ? optStr(data.unit)     : undefined,
        isActive: data.isActive,
      }),
    });
  } catch (err: unknown) {
    if (isUniqueConstraintError(err)) {
      throw new ValidationError('A product with this name and brand already exists in this company');
    }
    throw err;
  }
}

export async function deactivateProduct(id: string, companyId: string) {
  await getProduct(id, companyId);
  return db.product.update({ where: { id }, data: { isActive: false } });
}

export async function productDropdown(companyId: string, category?: string) {
  const rows = await db.product.findMany({
    where: { companyId, isActive: true, ...(category ? { category } : {}) },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, brand: true, category: true, unit: true },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.brand ? `${r.name} — ${r.brand}` : r.name,
    name: r.name,
    brand: r.brand,
    category: r.category,
    unit: r.unit,
  }));
}

/** Return distinct category values for this company (for filter dropdowns). */
export async function productCategories(companyId: string) {
  const rows = await db.product.findMany({
    where:    { companyId, isActive: true, NOT: { category: null } },
    distinct: ['category'],
    select:   { category: true },
    orderBy:  { category: 'asc' },
  });
  return rows.map((r) => r.category as string);
}

// ── WorkingCentre ─────────────────────────────────────────────────────────────

export interface WorkingCentreCreateInput {
  code:      string;
  name:      string;
  address?:  string | null;
  branchId?: string | null;
}

export interface WorkingCentreUpdateInput extends Partial<WorkingCentreCreateInput> {
  isActive?: boolean;
}

function validateWorkingCentre(data: WorkingCentreCreateInput): void {
  assertRequired(data.code, 'code');
  assertCode(data.code, 'code');
  assertRequired(data.name, 'name');
}

export async function createWorkingCentre(companyId: string, data: WorkingCentreCreateInput) {
  validateWorkingCentre(data);
  try {
    return await db.workingCentre.create({
      data: {
        companyId,
        code:     str(data.code).toUpperCase(),
        name:     str(data.name),
        address:  optStr(data.address),
        branchId: optStr(data.branchId),
      },
    });
  } catch (err: unknown) {
    if (isUniqueConstraintError(err)) {
      throw new ValidationError(`A working centre with code "${data.code}" already exists in this company`);
    }
    throw err;
  }
}

export async function listWorkingCentres(
  companyId: string,
  opts: { page?: number; limit?: number; includeInactive?: boolean; search?: string; branchId?: string },
) {
  const page  = clampMasterPage(opts.page);
  const limit = clampMasterLimit(opts.limit);

  const extraWhere: Record<string, unknown> = {};
  if (opts.search)   extraWhere.OR = [{ name: { contains: opts.search } }, { code: { contains: opts.search } }];
  if (opts.branchId) extraWhere.branchId = opts.branchId;

  const where = buildMasterWhere(companyId, opts.includeInactive, Object.keys(extraWhere).length ? extraWhere : undefined);

  const [items, total] = await Promise.all([
    db.workingCentre.findMany({
      where,
      include: { branch: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.workingCentre.count({ where }),
  ]);

  return { items, pagination: makePagination(total, page, limit) };
}

export async function getWorkingCentre(id: string, companyId: string) {
  const item = await db.workingCentre.findFirst({
    where:   { id, companyId },
    include: { branch: { select: { id: true, name: true } } },
  });
  if (!item) throw new NotFoundError('WorkingCentre');
  return item;
}

export async function updateWorkingCentre(id: string, companyId: string, data: WorkingCentreUpdateInput) {
  await getWorkingCentre(id, companyId);
  if (data.code !== undefined) assertCode(data.code!, 'code');
  try {
    return await db.workingCentre.update({
      where: { id },
      data:  filterUndefined({
        code:     data.code    ? str(data.code).toUpperCase() : undefined,
        name:     data.name    ? str(data.name)    : undefined,
        address:  data.address !== undefined ? optStr(data.address)  : undefined,
        branchId: data.branchId !== undefined ? optStr(data.branchId) : undefined,
        isActive: data.isActive,
      }),
    });
  } catch (err: unknown) {
    if (isUniqueConstraintError(err)) {
      throw new ValidationError(`A working centre with code "${data.code}" already exists in this company`);
    }
    throw err;
  }
}

export async function deactivateWorkingCentre(id: string, companyId: string) {
  await getWorkingCentre(id, companyId);
  return db.workingCentre.update({ where: { id }, data: { isActive: false } });
}

export async function workingCentreDropdown(companyId: string, branchId?: string) {
  const rows = await db.workingCentre.findMany({
    where: { companyId, isActive: true, ...(branchId ? { branchId } : {}) },
    orderBy: { name: 'asc' },
    select: { id: true, code: true, name: true, branchId: true },
  });
  return rows.map((r) => ({ id: r.id, label: `${r.name} (${r.code})`, code: r.code, name: r.name, branchId: r.branchId }));
}

// ── Shared helpers ────────────────────────────────────────────────────────────

export class NotFoundError extends Error {
  constructor(entity: string) {
    super(`${entity} not found`);
    this.name = 'NotFoundError';
  }
}

/** Build a standard WHERE with company scope, active filter, and optional extra clauses. */
function buildMasterWhere(
  companyId: string,
  includeInactive?: boolean,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    companyId,
    ...(!includeInactive ? { isActive: true } : {}),
    ...(extra ?? {}),
  };
}

function makePagination(total: number, page: number, limit: number): PaginationMeta {
  return { total, page, limit, pages: Math.ceil(total / limit) };
}

/** Remove undefined values so Prisma doesn't accidentally null-out fields. */
function filterUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** Detect Prisma unique constraint violation (P2002). */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
}
