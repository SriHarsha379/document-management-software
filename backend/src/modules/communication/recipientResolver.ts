/**
 * recipientResolver.ts
 *
 * Resolves a caller-supplied recipient list into concrete addresses
 * (email or E.164 phone) by looking up master-data records (Party,
 * Officer, Transporter) from the database.
 *
 * Returns:
 *  - resolvedRecipients: ResolvedRecipient[]   — deliverable
 *  - warnings:           string[]              — skipped entries + reasons
 */

import { prisma } from '../../services/documentService.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type CommChannel = 'EMAIL' | 'WHATSAPP' | 'BOTH';

export type RecipientInputType = 'PARTY' | 'OFFICER' | 'TRANSPORTER' | 'CUSTOM';

/** One entry supplied by the caller in the POST body. */
export interface RecipientInput {
  type: RecipientInputType;
  id?: string;       // required for PARTY / OFFICER / TRANSPORTER
  address?: string;  // required for CUSTOM
  name?: string;     // optional label for CUSTOM
  isCC?: boolean;
}

/** A resolved, validated recipient ready to be stored / sent. */
export interface ResolvedRecipient {
  type: RecipientInputType;
  id?: string;
  name: string;
  address: string;   // email or E.164 phone
  isCC: boolean;
}

/** Dropdown item returned by GET /api/communication/recipients */
export interface RecipientDropdownItem {
  type: RecipientInputType;
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

// ── Validators ─────────────────────────────────────────────────────────────────

export function isValidEmail(v: string): boolean {
  const parts = v.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return (
    /^[^\s@]{1,64}$/.test(local!) &&
    /^[^\s@]{1,253}$/.test(domain!) &&
    domain!.includes('.')
  );
}

export function isValidPhone(v: string): boolean {
  return /^\+?\d{7,20}$/.test(v);
}

function requiresAddress(channel: CommChannel): 'email' | 'phone' | null {
  if (channel === 'EMAIL') return 'email';
  if (channel === 'WHATSAPP') return 'phone';
  return null; // BOTH — caller should call twice with each concrete channel
}

// ── In-memory cache for dropdown results (1-minute TTL per company) ────────────

const dropdownCache = new Map<string, { data: RecipientDropdownItem[]; expiresAt: number }>();

// ── Main resolver ──────────────────────────────────────────────────────────────

/**
 * Resolve a list of RecipientInput entries into concrete ResolvedRecipient
 * objects for the given channel and company.
 *
 * Entries that cannot be resolved (missing master record, no address for the
 * channel, invalid format) are skipped and a warning is recorded.
 */
export async function resolveRecipients(opts: {
  inputs: RecipientInput[];
  ccAddresses?: string[];
  channel: 'EMAIL' | 'WHATSAPP';   // concrete channel; never BOTH here
  companyId: string;
}): Promise<{ resolvedRecipients: ResolvedRecipient[]; warnings: string[] }> {
  const { inputs, ccAddresses = [], channel, companyId } = opts;
  const addressField = requiresAddress(channel)!;
  const resolvedRecipients: ResolvedRecipient[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>(); // deduplicate by address

  function addIfNew(r: ResolvedRecipient): void {
    const key = r.address.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    resolvedRecipients.push(r);
  }

  for (const input of inputs) {
    const isCC = input.isCC ?? false;

    if (input.type === 'CUSTOM') {
      const addr = input.address?.trim() ?? '';
      const valid = channel === 'EMAIL' ? isValidEmail(addr) : isValidPhone(addr);
      if (!valid) {
        warnings.push(`CUSTOM recipient "${addr}" skipped: invalid ${channel} address`);
        continue;
      }
      addIfNew({ type: 'CUSTOM', name: input.name ?? addr, address: addr, isCC });
      continue;
    }

    if (!input.id) {
      warnings.push(`${input.type} recipient skipped: id is required`);
      continue;
    }

    let name = '';
    let address = '';

    if (input.type === 'PARTY') {
      const rec = await prisma.party.findFirst({ where: { id: input.id, companyId, isActive: true } });
      if (!rec) { warnings.push(`Party ${input.id} not found or inactive`); continue; }
      name = rec.name;
      address = (addressField === 'email' ? rec.email : rec.phone) ?? '';
    } else if (input.type === 'OFFICER') {
      const rec = await prisma.officer.findFirst({ where: { id: input.id, companyId, isActive: true } });
      if (!rec) { warnings.push(`Officer ${input.id} not found or inactive`); continue; }
      name = rec.name;
      address = (addressField === 'email' ? rec.email : rec.phone) ?? '';
    } else if (input.type === 'TRANSPORTER') {
      const rec = await prisma.transporter.findFirst({ where: { id: input.id, companyId, isActive: true } });
      if (!rec) { warnings.push(`Transporter ${input.id} not found or inactive`); continue; }
      name = rec.name;
      address = (addressField === 'email' ? rec.email : rec.phone) ?? '';
    }

    if (!address) {
      warnings.push(`${input.type} "${name || input.id}" skipped: no ${channel} address on record`);
      continue;
    }

    const valid = channel === 'EMAIL' ? isValidEmail(address) : isValidPhone(address);
    if (!valid) {
      warnings.push(`${input.type} "${name}" skipped: stored ${channel} address "${address}" is invalid`);
      continue;
    }

    addIfNew({ type: input.type, id: input.id, name, address, isCC });
  }

  // Merge free-form ccAddresses
  for (const addr of ccAddresses) {
    const trimmed = addr.trim();
    const valid = channel === 'EMAIL' ? isValidEmail(trimmed) : isValidPhone(trimmed);
    if (!valid) {
      warnings.push(`CC address "${trimmed}" skipped: invalid ${channel} address`);
      continue;
    }
    addIfNew({ type: 'CUSTOM', name: trimmed, address: trimmed, isCC: true });
  }

  return { resolvedRecipients, warnings };
}

// ── Dropdown helper ────────────────────────────────────────────────────────────

/**
 * Return all active Party, Officer and Transporter records for a company,
 * optionally filtered by type and filtered to records that have an address
 * for the requested channel.
 *
 * Results are cached in-memory for 60 seconds per company.
 */
export async function recipientDropdown(opts: {
  companyId: string;
  type?: string;    // PARTY | OFFICER | TRANSPORTER | ALL (default ALL)
  channel?: string; // EMAIL | WHATSAPP — filter to records with that address
}): Promise<RecipientDropdownItem[]> {
  const { companyId, type = 'ALL', channel } = opts;

  const cacheKey = `${companyId}::${type}::${channel ?? 'ALL'}`;
  const cached = dropdownCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const items: RecipientDropdownItem[] = [];

  if (type === 'ALL' || type === 'PARTY') {
    const rows = await prisma.party.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, email: true, phone: true },
      orderBy: { name: 'asc' },
    });
    for (const r of rows) {
      if (channel === 'EMAIL' && !r.email) continue;
      if (channel === 'WHATSAPP' && !r.phone) continue;
      items.push({ type: 'PARTY', id: r.id, name: r.name, email: r.email ?? undefined, phone: r.phone ?? undefined });
    }
  }

  if (type === 'ALL' || type === 'OFFICER') {
    const rows = await prisma.officer.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, email: true, phone: true },
      orderBy: { name: 'asc' },
    });
    for (const r of rows) {
      if (channel === 'EMAIL' && !r.email) continue;
      if (channel === 'WHATSAPP' && !r.phone) continue;
      items.push({ type: 'OFFICER', id: r.id, name: r.name, email: r.email ?? undefined, phone: r.phone ?? undefined });
    }
  }

  if (type === 'ALL' || type === 'TRANSPORTER') {
    const rows = await prisma.transporter.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, email: true, phone: true },
      orderBy: { name: 'asc' },
    });
    for (const r of rows) {
      if (channel === 'EMAIL' && !r.email) continue;
      if (channel === 'WHATSAPP' && !r.phone) continue;
      items.push({ type: 'TRANSPORTER', id: r.id, name: r.name, email: r.email ?? undefined, phone: r.phone ?? undefined });
    }
  }

  dropdownCache.set(cacheKey, { data: items, expiresAt: Date.now() + 60_000 });
  return items;
}

/** Evict cached dropdown entries for a company (call when master data changes). */
export function evictDropdownCache(companyId: string): void {
  for (const key of dropdownCache.keys()) {
    if (key.startsWith(`${companyId}::`)) dropdownCache.delete(key);
  }
}
