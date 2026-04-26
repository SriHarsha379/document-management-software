// ── Permission key constants ───────────────────────────────────────────────────

export const PERMISSIONS = {
  LR_CREATE:   'lr.create',
  LR_READ:     'lr.read',
  LR_UPDATE:   'lr.update',
  LR_DELETE:   'lr.delete',

  INVOICE_CREATE: 'invoice.create',
  INVOICE_READ:   'invoice.read',
  INVOICE_UPDATE: 'invoice.update',
  INVOICE_DELETE: 'invoice.delete',

  DOCUMENT_UPLOAD: 'document.upload',
  DOCUMENT_READ:   'document.read',
  DOCUMENT_DELETE: 'document.delete',

  WORKFLOW_TRANSITION_SUBMIT:  'workflow.transition.submit',
  WORKFLOW_TRANSITION_APPROVE: 'workflow.transition.approve',
  WORKFLOW_TRANSITION_REJECT:  'workflow.transition.reject',
  WORKFLOW_OVERRIDE:           'workflow.override',

  ORG_MANAGE:  'org.manage',
  USER_MANAGE: 'user.manage',
  ROLE_MANAGE: 'role.manage',

  // Master data — CRUD is admin-only; read (dropdown) is available to all roles
  MASTER_MANAGE: 'master.manage', // create / update / delete any master record
  MASTER_READ:   'master.read',   // read / list master records and dropdown data

  AUDIT_READ: 'audit.read',
  EXPORT_RUN: 'export.run',
} as const;

export type PermissionKey = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// ── Role key constants ─────────────────────────────────────────────────────────

