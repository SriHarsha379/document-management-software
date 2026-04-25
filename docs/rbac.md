# RBAC System – Logistics DMS

This document describes the Role-Based Access Control (RBAC) system implemented in the backend, including the role–permission matrix, row-level access rules, how to protect new endpoints, and how to run migrations and seed data.

---

## Table of Contents

1. [Roles](#roles)
2. [Permission Keys](#permission-keys)
3. [Role–Permission Matrix](#rolepermission-matrix)
4. [Row-Level Access Rules](#row-level-access-rules)
5. [How to Protect New Endpoints](#how-to-protect-new-endpoints)
6. [Migrations & Seeding](#migrations--seeding)
7. [Authentication Flow](#authentication-flow)
8. [Security Hardening Notes](#security-hardening-notes)
9. [API Reference](#api-reference)

---

## Roles

| Role key     | Display name          | Scope      |
|--------------|-----------------------|------------|
| `L1`         | L1 – Data Entry       | Company    |
| `L2`         | L2 – View Only        | Company    |
| `L3`         | L3 – Edit / Delete    | Company    |
| `ADMIN`      | Admin                 | Company    |
| `SUPER_ADMIN`| Super Admin           | **Global** |

- All roles except `SUPER_ADMIN` are scoped to a single company.
- `SUPER_ADMIN` bypasses all scope filters and all permission checks.

---

## Permission Keys

| Permission key                  | Resource   | Action              | Description                                 |
|---------------------------------|------------|---------------------|---------------------------------------------|
| `lr.create`                     | lr         | create              | Create a new LR record                      |
| `lr.read`                       | lr         | read                | Read / list LR records                      |
| `lr.update`                     | lr         | update              | Update an LR record                         |
| `lr.delete`                     | lr         | delete              | Delete an LR record                         |
| `invoice.create`                | invoice    | create              | Create an invoice                           |
| `invoice.read`                  | invoice    | read                | Read / list invoices                        |
| `invoice.update`                | invoice    | update              | Update an invoice                           |
| `invoice.delete`                | invoice    | delete              | Delete an invoice                           |
| `document.upload`               | document   | upload              | Upload a document / attachment              |
| `document.read`                 | document   | read                | Read / download a document                  |
| `document.delete`               | document   | delete              | Delete a document                           |
| `workflow.transition.submit`    | workflow   | transition.submit   | Submit a workflow case                      |
| `workflow.transition.approve`   | workflow   | transition.approve  | Approve a workflow case                     |
| `workflow.transition.reject`    | workflow   | transition.reject   | Reject a workflow case                      |
| `workflow.override`             | workflow   | override            | Override workflow state                     |
| `org.manage`                    | org        | manage              | Manage org / branch / centre settings       |
| `user.manage`                   | user       | manage              | Manage users within company                 |
| `role.manage`                   | role       | manage              | Manage role-permission assignments          |
| `audit.read`                    | audit      | read                | Read audit logs                             |
| `export.run`                    | export     | run                 | Run data exports (CSV / PDF)                |

---

## Role–Permission Matrix

| Permission                      | L1 | L2 | L3 | ADMIN | SUPER_ADMIN |
|---------------------------------|----|----|----|-------|-------------|
| `lr.create`                     | ✓  |    | ✓  | ✓     | ✓           |
| `lr.read`                       | ✓  | ✓  | ✓  | ✓     | ✓           |
| `lr.update`                     |    |    | ✓  | ✓     | ✓           |
| `lr.delete`                     |    |    | ✓  | ✓     | ✓           |
| `invoice.create`                | ✓  |    | ✓  | ✓     | ✓           |
| `invoice.read`                  | ✓  | ✓  | ✓  | ✓     | ✓           |
| `invoice.update`                |    |    | ✓  | ✓     | ✓           |
| `invoice.delete`                |    |    | ✓  | ✓     | ✓           |
| `document.upload`               | ✓  |    | ✓  | ✓     | ✓           |
| `document.read`                 | ✓  | ✓  | ✓  | ✓     | ✓           |
| `document.delete`               |    |    | ✓  | ✓     | ✓           |
| `workflow.transition.submit`    | ✓  |    | ✓  | ✓     | ✓           |
| `workflow.transition.approve`   |    |    | ✓  | ✓     | ✓           |
| `workflow.transition.reject`    |    |    | ✓  | ✓     | ✓           |
| `workflow.override`             |    |    |    | ✓     | ✓           |
| `org.manage`                    |    |    |    | ✓     | ✓           |
| `user.manage`                   |    |    |    | ✓     | ✓           |
| `role.manage`                   |    |    |    | ✓     | ✓           |
| `audit.read`                    |    | ✓  | ✓  | ✓     | ✓           |
| `export.run`                    |    |    | ✓  | ✓     | ✓           |

---

## Row-Level Access Rules

Every business record (`Lr`, `Invoice`, `Document`, `WorkflowCase`, …) carries three **scope columns**:

| Column       | Meaning                                          |
|--------------|--------------------------------------------------|
| `companyId`  | Tenant boundary — user must belong to same company |
| `branchId`   | Org boundary — user must have branch in `user_branch_access` |
| `source`     | Channel boundary — user must have source in `user_source_access` |

### Valid source values (`ALLOWED_SOURCES`)

| Value          | Meaning                          |
|----------------|----------------------------------|
| `INTERNAL`     | Created by internal staff        |
| `PORTAL`       | Submitted via customer portal    |
| `API`          | Submitted via external API       |
| `EMAIL_IMPORT` | Ingested from email              |

### Valid LR status values (`ALLOWED_LR_STATUSES`)

`DRAFT` → `SUBMITTED` → `APPROVED` / `REJECTED`

### Scope resolution

```
user may act on row  ⟺
  row.companyId = user.companyId
  AND (row.branchId IN user.branchIds OR user has no branch restrictions)
  AND (row.source  IN user.allowedSources OR user has no source restrictions)
  AND user has the required permission
```

`SUPER_ADMIN` bypasses all scope filters (returns empty WHERE clause).
Optionally pass a `companyId` override to `buildScopeWhere(user, companyId)` when a Super Admin acts on behalf of a specific company.

### Golden rule

**Never** fetch a row by ID and then check the branch/company after-the-fact.
Always pass `buildScopeWhere(user)` into the initial DB query so that out-of-scope rows return `null`/`404` rather than a permission error that leaks existence.

---

## How to Protect New Endpoints

### 1. Require authentication

```typescript
import { requireAuth } from '../modules/auth/auth.routes.js';

router.use(requireAuth);               // apply to whole router
// OR
router.get('/invoices', requireAuth, handler);
```

### 2. Add rate limiting

```typescript
import rateLimit from 'express-rate-limit';

const readLimiter  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

router.get('/invoices',      readLimiter,  requireAuth, handler);
router.patch('/invoices/:id', writeLimiter, requireAuth, handler);
```

### 3. Require a specific permission

```typescript
import { requirePermission } from '../modules/rbac/rbac.middleware.js';
import { PERMISSIONS } from '../modules/rbac/permissions.js';

router.get(
  '/invoices',
  readLimiter,
  requireAuth,
  requirePermission(PERMISSIONS.INVOICE_READ),
  handler,
);
```

### 4. Apply row-level scope in your repository query

```typescript
import { buildScopeWhere } from '../modules/rbac/rbac.middleware.js';

async function handler(req, res) {
  const where = buildScopeWhere(req.user!);   // ← always include this
  const { rows, total } = await invoiceRepo.findMany({ where });
  res.json({ data: rows, total });
}
```

### 5. Fetch-with-scope for write operations (prevents existence leaks)

```typescript
router.patch('/invoices/:id', writeLimiter, requireAuth, requirePermission('invoice.update'), async (req, res) => {
  const where = buildScopeWhere(req.user!);
  // Out-of-scope rows return 404, not a permission error that reveals existence
  const invoice = await invoiceRepo.findFirst({ where: { ...where, id: req.params.id } });
  if (!invoice) return res.status(404).json({ error: 'Not found' });

  const updated = await invoiceRepo.update(invoice.id, req.body);
  res.json({ data: updated });
});
```

### 6. Validate enum inputs before writing

```typescript
import { ALLOWED_SOURCES, ALLOWED_LR_STATUSES } from '../modules/rbac/permissions.js';

if (source && !(ALLOWED_SOURCES as readonly string[]).includes(source)) {
  return res.status(400).json({ error: `source must be one of: ${ALLOWED_SOURCES.join(', ')}` });
}
```

### 7. Sanitise error responses

```typescript
// Log server-side, never leak DB errors to clients in production
function handleRouteError(err: unknown, res: Response, context: string): void {
  console.error(`${context}:`, err);
  const message = process.env.NODE_ENV !== 'production' && err instanceof Error
    ? err.message
    : 'An unexpected error occurred';
  res.status(500).json({ error: message });
}
```

### 8. Optional: explicit scope validation for query-param endpoints

```typescript
import { requireScope } from '../modules/rbac/rbac.middleware.js';

router.get(
  '/reports',
  readLimiter,
  requireAuth,
  requirePermission('export.run'),
  requireScope({ branchParam: 'branchId', sourceParam: 'source' }),
  handler,
);
```

---

## Migrations & Seeding

### Run migrations

```bash
cd backend

# Development (creates + applies migration)
npm run db:migrate

# Apply existing migrations without creating new ones (CI / production)
npx prisma migrate deploy
```

### Generate Prisma client after schema changes

```bash
npm run db:generate
```

### Seed roles, permissions, and demo users

```bash
cd backend
npm run db:seed
```

This creates:

| Entity               | Details                                                  |
|----------------------|----------------------------------------------------------|
| 20 permissions       | All permission keys in the matrix                        |
| 5 roles              | L1, L2, L3, ADMIN, SUPER_ADMIN                           |
| Role-permission matrix | Fully populated, wrapped in a transaction              |
| Demo company         | "Demo Logistics Co."                                     |
| Demo branch          | "Head Office"                                            |
| Admin user           | `admin@demo.com` / `Admin@1234`                          |
| Super Admin user     | `superadmin@demo.com` / `Super@1234`                     |

> **Change demo passwords before deploying to production.**

---

## Authentication Flow

1. `POST /api/auth/login` with `{ email, password }`.
2. Server validates credentials (bcrypt, cost factor 12), loads roles/permissions/branch/source from DB, and returns a **signed JWT** containing the full `UserContext`.
3. Client includes the token as `Authorization: Bearer <token>` on subsequent requests.
4. `requireAuth` middleware verifies the JWT signature and attaches `req.user: UserContext`.
5. `requirePermission(key)` checks `req.user.permissionKeys` (Super Admin bypasses).
6. `buildScopeWhere(req.user)` returns a Prisma WHERE clause that every repository query must include.

### UserContext shape (embedded in JWT)

```typescript
interface UserContext {
  id: string;               // User UUID
  companyId: string;        // Company UUID (tenant boundary)
  roleKeys: string[];       // e.g. ['L3']
  permissionKeys: string[]; // e.g. ['lr.read', 'lr.update', …]
  branchIds: string[];      // Allowed branch UUIDs
  allowedSources: string[]; // e.g. ['INTERNAL', 'PORTAL']
  isSuperAdmin: boolean;
}
```

### Token expiry

Default token lifetime is **8 hours**. Override with the `JWT_EXPIRES_IN` environment variable (e.g. `1d`, `3600`).
When a token expires the user must log in again to receive a fresh context (including any recent permission changes).

---

## Security Hardening Notes

| Concern | Implementation |
|---------|----------------|
| **JWT secret** | Must be set via `JWT_SECRET` env var. App throws in production if missing; warns loudly in dev. |
| **403 information leakage** | In `production`, the 403 response body omits the `missing` field to avoid revealing the permission model. In development it is included for debugging. |
| **Brute-force login** | `POST /api/auth/login` is rate-limited to 10 requests per 15 minutes per IP. |
| **API rate limiting** | Read endpoints: 120 req/min. Write endpoints: 30 req/min. `/api/auth/me`: 120 req/min. |
| **Error sanitisation** | In production, 500 responses return a generic message; the real error is logged server-side only. |
| **Existence leakage** | Write/delete routes fetch the row with scope WHERE, so cross-company rows return 404, not 403. |
| **Input validation** | `source` and `status` fields are validated against `ALLOWED_SOURCES` / `ALLOWED_LR_STATUSES` before writing. String fields are trimmed. |
| **bcrypt cost factor** | Seed uses cost factor 12 (recommended for 2024+). |
| **Prisma singleton** | All modules import `db` from `src/lib/db.ts` — one connection pool for the process. |
| **Seed atomicity** | Role/permission/matrix seeding is wrapped in a `$transaction` for all-or-nothing consistency. |

---

## API Reference

### Auth

| Method | Path              | Auth | Rate limit | Description                       |
|--------|-------------------|------|------------|-----------------------------------|
| POST   | `/api/auth/login` | –    | 10/15 min  | Login; returns JWT + user context |
| GET    | `/api/auth/me`    | JWT  | 120/min    | Returns current user context      |

### LR (Lorry Receipt) — demo of RBAC patterns

| Method | Path            | Permission   | Rate limit | Description                         |
|--------|-----------------|--------------|------------|-------------------------------------|
| GET    | `/api/lrs`      | `lr.read`    | 120/min    | Scoped list of LRs with total count |
| POST   | `/api/lrs`      | `lr.create`  | 30/min     | Create a new LR within user scope   |
| PATCH  | `/api/lrs/:id`  | `lr.update`  | 30/min     | Update an LR (scoped fetch guard)   |
| DELETE | `/api/lrs/:id`  | `lr.delete`  | 30/min     | Delete an LR (scoped fetch guard)   |

#### GET /api/lrs query parameters

| Parameter | Default | Max | Description            |
|-----------|---------|-----|------------------------|
| `limit`   | 50      | 200 | Page size              |
| `offset`  | 0       | –   | Number of rows to skip |

#### GET /api/lrs response shape

```json
{
  "data": [ … ],
  "total": 142,
  "limit": 50,
  "offset": 0
}
```
