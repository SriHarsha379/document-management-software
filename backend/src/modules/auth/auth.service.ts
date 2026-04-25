import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../../services/documentService.js';
import type { UserContext } from '../rbac/userContext.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET environment variable must be set in production');
}
const JWT_SECRET_VALUE = JWT_SECRET ?? 'change-me-in-development-only';
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN ?? '8h') as jwt.SignOptions['expiresIn'];

// ── loadUserContext ────────────────────────────────────────────────────────────
// Builds the full UserContext for a user by loading roles, permissions, branch
// access, and source access from the database.  The result is embedded in the
// JWT so subsequent requests do not need extra DB round-trips.

export async function loadUserContext(userId: string): Promise<UserContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId, isActive: true },
    include: {
      userRoles: {
        include: {
          role: {
            include: {
              rolePermissions: {
                include: { permission: true },
              },
            },
          },
        },
      },
      userBranchAccess: true,
      userSourceAccess: true,
    },
  });

  if (!user) return null;

  const roleKeys = user.userRoles.map((ur) => ur.role.key);
  const isSuperAdmin = roleKeys.includes('SUPER_ADMIN');

  const permissionKeys = Array.from(
    new Set(
      user.userRoles.flatMap((ur) =>
        ur.role.rolePermissions.map((rp) => rp.permission.key)
      )
    )
  );

  const branchIds = user.userBranchAccess.map((uba) => uba.branchId);
  const allowedSources = user.userSourceAccess.map((usa) => usa.source);

  return {
    id: user.id,
    companyId: user.companyId,
    roleKeys,
    permissionKeys,
    branchIds,
    allowedSources,
    isSuperAdmin,
  };
}

// ── signUserToken ──────────────────────────────────────────────────────────────

export function signUserToken(context: UserContext): string {
  return jwt.sign({ ...context, type: 'user' }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as string,
  } as jwt.SignOptions);
}

// ── verifyUserToken ────────────────────────────────────────────────────────────

export function verifyUserToken(token: string): UserContext | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as UserContext & { type: string };
    if (payload.type !== 'user') return null;
    return payload;
  } catch {
    return null;
  }
}

// ── loginUser ─────────────────────────────────────────────────────────────────

export async function loginUser(
  email: string,
  password: string
): Promise<{ token: string; user: UserContext } | null> {
  const dbUser = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (!dbUser || !dbUser.isActive) return null;

  const valid = await bcrypt.compare(password, dbUser.passwordHash);
  if (!valid) return null;

  const context = await loadUserContext(dbUser.id);
  if (!context) return null;

  const token = signUserToken(context);
  return { token, user: context };
}