export const ROLES = {
  L1:          'L1',
  L2:          'L2',
  L3:          'L3',
  ADMIN:       'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;

export type RoleKey = typeof ROLES[keyof typeof ROLES];

// ── Domain enumerations ────────────────────────────────────────────────────────
// Centralised here so validation and DB writes use the same set of values.

export const ALLOWED_SOURCES = ['INTERNAL', 'PORTAL', 'API', 'EMAIL_IMPORT'] as const;
export type Source = typeof ALLOWED_SOURCES[number];

export const ALLOWED_LR_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type LrStatus = typeof ALLOWED_LR_STATUSES[number];

// ── Role → permission matrix ───────────────────────────────────────────────────
// This is the canonical source of truth; it is used by the seed script to
// populate the role_permissions table.

export const ROLE_PERMISSION_MATRIX: Record<RoleKey, PermissionKey[]> = {
  // L1 — data entry: create + read business records, submit workflow; read master data
  [ROLES.L1]: [
    PERMISSIONS.LR_CREATE,   PERMISSIONS.LR_READ,
    PERMISSIONS.INVOICE_CREATE, PERMISSIONS.INVOICE_READ,
    PERMISSIONS.DOCUMENT_UPLOAD, PERMISSIONS.DOCUMENT_READ,
    PERMISSIONS.WORKFLOW_TRANSITION_SUBMIT,
    PERMISSIONS.MASTER_READ,
  ],

  // L2 — view only: read everything, optionally read audit; read master data
  [ROLES.L2]: [
    PERMISSIONS.LR_READ,
    PERMISSIONS.INVOICE_READ,
    PERMISSIONS.DOCUMENT_READ,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.MASTER_READ,
  ],

  // L3 — edit/delete: full CRUD + approve/reject workflow + export; read master data
  [ROLES.L3]: [
    PERMISSIONS.LR_CREATE,   PERMISSIONS.LR_READ,   PERMISSIONS.LR_UPDATE,   PERMISSIONS.LR_DELETE,
    PERMISSIONS.INVOICE_CREATE, PERMISSIONS.INVOICE_READ, PERMISSIONS.INVOICE_UPDATE, PERMISSIONS.INVOICE_DELETE,
    PERMISSIONS.DOCUMENT_UPLOAD, PERMISSIONS.DOCUMENT_READ, PERMISSIONS.DOCUMENT_DELETE,
    PERMISSIONS.WORKFLOW_TRANSITION_SUBMIT, PERMISSIONS.WORKFLOW_TRANSITION_APPROVE, PERMISSIONS.WORKFLOW_TRANSITION_REJECT,
    PERMISSIONS.AUDIT_READ, PERMISSIONS.EXPORT_RUN,
    PERMISSIONS.MASTER_READ,
  ],

  // Admin — full access scoped to own company; manages master data + users/roles/org
  [ROLES.ADMIN]: [
    PERMISSIONS.LR_CREATE,   PERMISSIONS.LR_READ,   PERMISSIONS.LR_UPDATE,   PERMISSIONS.LR_DELETE,
    PERMISSIONS.INVOICE_CREATE, PERMISSIONS.INVOICE_READ, PERMISSIONS.INVOICE_UPDATE, PERMISSIONS.INVOICE_DELETE,
    PERMISSIONS.DOCUMENT_UPLOAD, PERMISSIONS.DOCUMENT_READ, PERMISSIONS.DOCUMENT_DELETE,
    PERMISSIONS.WORKFLOW_TRANSITION_SUBMIT, PERMISSIONS.WORKFLOW_TRANSITION_APPROVE,
    PERMISSIONS.WORKFLOW_TRANSITION_REJECT, PERMISSIONS.WORKFLOW_OVERRIDE,
    PERMISSIONS.ORG_MANAGE, PERMISSIONS.USER_MANAGE, PERMISSIONS.ROLE_MANAGE,
    PERMISSIONS.AUDIT_READ, PERMISSIONS.EXPORT_RUN,
    PERMISSIONS.MASTER_MANAGE, PERMISSIONS.MASTER_READ,
  ],

  // Super Admin — all permissions + isSuperAdmin bypass (no scope restriction)
  [ROLES.SUPER_ADMIN]: [
    PERMISSIONS.LR_CREATE,   PERMISSIONS.LR_READ,   PERMISSIONS.LR_UPDATE,   PERMISSIONS.LR_DELETE,
    PERMISSIONS.INVOICE_CREATE, PERMISSIONS.INVOICE_READ, PERMISSIONS.INVOICE_UPDATE, PERMISSIONS.INVOICE_DELETE,
    PERMISSIONS.DOCUMENT_UPLOAD, PERMISSIONS.DOCUMENT_READ, PERMISSIONS.DOCUMENT_DELETE,
    PERMISSIONS.WORKFLOW_TRANSITION_SUBMIT, PERMISSIONS.WORKFLOW_TRANSITION_APPROVE,
    PERMISSIONS.WORKFLOW_TRANSITION_REJECT, PERMISSIONS.WORKFLOW_OVERRIDE,
    PERMISSIONS.ORG_MANAGE, PERMISSIONS.USER_MANAGE, PERMISSIONS.ROLE_MANAGE,
    PERMISSIONS.AUDIT_READ, PERMISSIONS.EXPORT_RUN,
    PERMISSIONS.MASTER_MANAGE, PERMISSIONS.MASTER_READ,
  ],
};

// ── Permission metadata (for seeding description/resource/action columns) ─────

export interface PermissionMeta {
  key: PermissionKey;
  resource: string;
  action: string;
  description: string;
}

export const PERMISSION_META: PermissionMeta[] = [
  { key: PERMISSIONS.LR_CREATE,   resource: 'lr', action: 'create', description: 'Create a new LR record' },
  { key: PERMISSIONS.LR_READ,     resource: 'lr', action: 'read',   description: 'Read/list LR records' },
  { key: PERMISSIONS.LR_UPDATE,   resource: 'lr', action: 'update', description: 'Update an LR record' },
  { key: PERMISSIONS.LR_DELETE,   resource: 'lr', action: 'delete', description: 'Delete an LR record' },

  { key: PERMISSIONS.INVOICE_CREATE, resource: 'invoice', action: 'create', description: 'Create an invoice' },
  { key: PERMISSIONS.INVOICE_READ,   resource: 'invoice', action: 'read',   description: 'Read/list invoices' },
  { key: PERMISSIONS.INVOICE_UPDATE, resource: 'invoice', action: 'update', description: 'Update an invoice' },
  { key: PERMISSIONS.INVOICE_DELETE, resource: 'invoice', action: 'delete', description: 'Delete an invoice' },

  { key: PERMISSIONS.DOCUMENT_UPLOAD, resource: 'document', action: 'upload', description: 'Upload a document/attachment' },
  { key: PERMISSIONS.DOCUMENT_READ,   resource: 'document', action: 'read',   description: 'Read/download a document' },
  { key: PERMISSIONS.DOCUMENT_DELETE, resource: 'document', action: 'delete', description: 'Delete a document' },

  { key: PERMISSIONS.WORKFLOW_TRANSITION_SUBMIT,  resource: 'workflow', action: 'transition.submit',  description: 'Submit a workflow case' },
  { key: PERMISSIONS.WORKFLOW_TRANSITION_APPROVE, resource: 'workflow', action: 'transition.approve', description: 'Approve a workflow case' },
  { key: PERMISSIONS.WORKFLOW_TRANSITION_REJECT,  resource: 'workflow', action: 'transition.reject',  description: 'Reject a workflow case' },
  { key: PERMISSIONS.WORKFLOW_OVERRIDE,           resource: 'workflow', action: 'override',           description: 'Override workflow state' },

  { key: PERMISSIONS.ORG_MANAGE,  resource: 'org',  action: 'manage', description: 'Manage org/branch/centre settings' },
  { key: PERMISSIONS.USER_MANAGE, resource: 'user', action: 'manage', description: 'Manage users within company' },
  { key: PERMISSIONS.ROLE_MANAGE, resource: 'role', action: 'manage', description: 'Manage role-permission assignments' },

  { key: PERMISSIONS.MASTER_MANAGE, resource: 'master', action: 'manage', description: 'Create/update/delete master data records' },
  { key: PERMISSIONS.MASTER_READ,   resource: 'master', action: 'read',   description: 'Read master data and dropdown lists' },

  { key: PERMISSIONS.AUDIT_READ, resource: 'audit',  action: 'read',   description: 'Read audit logs' },
  { key: PERMISSIONS.EXPORT_RUN, resource: 'export', action: 'run',    description: 'Run data exports (CSV/PDF)' },
];
