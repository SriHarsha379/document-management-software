import OpenAI from 'openai';
import { db } from '../lib/db.js';
import type {
  DocumentType,
  AdvancedSearchFilters,
  AdvancedSearchResponse,
  SavedFilterPayload,
  SearchResultItem,
} from '../types/index.js';

// ── Constants ─────────────────────────────────────────────────────────────────

export const SEARCH_MAX_LIMIT = 100;
export const SEARCH_DEFAULT_LIMIT = 20;

// ── Parsed filter structure extracted by AI ───────────────────────────────────

/** Subset of filters the AI NL parser may return (no pagination, no scope). */
export interface NlSearchFilters {
  vehicleNo?: string;
  documentType?: DocumentType;
  lrNo?: string;
  invoiceNo?: string;
  partyName?: string;
  transporter?: string;
  dateFrom?: string;  // YYYY-MM-DD
  dateTo?: string;    // YYYY-MM-DD
}

export interface NlSearchResponse {
  query: string;
  filters: NlSearchFilters;
  results: SearchResultItem[];
  pagination: { total: number; page: number; limit: number; pages: number };
}

// ── Pagination helpers ────────────────────────────────────────────────────────

/** Clamp `limit` to 1–SEARCH_MAX_LIMIT, defaulting to SEARCH_DEFAULT_LIMIT. */
export function clampLimit(raw: number | undefined): number {
  if (raw === undefined || isNaN(raw)) return SEARCH_DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(raw)), SEARCH_MAX_LIMIT);
}

/** Clamp `page` to ≥ 1, defaulting to 1. */
export function clampPage(raw: number | undefined): number {
  if (raw === undefined || isNaN(raw)) return 1;
  return Math.max(1, Math.floor(raw));
}

// ── Query builder ─────────────────────────────────────────────────────────────

/**
 * Convert an AdvancedSearchFilters object into a Prisma Document `where` clause.
 *
 * `scopeCompanyId`  — the company ID from the JWT (always enforced for non-super-admins).
 * `scopeSources`    — allowed sources from the JWT (always enforced).
 *
 * The caller (route handler) is responsible for reading these from `req.user`.
 */
export function buildDocumentWhere(
  filters: AdvancedSearchFilters,
  scopeCompanyId?: string,
  scopeSources?: string[],
): Record<string, unknown> {
  const docWhere: Record<string, unknown> = {};
  const edWhere: Record<string, unknown> = {};
  const lrWhere: Record<string, unknown> = {};

  // ── Document type / status ─────────────────────────────────────────────────
  if (filters.documentType) docWhere.type = filters.documentType;
  if (filters.documentStatus) docWhere.status = filters.documentStatus;

  // ── Upload timestamp range ─────────────────────────────────────────────────
  if (filters.uploadedFrom || filters.uploadedTo) {
    const uploadedAt: Record<string, Date> = {};
    if (filters.uploadedFrom) uploadedAt.gte = new Date(filters.uploadedFrom);
    if (filters.uploadedTo) uploadedAt.lte = new Date(filters.uploadedTo);
    docWhere.uploadedAt = uploadedAt;
  }

  // ── Extracted data fields ──────────────────────────────────────────────────
  if (filters.vehicleNo) {
    edWhere.vehicleNo = { contains: filters.vehicleNo.toUpperCase().replace(/\s+/g, '') };
  }
  if (filters.lrNo) {
    edWhere.lrNo = { contains: filters.lrNo };
  }
  if (filters.invoiceNo) {
    edWhere.invoiceNo = { contains: filters.invoiceNo };
  }
  if (filters.partyName) {
    edWhere.partyNames = { contains: filters.partyName };
  }
  if (filters.transporter) {
    edWhere.transporter = { contains: filters.transporter };
  }
  if (filters.dateFrom || filters.dateTo) {
    const dateFilter: Record<string, string> = {};
    if (filters.dateFrom) dateFilter.gte = filters.dateFrom;
    if (filters.dateTo) dateFilter.lte = filters.dateTo;
    edWhere.date = dateFilter;
  }
  if (Object.keys(edWhere).length > 0) {
    docWhere.extractedData = edWhere;
  }

  // ── Company → Source hierarchy: scope via linked LR records ───────────────
  // When companyId or source is requested, we scope through DocumentLinkRecord → Lr.
  // This enforces the company-source ownership hierarchy in the data model.
  const linkWhere: Record<string, unknown> = {};
  if (filters.source) lrWhere.source = filters.source;

  // Enforce JWT-scoped companyId: the filter may only narrow, never widen.
  if (scopeCompanyId) {
    lrWhere.companyId = filters.companyId ?? scopeCompanyId;
  } else if (filters.companyId) {
    lrWhere.companyId = filters.companyId;
  }

  // Enforce JWT-scoped sources: if user has restricted sources, apply them.
  if (scopeSources && scopeSources.length > 0) {
    lrWhere.source = filters.source && scopeSources.includes(filters.source)
      ? filters.source
      : { in: scopeSources };
  }

  if (Object.keys(lrWhere).length > 0) {
    linkWhere.lr = lrWhere;
    docWhere.documentLinks = { some: linkWhere };
  }

  return docWhere;
}

