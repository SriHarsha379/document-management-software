import { PrismaClient } from '@prisma/client';

// Single shared Prisma instance for the entire backend.
// Prisma recommends one instance per process to avoid connection exhaustion.
// All modules should import `db` from here — not from documentService.

declare global {
  // Allow reuse of the instance across hot-reloads in tsx watch mode
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const db: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = db;
}
