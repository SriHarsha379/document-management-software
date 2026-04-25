// ── UserContext type ───────────────────────────────────────────────────────────
// Attached to req.user by requireAuth middleware after JWT verification.

export interface UserContext {
  id: string;
  companyId: string;
  roleKeys: string[];
  permissionKeys: string[];
  branchIds: string[];
  allowedSources: string[];
  isSuperAdmin: boolean;
}

// ── Extend Express Request ─────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      user?: UserContext;
    }
  }
}

export {};
