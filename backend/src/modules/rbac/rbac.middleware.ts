import type { Request, Response, NextFunction } from 'express';
import type { UserContext } from './userContext.js';

// ── requirePermission ──────────────────────────────────────────────────────────
// Route middleware that checks the authenticated user holds a specific permission.
// Super Admin users bypass all capability checks.

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
      res.status(403).json({ error: 'Forbidden', missing: permissionKey });
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
// Super Admin users receive an empty filter (no restriction), or you can pass
// an explicit companyId override when needed.

export function buildScopeWhere(user: UserContext): ScopeWhere {
  if (user.isSuperAdmin) {
    return {};
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
      const requestedBranch = (req.params[opts.branchParam] ?? req.query[opts.branchParam]) as string | undefined;
      if (requestedBranch && !user.branchIds.includes(requestedBranch)) {
        res.status(403).json({ error: 'Forbidden: branch not in scope' });
        return;
      }
    }

    if (opts.sourceParam) {
      const requestedSource = (req.params[opts.sourceParam] ?? req.query[opts.sourceParam]) as string | undefined;
      if (requestedSource && !user.allowedSources.includes(requestedSource)) {
        res.status(403).json({ error: 'Forbidden: source not in scope' });
        return;
      }
    }

    if (opts.companyParam) {
      const requestedCompany = (req.params[opts.companyParam] ?? req.query[opts.companyParam]) as string | undefined;
      if (requestedCompany && requestedCompany !== user.companyId) {
        res.status(403).json({ error: 'Forbidden: company not in scope' });
        return;
      }
    }

    next();
  };
}
