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
8. [API Reference](#api-reference)

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
| `source`     | Channel boundary (`INTERNAL`, `PORTAL`, `API`, `EMAIL_IMPORT`) — user must have source in `user_source_access` |

### Scope resolution

```
user may act on row  ⟺
  row.companyId = user.companyId
  AND (row.branchId IN user.branchIds OR user has no branch restrictions)
  AND (row.source  IN user.allowedSources OR user has no source restrictions)
  AND user has the required permission
```

`SUPER_ADMIN` bypasses all scope filters.

### Database tables for row-level scope

```
user_branch_access (user_id PK, branch_id PK)
user_source_access (user_id PK, source PK)
```

`user.company_id` provides the company boundary implicitly.

### Golden rule

**Never** fetch a row by ID and then check the branch/company after-the-fact.  
Always pass `buildScopeWhere(user)` into the initial DB query so that out-of-scope rows return `null`/`404` — not a permission error that leaks existence.

---

## How to Protect New Endpoints

### 1. Require authentication

Import and apply `requireAuth` before your route handler:

```typescript
import { requireAuth } from '../modules/auth/auth.routes.js';

router.get('/invoices', requireAuth, handler);
// or apply to entire router:
router.use(requireAuth);
```

### 2. Require a specific permission

```typescript
import { requirePermission } from '../modules/rbac/rbac.middleware.js';
import { PERMISSIONS } from '../modules/rbac/permissions.js';

router.get(
  '/invoices',
  requireAuth,
  requirePermission(PERMISSIONS.INVOICE_READ),
  async (req, res) => { … }
);
```

### 3. Apply row-level scope in your repository query

```typescript
import { buildScopeWhere } from '../modules/rbac/rbac.middleware.js';

router.get('/invoices', requireAuth, requirePermission('invoice.read'), async (req, res) => {
  const where = buildScopeWhere(req.user!);   // ← always include this
  const rows = await invoiceRepo.findMany({ where });
  res.json({ data: rows });
});
```

### 4. Fetch-with-scope pattern for write operations

```typescript
router.patch('/invoices/:id', requireAuth, requirePermission('invoice.update'), async (req, res) => {
  const where = buildScopeWhere(req.user!);
  // Fetching with scope ensures out-of-scope rows return 404, not a leak
  const invoice = await invoiceRepo.findFirst({ where: { ...where, id: req.params.id } });
  if (!invoice) return res.status(404).json({ error: 'Not found' });

  const updated = await invoiceRepo.update(invoice.id, req.body);
  res.json({ data: updated });
});
```

### 5. Optional: explicit scope validation (query-param endpoints)

```typescript
import { requireScope } from '../modules/rbac/rbac.middleware.js';

router.get(
  '/reports',
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

# Development (creates/applies migration)
npm run db:migrate

# OR apply existing migrations (CI / production)
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

| Entity           | Details                                    |
|------------------|--------------------------------------------|
| 20 permissions   | All permission keys in the matrix          |
| 5 roles          | L1, L2, L3, ADMIN, SUPER_ADMIN             |
| Role-permission matrix | Fully populated                    |
| Demo company     | "Demo Logistics Co."                       |
| Demo branch      | "Head Office"                              |
| Admin user       | `admin@demo.com` / `Admin@1234`            |
| Super Admin user | `superadmin@demo.com` / `Super@1234`       |

> **Change demo passwords before deploying to production.**

---

## Authentication Flow

1. `POST /api/auth/login` with `{ email, password }`.
2. Server validates credentials, loads roles/permissions/branch/source from DB, and returns a **JWT** containing the full `UserContext`.
3. Client includes the token as `Authorization: Bearer <token>` on subsequent requests.
4. `requireAuth` middleware verifies the JWT and attaches `req.user: UserContext`.
5. `requirePermission(key)` checks `req.user.permissionKeys` (Super Admin bypasses).
6. `buildScopeWhere(req.user)` returns a Prisma WHERE clause that every repository call must use.

### UserContext shape (embedded in JWT)

```typescript
interface UserContext {
  id: string;           // User UUID
  companyId: string;    // Company UUID (tenant boundary)
  roleKeys: string[];   // e.g. ['L3']
  permissionKeys: string[];  // e.g. ['lr.read', 'lr.update', …]
  branchIds: string[];  // Allowed branch UUIDs
  allowedSources: string[];  // e.g. ['INTERNAL', 'PORTAL']
  isSuperAdmin: boolean;
}
```

---

## API Reference

### Auth

| Method | Path              | Auth | Description                   |
|--------|-------------------|------|-------------------------------|
| POST   | `/api/auth/login` | –    | Login; returns JWT + user context |
| GET    | `/api/auth/me`    | JWT  | Returns current user context  |

### LR (Lorry Receipt) — demo of RBAC patterns

| Method | Path            | Permission   | Description                         |
|--------|-----------------|--------------|-------------------------------------|
| GET    | `/api/lrs`      | `lr.read`    | Scoped list of LRs                  |
| POST   | `/api/lrs`      | `lr.create`  | Create a new LR within user scope   |
| PATCH  | `/api/lrs/:id`  | `lr.update`  | Update an LR (scoped fetch guard)   |
| DELETE | `/api/lrs/:id`  | `lr.delete`  | Delete an LR (scoped fetch guard)   |
