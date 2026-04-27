/**
 * Unit tests for RBAC permission checks and scope building.
 * Run with: npm test
 */

import { describe, it, expect, vi } from 'vitest';
import { requirePermission, buildScopeWhere, requireScope } from '../modules/rbac/rbac.middleware.js';
import {
  PERMISSIONS,
  ROLE_PERMISSION_MATRIX,
  ROLES,
  ALLOWED_SOURCES,
  ALLOWED_LR_STATUSES,
} from '../modules/rbac/permissions.js';
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
function makeReqRes(user?: UserContext, params: Record<string, string> = {}, query: Record<string, string> = {}) {
  const req = { user, params, query } as unknown as Request;
  let statusCode = 200;
  let body: unknown;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(b: unknown) { body = b; return this; },
  } as unknown as Response;
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return {
    req,
    res,
    next,
    statusCode: () => statusCode,
    body: () => body,
    nextCalled: () => nextCalled,
  };
}

// ── requirePermission ─────────────────────────────────────────────────────────

describe('requirePermission', () => {
  it('calls next() when user has the required permission', () => {
    const { req, res, next, nextCalled } = makeReqRes(makeUser());
    requirePermission(PERMISSIONS.LR_READ)(req, res, next);
    expect(nextCalled()).toBe(true);
  });

  it('returns 403 when user lacks the permission', () => {
    const { req, res, next, body, nextCalled } = makeReqRes(makeUser({ permissionKeys: [PERMISSIONS.LR_READ] }));
    requirePermission(PERMISSIONS.LR_DELETE)(req, res, next);
    expect(nextCalled()).toBe(false);
    expect(body()).toMatchObject({ error: 'Forbidden' });
  });

  it('does not include missing key in 403 when NODE_ENV=production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { req, res, next, body } = makeReqRes(makeUser({ permissionKeys: [] }));
      requirePermission(PERMISSIONS.LR_DELETE)(req, res, next);
      expect(body()).not.toHaveProperty('missing');
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('includes missing key in 403 in non-production environments', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const { req, res, next, body } = makeReqRes(makeUser({ permissionKeys: [] }));
      requirePermission(PERMISSIONS.LR_DELETE)(req, res, next);
      expect(body()).toHaveProperty('missing', PERMISSIONS.LR_DELETE);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('returns 401 when no user is attached to the request', () => {
    const { req, res, next, statusCode } = makeReqRes(undefined);
    requirePermission(PERMISSIONS.LR_READ)(req, res, next);
    expect(statusCode()).toBe(401);
  });

  it('bypasses check for Super Admin regardless of permissionKeys', () => {
    const superAdmin = makeSuperAdmin();
    superAdmin.permissionKeys = []; // explicitly empty
    const { req, res, next, nextCalled } = makeReqRes(superAdmin);
    requirePermission(PERMISSIONS.ROLE_MANAGE)(req, res, next);
    expect(nextCalled()).toBe(true);
  });
});

// ── buildScopeWhere ───────────────────────────────────────────────────────────

describe('buildScopeWhere', () => {
  it('returns companyId, branchId IN, source IN for a regular user', () => {
    const where = buildScopeWhere(makeUser());
    expect(where).toMatchObject({
      companyId: 'company-1',
      branchId: { in: ['branch-1'] },
      source: { in: ['INTERNAL'] },
    });
  });

  it('returns an empty object for Super Admin (no scope restriction)', () => {
    expect(buildScopeWhere(makeSuperAdmin())).toEqual({});
  });

  it('accepts a companyId override for Super Admin', () => {
    const where = buildScopeWhere(makeSuperAdmin(), 'other-company');
    expect(where).toEqual({ companyId: 'other-company' });
  });

  it('omits branchId filter when user has no branch assignments', () => {
    const where = buildScopeWhere(makeUser({ branchIds: [] }));
    expect(where).not.toHaveProperty('branchId');
  });

  it('omits source filter when user has no source assignments', () => {
    const where = buildScopeWhere(makeUser({ allowedSources: [] }));
    expect(where).not.toHaveProperty('source');
  });

  it('includes multiple branchIds when user has multi-branch access', () => {
    const where = buildScopeWhere(makeUser({ branchIds: ['branch-1', 'branch-2'] }));
    expect(where.branchId).toEqual({ in: ['branch-1', 'branch-2'] });
  });
});

// ── requireScope ──────────────────────────────────────────────────────────────

describe('requireScope', () => {
  it('calls next() when requested branch is in user branchIds', () => {
    const { req, res, next, nextCalled } = makeReqRes(
      makeUser({ branchIds: ['branch-1'] }),
      { branchId: 'branch-1' }
    );
    requireScope({ branchParam: 'branchId' })(req, res, next);
    expect(nextCalled()).toBe(true);
  });

  it('returns 403 when requested branch is not in user branchIds', () => {
    const { req, res, next, statusCode, nextCalled } = makeReqRes(
      makeUser({ branchIds: ['branch-1'] }),
      { branchId: 'branch-99' }
    );
    requireScope({ branchParam: 'branchId' })(req, res, next);
    expect(nextCalled()).toBe(false);
    expect(statusCode()).toBe(403);
  });

  it('calls next() when requested source is in user allowedSources', () => {
    const { req, res, next, nextCalled } = makeReqRes(
      makeUser({ allowedSources: ['INTERNAL'] }),
      {},
      { source: 'INTERNAL' }
    );
    requireScope({ sourceParam: 'source' })(req, res, next);
    expect(nextCalled()).toBe(true);
  });

  it('returns 403 when requested source is not allowed', () => {
    const { req, res, next, statusCode, nextCalled } = makeReqRes(
      makeUser({ allowedSources: ['INTERNAL'] }),
      {},
      { source: 'PORTAL' }
    );
    requireScope({ sourceParam: 'source' })(req, res, next);
    expect(nextCalled()).toBe(false);
    expect(statusCode()).toBe(403);
  });

  it('bypasses scope check for Super Admin', () => {
    const { req, res, next, nextCalled } = makeReqRes(
      makeSuperAdmin(),
      { branchId: 'any-branch' }
    );
    requireScope({ branchParam: 'branchId' })(req, res, next);
    expect(nextCalled()).toBe(true);
  });

  it('returns 401 when no user is on the request', () => {
    const { req, res, next, statusCode } = makeReqRes(undefined);
    requireScope({ branchParam: 'branchId' })(req, res, next);
    expect(statusCode()).toBe(401);
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

  it('Super Admin has all permissions that Admin has', () => {
    const superPerms = ROLE_PERMISSION_MATRIX[ROLES.SUPER_ADMIN];
    ROLE_PERMISSION_MATRIX[ROLES.ADMIN].forEach((p) => expect(superPerms).toContain(p));
  });

  it('L2 does not have management permissions', () => {
    const perms = ROLE_PERMISSION_MATRIX[ROLES.L2];
    expect(perms).not.toContain(PERMISSIONS.USER_MANAGE);
    expect(perms).not.toContain(PERMISSIONS.ORG_MANAGE);
    expect(perms).not.toContain(PERMISSIONS.ROLE_MANAGE);
  });

  it('every permission in the matrix is a known PERMISSIONS constant', () => {
    const knownKeys = new Set(Object.values(PERMISSIONS));
    for (const [role, perms] of Object.entries(ROLE_PERMISSION_MATRIX)) {
      for (const p of perms) {
        expect(knownKeys.has(p as never), `unknown permission "${p}" on role ${role}`).toBe(true);
      }
    }
  });

  it('no role has duplicate permission entries', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSION_MATRIX)) {
      const unique = new Set(perms);
      expect(unique.size, `role ${role} has duplicate permissions`).toBe(perms.length);
    }
  });
});

// ── Domain constants ──────────────────────────────────────────────────────────

describe('ALLOWED_SOURCES', () => {
  it('contains INTERNAL', () => expect(ALLOWED_SOURCES).toContain('INTERNAL'));
  it('contains PORTAL',   () => expect(ALLOWED_SOURCES).toContain('PORTAL'));
  it('contains API',      () => expect(ALLOWED_SOURCES).toContain('API'));
  it('contains EMAIL_IMPORT', () => expect(ALLOWED_SOURCES).toContain('EMAIL_IMPORT'));
});

describe('ALLOWED_LR_STATUSES', () => {
  it('contains DRAFT',     () => expect(ALLOWED_LR_STATUSES).toContain('DRAFT'));
  it('contains SUBMITTED', () => expect(ALLOWED_LR_STATUSES).toContain('SUBMITTED'));
  it('contains APPROVED',  () => expect(ALLOWED_LR_STATUSES).toContain('APPROVED'));
  it('contains REJECTED',  () => expect(ALLOWED_LR_STATUSES).toContain('REJECTED'));
});
