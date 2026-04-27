/**
 * templateService.ts
 *
 * CRUD for MessageTemplate records + Handlebars rendering.
 *
 * Template variables available in {{...}} expressions:
 *   recipientName, vehicleNo, date, documentCount, companyName, bundleUrl
 */

import Handlebars from 'handlebars';
import { prisma } from '../../services/documentService.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type TemplateChannel = 'EMAIL' | 'WHATSAPP' | 'BOTH';

export interface TemplateVars {
  recipientName?: string;
  vehicleNo?: string;
  date?: string;
  documentCount?: number | string;
  companyName?: string;
  bundleUrl?: string;
  [key: string]: unknown;
}

export interface CreateTemplateInput {
  code: string;
  name: string;
  channel?: TemplateChannel;
  subjectTemplate?: string;
  bodyTemplate: string;
  isDefault?: boolean;
}

export interface UpdateTemplateInput {
  name?: string;
  channel?: TemplateChannel;
  subjectTemplate?: string;
  bodyTemplate?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

// ── Errors ─────────────────────────────────────────────────────────────────────

export class TemplateValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'TemplateValidationError'; }
}
export class TemplateNotFoundError extends Error {
  constructor(id: string) { super(`Template ${id} not found`); this.name = 'TemplateNotFoundError'; }
}

// ── Default body (used for seed + fallback) ────────────────────────────────────

export const DEFAULT_BODY_TEMPLATE =
  'Dear {{recipientName}},\n\n' +
  'Please find attached {{documentCount}} document(s) for Vehicle {{vehicleNo}} dated {{date}}.\n\n' +
  'This is an automated dispatch from {{companyName}}.\n\n' +
  'Regards,\n{{companyName}} Team';

export const DEFAULT_SUBJECT_TEMPLATE =
  'Documents for Vehicle {{vehicleNo}} – {{date}}';

// ── Validation ─────────────────────────────────────────────────────────────────

const VALID_CHANNELS: TemplateChannel[] = ['EMAIL', 'WHATSAPP', 'BOTH'];

function validateTemplateInput(input: CreateTemplateInput | UpdateTemplateInput): void {
  if ('code' in input) {
    if (!input.code || !/^[A-Za-z0-9_\-]{1,50}$/.test(input.code)) {
      throw new TemplateValidationError('code must be 1–50 alphanumeric/underscore/hyphen characters');
    }
  }
  if ('name' in input && input.name !== undefined && !input.name.trim()) {
    throw new TemplateValidationError('name must not be blank');
  }
  if ('bodyTemplate' in input) {
    if (!input.bodyTemplate?.trim()) {
      throw new TemplateValidationError('bodyTemplate must not be blank');
    }
    // Verify it compiles
    try { Handlebars.precompile(input.bodyTemplate); } catch (e) {
      throw new TemplateValidationError(`bodyTemplate has invalid Handlebars syntax: ${(e as Error).message}`);
    }
  }
  if ('subjectTemplate' in input && input.subjectTemplate) {
    try { Handlebars.precompile(input.subjectTemplate); } catch (e) {
      throw new TemplateValidationError(`subjectTemplate has invalid Handlebars syntax: ${(e as Error).message}`);
    }
  }
  if ('channel' in input && input.channel && !VALID_CHANNELS.includes(input.channel)) {
    throw new TemplateValidationError(`channel must be one of: ${VALID_CHANNELS.join(', ')}`);
  }
}

// ── Rendering ──────────────────────────────────────────────────────────────────

/** Compile + execute a single Handlebars template string. */
export function renderTemplate(templateStr: string, vars: TemplateVars): string {
  const compiled = Handlebars.compile(templateStr, { noEscape: true });
  return compiled(vars);
}