// ── Result formatter ──────────────────────────────────────────────────────────

type PrismaDocRow = {
  id: string;
  type: string;
  status: string;
  originalFilename: string;
  rawFilePath: string;
  mimeType: string;
  uploadedAt: Date;
  updatedAt: Date;
  groupId: string | null;
  extractedData?: {
    lrNo: string | null;
    invoiceNo: string | null;
    vehicleNo: string | null;
    quantity: string | null;
    date: string | null;
    partyNames: string | null;
    tollAmount: string | null;
    weightInfo: string | null;
    transporter: string | null;
    confidence: number | null;
    userReviewed: boolean;
  } | null;
};

/** Safely parse the JSON-serialised partyNames array stored in SQLite. */
function parsePartyNames(value: string | null): string[] | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as string[];
  } catch {
    return null;
  }
}

function formatDocRow(doc: PrismaDocRow): SearchResultItem {
  const ed = doc.extractedData;
  return {
    id: doc.id,
    type: doc.type,
    status: doc.status,
    originalFilename: doc.originalFilename,
    mimeType: doc.mimeType,
    filePath: doc.rawFilePath.split('/').pop() ?? doc.rawFilePath,
    uploadedAt: doc.uploadedAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    groupId: doc.groupId,
    extractedData: ed
      ? {
          lrNo: ed.lrNo,
          invoiceNo: ed.invoiceNo,
          vehicleNo: ed.vehicleNo,
          quantity: ed.quantity,
          date: ed.date,
          partyNames: parsePartyNames(ed.partyNames),
          tollAmount: ed.tollAmount,
          weightInfo: ed.weightInfo,
          transporter: ed.transporter,
          confidence: ed.confidence,
          userReviewed: ed.userReviewed,
        }
      : undefined,
  };
}

// ── Core: structured advanced search ─────────────────────────────────────────

/**
 * Main structured search entry point.
 *
 * Applies all filters, enforces JWT-based company/source scope, paginates, and
 * returns results with pagination metadata.
 */
export async function executeAdvancedSearch(
  filters: AdvancedSearchFilters,
  scopeCompanyId?: string,
  scopeSources?: string[],
): Promise<AdvancedSearchResponse> {
  const page = clampPage(filters.page);
  const limit = clampLimit(filters.limit);
  const skip = (page - 1) * limit;

  const orderBy = filters.sortBy === 'date'
    ? { extractedData: { date: filters.sortDir ?? 'desc' as const } }
    : { uploadedAt: filters.sortDir ?? 'desc' as const };

  const where = buildDocumentWhere(filters, scopeCompanyId, scopeSources);

  const [documents, total] = await Promise.all([
    db.document.findMany({
      where,
      include: {
        extractedData: {
          select: {
            lrNo: true, invoiceNo: true, vehicleNo: true, quantity: true,
            date: true, partyNames: true, tollAmount: true, weightInfo: true,
            transporter: true, confidence: true, userReviewed: true,
          },
        },
      },
      orderBy,
      skip,
      take: limit,
    }),
    db.document.count({ where }),
  ]);

  return {
    filters,
    results: documents.map(formatDocRow),
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
}

// ── Saved Filters ─────────────────────────────────────────────────────────────

/** Persist a named filter set for a user. */
export async function createSavedFilter(userId: string, payload: SavedFilterPayload) {
  return db.savedFilter.create({
    data: {
      userId,
      name: payload.name.trim(),
      filters: JSON.stringify(payload.filters),
    },
  });
}

/** Return all saved filters belonging to a user, newest first. */
export async function listSavedFilters(userId: string) {
  const rows = await db.savedFilter.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, filters: true, createdAt: true, updatedAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    filters: JSON.parse(r.filters) as AdvancedSearchFilters,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/** Delete a saved filter (only if it belongs to the given user). */
export async function deleteSavedFilter(id: string, userId: string): Promise<boolean> {
  const existing = await db.savedFilter.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.savedFilter.delete({ where: { id } });
  return true;
}

// ── NL Search (kept for backward compatibility) ───────────────────────────────

const QUERY_PARSE_PROMPT = `You are an AI assistant for a logistics document management system.
Your job is to parse a natural language search query and extract structured filters.

The system stores logistics documents (LR, INVOICE, TOLL, WEIGHMENT, EWAYBILL, RECEIVING) with these fields:
- vehicleNo: Indian vehicle registration number (e.g., MH12AB1234, KA01AB1234)
- documentType: LR | INVOICE | TOLL | WEIGHMENT | EWAYBILL | RECEIVING | UNKNOWN
- lrNo: Lorry Receipt number
- invoiceNo: Invoice number
- partyName: Company/party name (consignor or consignee, e.g., "My Home", "Taloja")
- transporter: Transport company or driver name
- dateFrom / dateTo: Date range in YYYY-MM-DD (e.g., "last week" → compute relative to today)

Today's date: ${new Date().toISOString().split('T')[0]}

Given a search query, return ONLY a valid JSON object with any applicable filters (omit fields that are not mentioned):
{
  "vehicleNo": "<string or null>",
  "documentType": "<LR|INVOICE|TOLL|WEIGHMENT|EWAYBILL|RECEIVING|UNKNOWN or null>",
  "lrNo": "<string or null>",
  "invoiceNo": "<string or null>",
  "partyName": "<string or null>",
  "transporter": "<string or null>",
  "dateFrom": "<YYYY-MM-DD or null>",
  "dateTo": "<YYYY-MM-DD or null>"
}

Rules:
- If query mentions "last week", set dateFrom to 7 days ago and dateTo to today.
- If query mentions "yesterday", set dateFrom and dateTo to yesterday.
- If query mentions "this month", set dateFrom to first day of current month and dateTo to today.
- If query mentions a vehicle number, extract it as vehicleNo (normalize to uppercase, no spaces).
- If query mentions document type keywords (invoice, LR, lorry receipt, toll, weighment, e-way bill, receiving), set documentType.
- If query mentions a company or party name, set partyName.
- If query mentions a transporter or driver name, set transporter.
- If query mentions an LR number or invoice number, set lrNo or invoiceNo accordingly.
- Only include fields that are clearly present in the query.
- Return only the JSON object, nothing else.`;

async function parseQueryToFilters(query: string): Promise<NlSearchFilters> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return fallbackParse(query);
  }

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: QUERY_PARSE_PROMPT },
        { role: 'user', content: query },
      ],
      max_tokens: 300,
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as Record<string, string | null>;

    const filters: NlSearchFilters = {};
    if (parsed.vehicleNo) filters.vehicleNo = parsed.vehicleNo.toUpperCase().replace(/\s+/g, '');
    if (parsed.documentType) {
      const validTypes: DocumentType[] = ['LR', 'INVOICE', 'TOLL', 'WEIGHMENT', 'EWAYBILL', 'RECEIVING', 'UNKNOWN'];
      const dt = parsed.documentType.toUpperCase() as DocumentType;
      if (validTypes.includes(dt)) filters.documentType = dt;
    }
    if (parsed.lrNo) filters.lrNo = parsed.lrNo;
    if (parsed.invoiceNo) filters.invoiceNo = parsed.invoiceNo;
    if (parsed.partyName) filters.partyName = parsed.partyName;
    if (parsed.transporter) filters.transporter = parsed.transporter;
    if (parsed.dateFrom) filters.dateFrom = parsed.dateFrom;
    if (parsed.dateTo) filters.dateTo = parsed.dateTo;

    return filters;
  } catch {
    return fallbackParse(query);
  }
}

