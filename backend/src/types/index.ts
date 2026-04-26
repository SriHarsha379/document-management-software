export type DocumentType = 'LR' | 'INVOICE' | 'TOLL' | 'WEIGHMENT' | 'EWAYBILL' | 'RECEIVING' | 'UNKNOWN';
export type DocumentStatus = 'PENDING_OCR' | 'PENDING_REVIEW' | 'REVIEWED' | 'SAVED';
export type RecipientType = 'ACCOUNTS' | 'PARTY' | 'TRANSPORTER';
export type BundleStatus = 'DRAFT' | 'READY' | 'SENT';

export interface ExtractedFields {
  lrNo?: string;
  invoiceNo?: string;
  vehicleNo?: string;
  quantity?: string;
  date?: string;
  partyNames?: string[];
  tollAmount?: string;
  weightInfo?: string;
  transporter?: string;
  documentType?: DocumentType;
  confidence?: number;
}

export interface OcrResult {
  fields: ExtractedFields;
  rawResponse: string;
  documentType: DocumentType;
  confidence: number;
}

export interface DocumentWithExtracted {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  originalFilename: string;
  rawFilePath: string;
  mimeType: string;
  uploadedAt: Date;
  updatedAt: Date;
  groupId: string | null;
  extractedData?: {
    id: string;
    lrNo: string | null;
    invoiceNo: string | null;
    vehicleNo: string | null;
    quantity: string | null;
    date: string | null;
    partyNames: string[] | null;
    tollAmount: string | null;
    weightInfo: string | null;
    transporter: string | null;
    rawOcrResponse: string;
    confidence: number | null;
    ocrProcessedAt: Date;
    userReviewed: boolean;
    reviewedAt: Date | null;
    userEdits: Record<string, unknown> | null;
  };
}

export interface ReviewPayload {
  lrNo?: string;
  invoiceNo?: string;
  vehicleNo?: string;
  quantity?: string;
  date?: string;
  partyNames?: string[];
  tollAmount?: string;
  weightInfo?: string;
  transporter?: string;
  documentType?: DocumentType;
}

export interface BundlePreviewRequest {
  groupId: string;
  recipientType: RecipientType;
}

export interface CreateBundlePayload {
  groupId: string;
  recipientType: RecipientType;
  documentIds: string[];  // manually selected / overridden list
  notes?: string;
}

export interface UpdateBundlePayload {
  documentIds?: string[];
  status?: BundleStatus;
  notes?: string;
}

// ── Advanced Search ────────────────────────────────────────────────────────────

/**
 * Structured filter set accepted by GET /api/search/documents.
 * All fields are optional — omitting a field means "no filter on that field".
 */
export interface AdvancedSearchFilters {
  // Org scope (automatically enforced from JWT; callers may only narrow further)
  companyId?: string;
  source?: string;

  // Document type / status
  documentType?: DocumentType;
  documentStatus?: DocumentStatus;

  // Logistics reference fields (partial-match)
  lrNo?: string;
  invoiceNo?: string;
  vehicleNo?: string;
  partyName?: string;
  transporter?: string;

  // Extracted date range (YYYY-MM-DD)
  dateFrom?: string;
  dateTo?: string;

  // Upload timestamp range (ISO-8601)
  uploadedFrom?: string;
  uploadedTo?: string;

  // Pagination
  page?: number;
  limit?: number;

  // Sorting
  sortBy?: 'uploadedAt' | 'date';
  sortDir?: 'asc' | 'desc';
}

export interface SearchResultItem {
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
    transporter: string | null;
    confidence: number | null;
    userReviewed: boolean;
  };
}

export interface AdvancedSearchResponse {
  filters: AdvancedSearchFilters;
  results: SearchResultItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

/** Payload for creating a saved filter. */
export interface SavedFilterPayload {
  name: string;
  filters: AdvancedSearchFilters;
}