/** Render both subject and body for a template record. */
export function renderTemplateRecord(
  template: { subjectTemplate: string | null; bodyTemplate: string },
  vars: TemplateVars,
): { subject: string | undefined; body: string } {
  return {
    subject: template.subjectTemplate ? renderTemplate(template.subjectTemplate, vars) : undefined,
    body: renderTemplate(template.bodyTemplate, vars),
  };
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

export async function createTemplate(companyId: string, input: CreateTemplateInput) {
  validateTemplateInput(input);

  const code = input.code.toUpperCase();

  // If being set as default, clear existing default for same channel
  if (input.isDefault) {
    await prisma.messageTemplate.updateMany({
      where: { companyId, channel: input.channel ?? 'BOTH', isDefault: true },
      data: { isDefault: false },
    });
  }

  try {
    return await prisma.messageTemplate.create({
      data: {
        companyId,
        code,
        name: input.name,
        channel: (input.channel ?? 'BOTH') as import('@prisma/client').$Enums.CommChannel,
        subjectTemplate: input.subjectTemplate ?? null,
        bodyTemplate: input.bodyTemplate,
        isDefault: input.isDefault ?? false,
      },
    });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'P2002') {
      throw new TemplateValidationError(`A template with code "${code}" already exists`);
    }
    throw e;
  }
}

export async function listTemplates(
  companyId: string,
  opts: { page?: number; limit?: number; includeInactive?: boolean } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const skip = (page - 1) * limit;
  const where = { companyId, ...(opts.includeInactive ? {} : { isActive: true }) };

  const [templates, total] = await Promise.all([
    prisma.messageTemplate.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    prisma.messageTemplate.count({ where }),
  ]);

  return { templates, total, page, limit, pages: Math.ceil(total / limit) };
}

export async function getTemplate(id: string, companyId: string) {
  const tmpl = await prisma.messageTemplate.findFirst({ where: { id, companyId } });
  if (!tmpl) throw new TemplateNotFoundError(id);
  return tmpl;
}

export async function updateTemplate(id: string, companyId: string, input: UpdateTemplateInput) {
  const existing = await prisma.messageTemplate.findFirst({ where: { id, companyId } });
  if (!existing) throw new TemplateNotFoundError(id);

  validateTemplateInput(input);

  if (input.isDefault) {
    const channel = input.channel ?? existing.channel;
    await prisma.messageTemplate.updateMany({
      where: { companyId, channel, isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined)            data['name'] = input.name;
  if (input.channel !== undefined)         data['channel'] = input.channel;
  if (input.subjectTemplate !== undefined) data['subjectTemplate'] = input.subjectTemplate;
  if (input.bodyTemplate !== undefined)    data['bodyTemplate'] = input.bodyTemplate;
  if (input.isDefault !== undefined)       data['isDefault'] = input.isDefault;
  if (input.isActive !== undefined)        data['isActive'] = input.isActive;

  return prisma.messageTemplate.update({ where: { id }, data });
}

export async function deactivateTemplate(id: string, companyId: string) {
  const existing = await prisma.messageTemplate.findFirst({ where: { id, companyId } });
  if (!existing) throw new TemplateNotFoundError(id);
  await prisma.messageTemplate.update({ where: { id }, data: { isActive: false } });
}

/**
 * Find the default (or first active) template for a company + channel.
 * Falls back to a hard-coded template if none exists in DB.
 */
export async function resolveTemplate(
  companyId: string,
  channel: 'EMAIL' | 'WHATSAPP',
  templateCode?: string,
): Promise<{ subjectTemplate: string | null; bodyTemplate: string }> {
  if (templateCode) {
    const tmpl = await prisma.messageTemplate.findFirst({
      where: { companyId, code: templateCode.toUpperCase(), isActive: true },
    });
    if (tmpl) return { subjectTemplate: tmpl.subjectTemplate, bodyTemplate: tmpl.bodyTemplate };
  }

  // Try default template for this channel or BOTH
  const defaultTmpl = await prisma.messageTemplate.findFirst({
    where: {
      companyId,
      isDefault: true,
      isActive: true,
      channel: { in: [channel, 'BOTH'] },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (defaultTmpl) return { subjectTemplate: defaultTmpl.subjectTemplate, bodyTemplate: defaultTmpl.bodyTemplate };

  // Absolute fallback
  return {
    subjectTemplate: channel === 'EMAIL' ? DEFAULT_SUBJECT_TEMPLATE : null,
    bodyTemplate: DEFAULT_BODY_TEMPLATE,
  };
}
