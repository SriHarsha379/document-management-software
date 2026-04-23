import OpenAI from 'openai';
import { prisma } from './documentService.js';
import type { DocumentType } from '../types/index.js';

// ── Parsed filter structure extracted by AI ────────────────────────────────────
export interface SearchFilters {
  vehicleNo?: string;
  documentType?: DocumentType;
  lrNo?: string;
  invoiceNo?: string;
  partyName?: string;
  dateFrom?: string;  // YYYY-MM-DD
  dateTo?: string;    // YYYY-MM-DD
}

export interface SearchResult {
  id: string;
  type: string;
  status: string;
  originalFilename: string;
  mimeType: string;
  filePath: string;
  uploadedAt: string;
  updatedAt: string;
  groupId: string | null;
  extractedData?: {
    lrNo: string | null;
    invoiceNo: string | null;
    vehicleNo: string | null;
    quantity: string | null;
    date: string | null;
    partyNames: string[] | null;
    tollAmount: string | null;
    weightInfo: string | null;
    confidence: number | null;
    userReviewed: boolean;
  };
}

export interface SearchResponse {
  query: string;
  filters: SearchFilters;
  results: SearchResult[];
  total: number;
}

const QUERY_PARSE_PROMPT = `You are an AI assistant for a logistics document management system.
Your job is to parse a natural language search query and extract structured filters.

The system stores logistics documents (LR, INVOICE, TOLL, WEIGHMENT, EWAYBILL, RECEIVING) with these fields:
- vehicleNo: Indian vehicle registration number (e.g., MH12AB1234, KA01AB1234)
- documentType: LR | INVOICE | TOLL | WEIGHMENT | EWAYBILL | RECEIVING | UNKNOWN
- lrNo: Lorry Receipt number
- invoiceNo: Invoice number
- partyName: Company/party name (consignor or consignee, e.g., "My Home", "Taloja")
- dateFrom / dateTo: Date range in YYYY-MM-DD (e.g., "last week" → compute relative to today)

Today's date: ${new Date().toISOString().split('T')[0]}

Given a search query, return ONLY a valid JSON object with any applicable filters (omit fields that are not mentioned):
{
  "vehicleNo": "<string or null>",
  "documentType": "<LR|INVOICE|TOLL|WEIGHMENT|EWAYBILL|RECEIVING|UNKNOWN or null>",
  "lrNo": "<string or null>",
  "invoiceNo": "<string or null>",
  "partyName": "<string or null>",
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
- If query mentions an LR number or invoice number, set lrNo or invoiceNo accordingly.
- Only include fields that are clearly present in the query.
- Return only the JSON object, nothing else.`;

/**
 * Use OpenAI to parse a natural language query into structured filters.
 * Falls back to empty filters if the API is unavailable or parsing fails.
 */
async function parseQueryToFilters(query: string): Promise<SearchFilters> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Graceful degradation: do basic keyword extraction without AI
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

    const filters: SearchFilters = {};
    if (parsed.vehicleNo) filters.vehicleNo = parsed.vehicleNo.toUpperCase().replace(/\s+/g, '');
    if (parsed.documentType) {
      const validTypes: DocumentType[] = ['LR', 'INVOICE', 'TOLL', 'WEIGHMENT', 'EWAYBILL', 'RECEIVING', 'UNKNOWN'];
      const dt = parsed.documentType.toUpperCase() as DocumentType;
      if (validTypes.includes(dt)) filters.documentType = dt;
    }
    if (parsed.lrNo) filters.lrNo = parsed.lrNo;
    if (parsed.invoiceNo) filters.invoiceNo = parsed.invoiceNo;
    if (parsed.partyName) filters.partyName = parsed.partyName;
    if (parsed.dateFrom) filters.dateFrom = parsed.dateFrom;
    if (parsed.dateTo) filters.dateTo = parsed.dateTo;

    return filters;
  } catch {
    return fallbackParse(query);
  }
}

/**
 * Simple keyword-based fallback parser used when OpenAI is unavailable.
 */
function fallbackParse(query: string): SearchFilters {
  const filters: SearchFilters = {};
  const lower = query.toLowerCase();

  // Vehicle number: match common Indian formats
  const vehicleMatch = query.match(/\b([A-Z]{2}\d{2}[A-Z]{1,2}\d{4})\b/i);
  if (vehicleMatch) filters.vehicleNo = vehicleMatch[1].toUpperCase().replace(/\s+/g, '');

  // Document type keywords
  if (/\binvoice\b/i.test(lower)) filters.documentType = 'INVOICE';
  else if (/\blr\b|\blorry receipt\b|\bbilty\b/i.test(lower)) filters.documentType = 'LR';
  else if (/\btoll\b/i.test(lower)) filters.documentType = 'TOLL';
  else if (/\bweighment\b|\bweight slip\b/i.test(lower)) filters.documentType = 'WEIGHMENT';
  else if (/\be-?way bill\b|\beway\b/i.test(lower)) filters.documentType = 'EWAYBILL';
  else if (/\breceiving\b|\bpod\b|\bdelivery receipt\b/i.test(lower)) filters.documentType = 'RECEIVING';

  // Relative dates
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
 * Execute a Prisma query using structured filters and return matching documents.
 */
async function executeSearch(filters: SearchFilters): Promise<{ results: SearchResult[]; total: number }> {
  // Build Prisma where clause for ExtractedData
  const extractedDataWhere: Record<string, unknown> = {};

  if (filters.vehicleNo) {
    extractedDataWhere.vehicleNo = { contains: filters.vehicleNo };
  }
  if (filters.lrNo) {
    extractedDataWhere.lrNo = { contains: filters.lrNo };
  }
  if (filters.invoiceNo) {
    extractedDataWhere.invoiceNo = { contains: filters.invoiceNo };
  }
  if (filters.partyName) {
    // partyNames is stored as a JSON string; SQLite LIKE search on the raw string
    extractedDataWhere.partyNames = { contains: filters.partyName };
  }
  if (filters.dateFrom || filters.dateTo) {
    const dateFilter: Record<string, string> = {};
    if (filters.dateFrom) dateFilter.gte = filters.dateFrom;
    if (filters.dateTo) dateFilter.lte = filters.dateTo;
    extractedDataWhere.date = dateFilter;
  }

  const documentWhere: Record<string, unknown> = {};
  if (filters.documentType) {
    documentWhere.type = filters.documentType;
  }
  if (Object.keys(extractedDataWhere).length > 0) {
    documentWhere.extractedData = extractedDataWhere;
  }

  const [documents, total] = await Promise.all([
    prisma.document.findMany({
      where: documentWhere,
      include: { extractedData: true, group: true },
      orderBy: { uploadedAt: 'desc' },
      take: 50,
    }),
    prisma.document.count({ where: documentWhere }),
  ]);

  const results: SearchResult[] = documents.map((doc) => {
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
            partyNames: ed.partyNames ? (JSON.parse(ed.partyNames) as string[]) : null,
            tollAmount: ed.tollAmount,
            weightInfo: ed.weightInfo,
            confidence: ed.confidence,
            userReviewed: ed.userReviewed,
          }
        : undefined,
    };
  });

  return { results, total };
}

/**
 * Main entry point: parse a natural language query and return matching documents.
 */
export async function searchDocuments(query: string): Promise<SearchResponse> {
  const filters = await parseQueryToFilters(query);
  const { results, total } = await executeSearch(filters);
  return { query, filters, results, total };
}
