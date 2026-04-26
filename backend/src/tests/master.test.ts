/**
 * Unit tests for Master Data service.
 * Run with: npm test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ValidationError,
  NotFoundError,
  clampMasterLimit,
  clampMasterPage,
  MASTER_DEFAULT_LIMIT,
  MASTER_MAX_LIMIT,
} from '../services/masterService.js';
import { PERMISSIONS, ROLE_PERMISSION_MATRIX, ROLES } from '../modules/rbac/permissions.js';

// ── clampMasterLimit ──────────────────────────────────────────────────────────

describe('clampMasterLimit', () => {
  it('returns default when undefined', () => {
    expect(clampMasterLimit(undefined)).toBe(MASTER_DEFAULT_LIMIT);
  });
  it('returns default when NaN', () => {
    expect(clampMasterLimit(NaN)).toBe(MASTER_DEFAULT_LIMIT);
  });
  it('clamps 0 to 1', () => {
    expect(clampMasterLimit(0)).toBe(1);
  });
  it('clamps negative to 1', () => {
    expect(clampMasterLimit(-10)).toBe(1);
  });
  it('clamps above max', () => {
    expect(clampMasterLimit(9999)).toBe(MASTER_MAX_LIMIT);
  });
  it('passes through valid value', () => {
    expect(clampMasterLimit(30)).toBe(30);
  });
  it('floors decimals', () => {
    expect(clampMasterLimit(29.9)).toBe(29);
  });
});

// ── clampMasterPage ───────────────────────────────────────────────────────────

describe('clampMasterPage', () => {
  it('returns 1 when undefined', () => {
    expect(clampMasterPage(undefined)).toBe(1);
  });
  it('returns 1 when NaN', () => {
    expect(clampMasterPage(NaN)).toBe(1);
  });
  it('clamps 0 to 1', () => {
    expect(clampMasterPage(0)).toBe(1);
  });
  it('passes through positive value', () => {
    expect(clampMasterPage(5)).toBe(5);
  });
  it('floors decimal', () => {
    expect(clampMasterPage(3.7)).toBe(3);
  });
});

// ── ValidationError / NotFoundError class ────────────────────────────────────

describe('ValidationError', () => {
  it('has name ValidationError and includes message', () => {
    const e = new ValidationError('code is required');
    expect(e.name).toBe('ValidationError');
    expect(e.message).toBe('code is required');
    expect(e instanceof Error).toBe(true);
  });
});

describe('NotFoundError', () => {
  it('formats message with entity name', () => {
    const e = new NotFoundError('Transporter');
    expect(e.name).toBe('NotFoundError');
    expect(e.message).toBe('Transporter not found');
  });
});

// ── RBAC: master permissions in role matrix ───────────────────────────────────

describe('MASTER permissions in role matrix', () => {
  it('L1 has MASTER_READ but not MASTER_MANAGE', () => {
    const perms = ROLE_PERMISSION_MATRIX[ROLES.L1];
    expect(perms).toContain(PERMISSIONS.MASTER_READ);
    expect(perms).not.toContain(PERMISSIONS.MASTER_MANAGE);
  });

  it('L2 has MASTER_READ but not MASTER_MANAGE', () => {
    const perms = ROLE_PERMISSION_MATRIX[ROLES.L2];
    expect(perms).toContain(PERMISSIONS.MASTER_READ);
    expect(perms).not.toContain(PERMISSIONS.MASTER_MANAGE);
  });

  it('L3 has MASTER_READ but not MASTER_MANAGE', () => {
    const perms = ROLE_PERMISSION_MATRIX[ROLES.L3];
    expect(perms).toContain(PERMISSIONS.MASTER_READ);
    expect(perms).not.toContain(PERMISSIONS.MASTER_MANAGE);
  });

  it('ADMIN has both MASTER_READ and MASTER_MANAGE', () => {
    const perms = ROLE_PERMISSION_MATRIX[ROLES.ADMIN];
    expect(perms).toContain(PERMISSIONS.MASTER_READ);
    expect(perms).toContain(PERMISSIONS.MASTER_MANAGE);
  });

  it('SUPER_ADMIN has both MASTER_READ and MASTER_MANAGE', () => {
    const perms = ROLE_PERMISSION_MATRIX[ROLES.SUPER_ADMIN];
    expect(perms).toContain(PERMISSIONS.MASTER_READ);
    expect(perms).toContain(PERMISSIONS.MASTER_MANAGE);
  });
});

// ── DB-level functions (mocked) ───────────────────────────────────────────────

vi.mock('../lib/db.js', () => {
  const makeModel = () => ({
    create:     vi.fn(),
    findMany:   vi.fn(),
    findFirst:  vi.fn(),
    count:      vi.fn(),
    update:     vi.fn(),
    delete:     vi.fn(),
  });
  return {
    db: {
      transporter:   makeModel(),
      officer:       makeModel(),
      party:         makeModel(),
      product:       makeModel(),
      workingCentre: makeModel(),
    },
  };
});

import { db } from '../lib/db.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = db as any;

import {
  createTransporter, listTransporters, getTransporter,
  updateTransporter, deactivateTransporter, transporterDropdown,
  createOfficer, listOfficers, getOfficer, updateOfficer,
  deactivateOfficer, officerDropdown,
  createParty, listParties, getParty, updateParty,
  deactivateParty, partyDropdown,
  createProduct, listProducts, getProduct, updateProduct,
  deactivateProduct, productDropdown, productCategories,
  createWorkingCentre, listWorkingCentres, getWorkingCentre,
  updateWorkingCentre, deactivateWorkingCentre, workingCentreDropdown,
} from '../services/masterService.js';

beforeEach(() => vi.clearAllMocks());

// ── Transporter ───────────────────────────────────────────────────────────────

describe('createTransporter', () => {
  it('creates with uppercased code', async () => {
    m.transporter.create.mockResolvedValue({ id: 't1', code: 'ABC' });
    await createTransporter('co1', { code: 'abc', name: 'Fast Freight' });
    expect(m.transporter.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: 'ABC', companyId: 'co1' }) }),
    );
  });

  it('throws ValidationError when code is missing', async () => {
    await expect(createTransporter('co1', { code: '', name: 'X' }))
      .rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for invalid code characters', async () => {
    await expect(createTransporter('co1', { code: 'a b c!', name: 'X' }))
      .rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when name is missing', async () => {
    await expect(createTransporter('co1', { code: 'T01', name: '' }))
      .rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for invalid email', async () => {
    await expect(createTransporter('co1', { code: 'T01', name: 'X', email: 'not-email' }))
      .rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for invalid phone', async () => {
    await expect(createTransporter('co1', { code: 'T01', name: 'X', phone: '12' }))
      .rejects.toThrow(ValidationError);
  });

  it('re-throws ValidationError on unique constraint (P2002)', async () => {
    m.transporter.create.mockRejectedValue({ code: 'P2002' });
    await expect(createTransporter('co1', { code: 'T01', name: 'X' }))
      .rejects.toThrow(ValidationError);
  });
});

describe('listTransporters', () => {
  it('returns items and pagination', async () => {
    m.transporter.findMany.mockResolvedValue([{ id: 't1' }]);
    m.transporter.count.mockResolvedValue(1);
    const result = await listTransporters('co1', { page: 1, limit: 10 });
    expect(result.items).toHaveLength(1);
    expect(result.pagination).toMatchObject({ total: 1, page: 1, limit: 10, pages: 1 });
  });

  it('filters by isActive=true by default', async () => {
    m.transporter.findMany.mockResolvedValue([]);
    m.transporter.count.mockResolvedValue(0);
    await listTransporters('co1', {});
    expect(m.transporter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
    );
  });

  it('includes inactive when includeInactive=true', async () => {
    m.transporter.findMany.mockResolvedValue([]);
    m.transporter.count.mockResolvedValue(0);
    await listTransporters('co1', { includeInactive: true });
    const where = m.transporter.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('isActive');
  });
});

describe('getTransporter', () => {
  it('returns item when found', async () => {
    m.transporter.findFirst.mockResolvedValue({ id: 't1', companyId: 'co1' });
    const item = await getTransporter('t1', 'co1');
    expect(item.id).toBe('t1');
  });

  it('throws NotFoundError when not found', async () => {
    m.transporter.findFirst.mockResolvedValue(null);
    await expect(getTransporter('t99', 'co1')).rejects.toThrow(NotFoundError);
  });
});

describe('updateTransporter', () => {
  it('updates name', async () => {
    m.transporter.findFirst.mockResolvedValue({ id: 't1', companyId: 'co1' });
    m.transporter.update.mockResolvedValue({ id: 't1', name: 'New Name' });
    const res = await updateTransporter('t1', 'co1', { name: 'New Name' });
    expect(res.name).toBe('New Name');
  });

  it('throws ValidationError for invalid email on update', async () => {
    m.transporter.findFirst.mockResolvedValue({ id: 't1', companyId: 'co1' });
    await expect(updateTransporter('t1', 'co1', { email: 'bad' })).rejects.toThrow(ValidationError);
  });
});

describe('deactivateTransporter', () => {
  it('sets isActive=false', async () => {
    m.transporter.findFirst.mockResolvedValue({ id: 't1' });
    m.transporter.update.mockResolvedValue({ id: 't1', isActive: false });
    await deactivateTransporter('t1', 'co1');
    expect(m.transporter.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { isActive: false } });
  });

  it('throws NotFoundError when transporter not found', async () => {
    m.transporter.findFirst.mockResolvedValue(null);
    await expect(deactivateTransporter('t99', 'co1')).rejects.toThrow(NotFoundError);
  });
});

describe('transporterDropdown', () => {
  it('returns id+label+code+name for active records', async () => {
    m.transporter.findMany.mockResolvedValue([{ id: 't1', code: 'FF', name: 'Fast Freight' }]);
    const result = await transporterDropdown('co1');
    expect(result[0]).toMatchObject({ id: 't1', label: 'Fast Freight (FF)', code: 'FF', name: 'Fast Freight' });
  });

  it('only queries active transporters', async () => {
    m.transporter.findMany.mockResolvedValue([]);
    await transporterDropdown('co1');
    expect(m.transporter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co1', isActive: true } }),
    );
  });
});

// ── Officer ───────────────────────────────────────────────────────────────────

describe('createOfficer', () => {
  it('creates officer', async () => {
    m.officer.create.mockResolvedValue({ id: 'o1' });
    await createOfficer('co1', { name: 'Alice' });
    expect(m.officer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: 'co1', name: 'Alice' }) }),
    );
  });

  it('throws ValidationError when name is missing', async () => {
    await expect(createOfficer('co1', { name: '' })).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for invalid email', async () => {
    await expect(createOfficer('co1', { name: 'Bob', email: 'bad' })).rejects.toThrow(ValidationError);
  });
});

describe('officerDropdown', () => {
  it('returns label with role when role is set', async () => {
    m.officer.findMany.mockResolvedValue([{ id: 'o1', name: 'Alice', role: 'Manager' }]);
    const result = await officerDropdown('co1');
    expect(result[0].label).toBe('Alice (Manager)');
  });

  it('returns plain name when role is null', async () => {
    m.officer.findMany.mockResolvedValue([{ id: 'o1', name: 'Alice', role: null }]);
    const result = await officerDropdown('co1');
    expect(result[0].label).toBe('Alice');
  });
});

// ── Party ─────────────────────────────────────────────────────────────────────

describe('createParty', () => {
  it('creates party with uppercased code', async () => {
    m.party.create.mockResolvedValue({ id: 'p1', code: 'PT01' });
    await createParty('co1', { code: 'pt01', name: 'My Home Infra' });
    expect(m.party.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: 'PT01' }) }),
    );
  });

  it('throws ValidationError for missing code', async () => {
    await expect(createParty('co1', { code: '', name: 'X' })).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for missing name', async () => {
    await expect(createParty('co1', { code: 'X01', name: '' })).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for invalid GST-formatted email', async () => {
    await expect(createParty('co1', { code: 'X01', name: 'X', email: 'not-email' }))
      .rejects.toThrow(ValidationError);
  });

  it('re-throws ValidationError on unique constraint (P2002)', async () => {
    m.party.create.mockRejectedValue({ code: 'P2002' });
    await expect(createParty('co1', { code: 'X01', name: 'X' })).rejects.toThrow(ValidationError);
  });
});

describe('partyDropdown', () => {
  it('returns id+label+code+name', async () => {
    m.party.findMany.mockResolvedValue([{ id: 'p1', code: 'MH', name: 'My Home' }]);
    const result = await partyDropdown('co1');
    expect(result[0]).toMatchObject({ id: 'p1', label: 'My Home (MH)', code: 'MH', name: 'My Home' });
  });
});

// ── Product ───────────────────────────────────────────────────────────────────

describe('createProduct', () => {
  it('creates product', async () => {
    m.product.create.mockResolvedValue({ id: 'pr1' });
    await createProduct('co1', { name: 'Cement', brand: 'ACC', category: 'Building', unit: 'BAG' });
    expect(m.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Cement', brand: 'ACC', category: 'Building', unit: 'BAG' }),
      }),
    );
  });

  it('throws ValidationError when name is missing', async () => {
    await expect(createProduct('co1', { name: '' })).rejects.toThrow(ValidationError);
  });

  it('re-throws ValidationError on unique constraint (P2002)', async () => {
    m.product.create.mockRejectedValue({ code: 'P2002' });
    await expect(createProduct('co1', { name: 'X' })).rejects.toThrow(ValidationError);
  });
});

describe('productDropdown', () => {
  it('returns label with brand when brand is set', async () => {
    m.product.findMany.mockResolvedValue([{ id: 'pr1', name: 'Cement', brand: 'ACC', category: 'Building', unit: 'BAG' }]);
    const result = await productDropdown('co1');
    expect(result[0].label).toBe('Cement — ACC');
  });

  it('returns plain name when brand is null', async () => {
    m.product.findMany.mockResolvedValue([{ id: 'pr1', name: 'Sand', brand: null, category: null, unit: null }]);
    const result = await productDropdown('co1');
    expect(result[0].label).toBe('Sand');
  });

  it('filters by category when supplied', async () => {
    m.product.findMany.mockResolvedValue([]);
    await productDropdown('co1', 'Building');
    expect(m.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ category: 'Building' }) }),
    );
  });
});

describe('productCategories', () => {
  it('returns distinct category strings', async () => {
    m.product.findMany.mockResolvedValue([{ category: 'Building' }, { category: 'Steel' }]);
    const result = await productCategories('co1');
    expect(result).toEqual(['Building', 'Steel']);
  });
});

// ── WorkingCentre ─────────────────────────────────────────────────────────────

describe('createWorkingCentre', () => {
  it('creates with uppercased code', async () => {
    m.workingCentre.create.mockResolvedValue({ id: 'wc1', code: 'HQ01' });
    await createWorkingCentre('co1', { code: 'hq01', name: 'Head Office' });
    expect(m.workingCentre.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: 'HQ01' }) }),
    );
  });

  it('throws ValidationError for missing code', async () => {
    await expect(createWorkingCentre('co1', { code: '', name: 'X' })).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for missing name', async () => {
    await expect(createWorkingCentre('co1', { code: 'WC01', name: '' })).rejects.toThrow(ValidationError);
  });

  it('accepts optional branchId', async () => {
    m.workingCentre.create.mockResolvedValue({ id: 'wc1' });
    await createWorkingCentre('co1', { code: 'WC01', name: 'Mumbai', branchId: 'br1' });
    expect(m.workingCentre.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ branchId: 'br1' }) }),
    );
  });
});

describe('workingCentreDropdown', () => {
  it('returns id+label+code+name+branchId', async () => {
    m.workingCentre.findMany.mockResolvedValue([{ id: 'wc1', code: 'MUM', name: 'Mumbai', branchId: 'br1' }]);
    const result = await workingCentreDropdown('co1');
    expect(result[0]).toMatchObject({ id: 'wc1', label: 'Mumbai (MUM)', code: 'MUM', branchId: 'br1' });
  });

  it('filters by branchId when supplied', async () => {
    m.workingCentre.findMany.mockResolvedValue([]);
    await workingCentreDropdown('co1', 'br1');
    expect(m.workingCentre.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ branchId: 'br1' }) }),
    );
  });
});

describe('getWorkingCentre', () => {
  it('throws NotFoundError when not found', async () => {
    m.workingCentre.findFirst.mockResolvedValue(null);
    await expect(getWorkingCentre('wc99', 'co1')).rejects.toThrow(NotFoundError);
  });
});

// ── Cross-company isolation ───────────────────────────────────────────────────

describe('company scope isolation', () => {
  it('getTransporter passes companyId to findFirst for ownership check', async () => {
    m.transporter.findFirst.mockResolvedValue({ id: 't1', companyId: 'co1' });
    await getTransporter('t1', 'co1');
    expect(m.transporter.findFirst).toHaveBeenCalledWith({ where: { id: 't1', companyId: 'co1' } });
  });

  it('getTransporter returns NotFoundError when companyId mismatches', async () => {
    m.transporter.findFirst.mockResolvedValue(null); // Prisma returns null for companyId mismatch
    await expect(getTransporter('t1', 'co-other')).rejects.toThrow(NotFoundError);
  });

  it('getParty passes companyId to findFirst', async () => {
    m.party.findFirst.mockResolvedValue({ id: 'p1', companyId: 'co1' });
    await getParty('p1', 'co1');
    expect(m.party.findFirst).toHaveBeenCalledWith({ where: { id: 'p1', companyId: 'co1' } });
  });

  it('getOfficer passes companyId to findFirst', async () => {
    m.officer.findFirst.mockResolvedValue({ id: 'o1', companyId: 'co1' });
    await getOfficer('o1', 'co1');
    expect(m.officer.findFirst).toHaveBeenCalledWith({ where: { id: 'o1', companyId: 'co1' } });
  });

  it('listParties scopes query to companyId', async () => {
    m.party.findMany.mockResolvedValue([]);
    m.party.count.mockResolvedValue(0);
    await listParties('co-xyz', {});
    expect(m.party.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'co-xyz' }) }),
    );
  });

  it('listOfficers scopes query to companyId', async () => {
    m.officer.findMany.mockResolvedValue([]);
    m.officer.count.mockResolvedValue(0);
    await listOfficers('co-xyz', {});
    expect(m.officer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'co-xyz' }) }),
    );
  });
});

// ── listProducts category filter ──────────────────────────────────────────────

describe('listProducts', () => {
  it('filters by category when supplied', async () => {
    m.product.findMany.mockResolvedValue([]);
    m.product.count.mockResolvedValue(0);
    await listProducts('co1', { category: 'Steel' });
    expect(m.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ category: 'Steel' }) }),
    );
  });

  it('returns pagination metadata', async () => {
    m.product.findMany.mockResolvedValue([]);
    m.product.count.mockResolvedValue(0);
    const result = await listProducts('co1', { page: 2, limit: 10 });
    expect(result.pagination).toMatchObject({ page: 2, limit: 10 });
  });
});

// ── deactivateOfficer ─────────────────────────────────────────────────────────

describe('deactivateOfficer', () => {
  it('sets isActive=false', async () => {
    m.officer.findFirst.mockResolvedValue({ id: 'o1' });
    m.officer.update.mockResolvedValue({ id: 'o1', isActive: false });
    await deactivateOfficer('o1', 'co1');
    expect(m.officer.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { isActive: false } });
  });
});

// ── updateWorkingCentre ───────────────────────────────────────────────────────

describe('updateWorkingCentre', () => {
  it('updates name field', async () => {
    m.workingCentre.findFirst.mockResolvedValue({ id: 'wc1', companyId: 'co1', branch: null });
    m.workingCentre.update.mockResolvedValue({ id: 'wc1', name: 'Updated' });
    const res = await updateWorkingCentre('wc1', 'co1', { name: 'Updated' });
    expect(res.name).toBe('Updated');
  });

  it('throws ValidationError for invalid code format', async () => {
    m.workingCentre.findFirst.mockResolvedValue({ id: 'wc1', companyId: 'co1', branch: null });
    await expect(updateWorkingCentre('wc1', 'co1', { code: 'bad code!' })).rejects.toThrow(ValidationError);
  });
});