function fallbackParse(query: string): NlSearchFilters {
  const filters: NlSearchFilters = {};
  const lower = query.toLowerCase();

  const vehicleMatch = query.match(/\b([A-Z]{2}\d{2}[A-Z]{1,2}\d{4})\b/i);
  if (vehicleMatch) filters.vehicleNo = vehicleMatch[1].toUpperCase().replace(/\s+/g, '');

  if (/\binvoice\b/i.test(lower)) filters.documentType = 'INVOICE';
  else if (/\blr\b|\blorry receipt\b|\bbilty\b/i.test(lower)) filters.documentType = 'LR';
  else if (/\btoll\b/i.test(lower)) filters.documentType = 'TOLL';
  else if (/\bweighment\b|\bweight slip\b/i.test(lower)) filters.documentType = 'WEIGHMENT';
  else if (/\be-?way bill\b|\beway\b/i.test(lower)) filters.documentType = 'EWAYBILL';
  else if (/\breceiving\b|\bpod\b|\bdelivery receipt\b/i.test(lower)) filters.documentType = 'RECEIVING';

  const today = new Date();
  if (/last week/i.test(lower)) {
    const from = new Date(today);
    from.setDate(today.getDate() - 7);
    filters.dateFrom = from.toISOString().split('T')[0];
    filters.dateTo = today.toISOString().split('T')[0];
  } else if (/yesterday/i.test(lower)) {
    const yest = new Date(today);
    yest.setDate(today.getDate() - 1);
    const d = yest.toISOString().split('T')[0];
    filters.dateFrom = d;
    filters.dateTo = d;
  } else if (/this month/i.test(lower)) {
    filters.dateFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    filters.dateTo = today.toISOString().split('T')[0];
  }

  return filters;
}

/**
 * NL search entry point — kept for backward compatibility with POST /api/search.
 * Accepts scoping params so the existing endpoint can enforce company/source scope.
 */
export async function searchDocuments(
  query: string,
  page: number = 1,
  limit: number = SEARCH_DEFAULT_LIMIT,
  scopeCompanyId?: string,
  scopeSources?: string[],
): Promise<NlSearchResponse> {
  const nlFilters = await parseQueryToFilters(query);

  // Bridge NL filters into AdvancedSearchFilters for execution
  const advFilters: AdvancedSearchFilters = {
    ...nlFilters,
    page,
    limit,
  };

  const { results, pagination } = await executeAdvancedSearch(advFilters, scopeCompanyId, scopeSources);

  return { query, filters: nlFilters, results, pagination };
}

