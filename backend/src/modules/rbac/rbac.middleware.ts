import type { Request, Response, NextFunction } from 'express';
import type { UserContext } from './userContext.js';

// ── requirePermission ──────────────────────────────────────────────────────────
// Route middleware that checks the authenticated user holds a specific permission.
// Super Admin users bypass all capability checks.
// In production the 403 body does not reveal which permission is missing, to
// avoid leaking the permission model to potential attackers.

export function requirePermission(permissionKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    if (user.isSuperAdmin) {
      return next();
    }

    if (!user.permissionKeys.includes(permissionKey)) {
      const isProduction = process.env.NODE_ENV === 'production';
      res.status(403).json({
        error: 'Forbidden',
        ...(isProduction ? {} : { missing: permissionKey }),
      });
      return;
    }

    next();
  };
}

// ── buildScopeWhere ────────────────────────────────────────────────────────────
// Returns a Prisma-compatible WHERE object that scopes any query to the rows
// the user is allowed to see.  NEVER filter in-memory — always pass this into
// the DB query so list endpoints cannot leak cross-branch/company data.
//
// Super Admin users receive an empty filter (no restriction).  Callers may
// provide an explicit companyId override (e.g. when super admin acts on behalf
// of a specific company).

export function buildScopeWhere(user: UserContext, overrideCompanyId?: string): ScopeWhere {
  if (user.isSuperAdmin) {
    return overrideCompanyId ? { companyId: overrideCompanyId } : {};
  }

  const where: ScopeWhere = { companyId: user.companyId };

  if (user.branchIds.length > 0) {
    where.branchId = { in: user.branchIds };
  }

  if (user.allowedSources.length > 0) {
    where.source = { in: user.allowedSources };
  }

  return where;
}

export interface ScopeWhere {
  companyId?: string;
  branchId?: { in: string[] };
  source?: { in: string[] };
}

// ── requireScope ──────────────────────────────────────────────────────────────
// Optional middleware for endpoints where scope params are supplied explicitly
// in the request (e.g. query param ?branchId=…).  Validates that the requesting
// user is actually allowed to access that branch/source/company.

export function requireScope(opts: {
  branchParam?: string;
  sourceParam?: string;
  companyParam?: string;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    if (user.isSuperAdmin) {
      return next();
    }

    if (opts.branchParam) {
      const requested = firstString(req.params[opts.branchParam] ?? req.query[opts.branchParam]);
      if (requested && !user.branchIds.includes(requested)) {
        res.status(403).json({ error: 'Forbidden: branch not in scope' });
        return;
      }
    }

    if (opts.sourceParam) {
      const requested = firstString(req.params[opts.sourceParam] ?? req.query[opts.sourceParam]);
      if (requested && !user.allowedSources.includes(requested)) {
        res.status(403).json({ error: 'Forbidden: source not in scope' });
        return;
      }
    }

    if (opts.companyParam) {
      const requested = firstString(req.params[opts.companyParam] ?? req.query[opts.companyParam]);
      if (requested && requested !== user.companyId) {
        res.status(403).json({ error: 'Forbidden: company not in scope' });
        return;
      }
    }

    next();
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Express query params may be string | string[] | ParsedQs — take the first
// string value and ignore everything else.
function firstString(value: string | string[] | object | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}
