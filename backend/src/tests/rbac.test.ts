/**
 * Unit tests for RBAC permission checks and scope building.
 * Run with: npm test
 */

import { describe, it, expect } from 'vitest';
import { requirePermission, buildScopeWhere } from '../modules/rbac/rbac.middleware.js';
import { PERMISSIONS, ROLE_PERMISSION_MATRIX, ROLES } from '../modules/rbac/permissions.js';
import type { UserContext } from '../modules/rbac/userContext.js';
import type { Request, Response } from 'express';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<UserContext> = {}): UserContext {
  return {
    id: 'user-1',
    companyId: 'company-1',
    roleKeys: ['L3'],
    permissionKeys: ROLE_PERMISSION_MATRIX[ROLES.L3] as string[],
    branchIds: ['branch-1'],
    allowedSources: ['INTERNAL'],
    isSuperAdmin: false,
    ...overrides,
  };
}

function makeSuperAdmin(): UserContext {
  return makeUser({ roleKeys: ['SUPER_ADMIN'], isSuperAdmin: true });
}

// Minimal mock for Express req/res/next
function makeReqRes(user?: UserContext) {
  const req = { user } as Request;
  let statusCode = 200;
  let body: unknown;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(b: unknown) { body = b; return this; },
    _statusCode: () => statusCode,
    _body: () => body,
  } as unknown as Response & { _statusCode: () => number; _body: () => unknown };
  const next = () => { /* noop */ };
  return { req, res, next, statusCode: () => statusCode, body: () => body };
}

// ── requirePermission ─────────────────────────────────────────────────────────

describe('requirePermission', () => {
  it('calls next() when user has the required permission', () => {
    const user = makeUser();
    const { req, res } = makeReqRes(user);
    let called = false;
    requirePermission(PERMISSIONS.LR_READ)(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  it('returns 403 when user lacks the permission', () => {
    const user = makeUser({ permissionKeys: [PERMISSIONS.LR_READ] });
    const { req, res, body } = makeReqRes(user);
    let called = false;
    requirePermission(PERMISSIONS.LR_DELETE)(req, res, () => { called = true; });
    expect(called).toBe(false);
    expect(body()).toMatchObject({ error: 'Forbidden', missing: PERMISSIONS.LR_DELETE });
  });

  it('returns 401 when no user is attached to the request', () => {
    const { req, res, statusCode } = makeReqRes(undefined);
    requirePermission(PERMISSIONS.LR_READ)(req, res, () => { /* should not be called */ });
    expect(statusCode()).toBe(401);
  });

  it('bypasses check for Super Admin regardless of permissionKeys', () => {
    const superAdmin = makeSuperAdmin();
    // Give super admin NO explicit permissions — bypass should still work
    superAdmin.permissionKeys = [];
    const { req, res } = makeReqRes(superAdmin);
    let called = false;
    requirePermission(PERMISSIONS.ROLE_MANAGE)(req, res, () => { called = true; });
    expect(called).toBe(true);
  });
});

// ── buildScopeWhere ───────────────────────────────────────────────────────────

describe('buildScopeWhere', () => {
  it('returns companyId, branchId IN, source IN for a regular user', () => {
    const user = makeUser();
    const where = buildScopeWhere(user);
    expect(where).toMatchObject({
      companyId: 'company-1',
      branchId: { in: ['branch-1'] },
      source: { in: ['INTERNAL'] },
    });
  });

  it('returns an empty object for Super Admin (no scope restriction)', () => {
    const user = makeSuperAdmin();
    const where = buildScopeWhere(user);
    expect(where).toEqual({});
  });

  it('omits branchId filter when user has no branch assignments', () => {
    const user = makeUser({ branchIds: [] });
    const where = buildScopeWhere(user);
    expect(where).not.toHaveProperty('branchId');
  });

  it('omits source filter when user has no source assignments', () => {
    const user = makeUser({ allowedSources: [] });
    const where = buildScopeWhere(user);
    expect(where).not.toHaveProperty('source');
  });

  it('includes multiple branchIds when user has multi-branch access', () => {
    const user = makeUser({ branchIds: ['branch-1', 'branch-2'] });
    const where = buildScopeWhere(user);
    expect(where.branchId).toEqual({ in: ['branch-1', 'branch-2'] });
  });
});

// ── Role-permission matrix sanity checks ─────────────────────────────────────

describe('ROLE_PERMISSION_MATRIX', () => {
  it('L2 can only read (no create/update/delete)', () => {
    const perms = ROLE_PERMISSION_MATRIX[ROLES.L2];
    expect(perms).toContain(PERMISSIONS.LR_READ);
    expect(perms).not.toContain(PERMISSIONS.LR_CREATE);
    expect(perms).not.toContain(PERMISSIONS.LR_UPDATE);
    expect(perms).not.toContain(PERMISSIONS.LR_DELETE);
  });

  it('L1 can create and read but not update or delete', () => {
    const perms = ROLE_PERMISSION_MATRIX[ROLES.L1];
    expect(perms).toContain(PERMISSIONS.LR_CREATE);
    expect(perms).toContain(PERMISSIONS.LR_READ);
    expect(perms).not.toContain(PERMISSIONS.LR_UPDATE);
    expect(perms).not.toContain(PERMISSIONS.LR_DELETE);
  });

  it('L3 has full LR CRUD', () => {
    const perms = ROLE_PERMISSION_MATRIX[ROLES.L3];
    [PERMISSIONS.LR_CREATE, PERMISSIONS.LR_READ, PERMISSIONS.LR_UPDATE, PERMISSIONS.LR_DELETE]
      .forEach((p) => expect(perms).toContain(p));
  });

  it('Admin has user and role management permissions', () => {
    const perms = ROLE_PERMISSION_MATRIX[ROLES.ADMIN];
    expect(perms).toContain(PERMISSIONS.USER_MANAGE);
    expect(perms).toContain(PERMISSIONS.ROLE_MANAGE);
  });

  it('Super Admin has all permissions', () => {
    const superPerms = ROLE_PERMISSION_MATRIX[ROLES.SUPER_ADMIN];
    const adminPerms = ROLE_PERMISSION_MATRIX[ROLES.ADMIN];
    adminPerms.forEach((p) => expect(superPerms).toContain(p));
  });

  it('L2 does not have management permissions', () => {
    const perms = ROLE_PERMISSION_MATRIX[ROLES.L2];
    expect(perms).not.toContain(PERMISSIONS.USER_MANAGE);
    expect(perms).not.toContain(PERMISSIONS.ORG_MANAGE);
    expect(perms).not.toContain(PERMISSIONS.ROLE_MANAGE);
  });
});
