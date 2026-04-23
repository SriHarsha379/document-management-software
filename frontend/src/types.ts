export type DocumentType = 'LR' | 'INVOICE' | 'TOLL' | 'WEIGHMENT' | 'EWAYBILL' | 'RECEIVING' | 'UNKNOWN';
export type DocumentStatus = 'PENDING_OCR' | 'PENDING_REVIEW' | 'REVIEWED' | 'SAVED';
export type RecipientType = 'ACCOUNTS' | 'PARTY' | 'TRANSPORTER';
export type BundleStatus = 'DRAFT' | 'READY' | 'SENT';

export interface ExtractedData {
  id: string;
  lrNo: string | null;
  invoiceNo: string | null;
  vehicleNo: string | null;
  quantity: string | null;
  date: string | null;
  partyNames: string[] | null;
  tollAmount: string | null;
  weightInfo: string | null;
  confidence: number | null;
  ocrProcessedAt: string;
  userReviewed: boolean;
  reviewedAt: string | null;
  userEdits: Record<string, unknown> | null;
}

export interface DocumentGroup {
  id: string;
  vehicleNo: string;
  date: string;
  createdAt: string;
  documents?: Document[];
}

export interface Document {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  originalFilename: string;
  mimeType: string;
  filePath: string;
  uploadedAt: string;
  updatedAt: string;
  groupId: string | null;
  extractedData?: ExtractedData;
  group?: DocumentGroup;
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
  documentType?: DocumentType;
}

export interface PaginatedDocuments {
  documents: Document[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

// ── Bundling types ─────────────────────────────────────────────────────────────

export interface BundleDocumentItem {
  documentId: string;
  type: DocumentType;
  originalFilename: string;
  status: DocumentStatus;
  isOverride: boolean;
}

export interface BundlePreview {
  groupId: string;
  recipientType: RecipientType;
  requiredTypes: DocumentType[];
  autoSelectedDocuments: BundleDocumentItem[];
  missingTypes: DocumentType[];
}

export interface BundleItem {
  id: string;
  documentId: string;
  isOverride: boolean;
  document?: Document;
}

export interface Bundle {
  id: string;
  recipientType: RecipientType;
  status: BundleStatus;
  notes: string | null;
  groupId: string;
  createdAt: string;
  updatedAt: string;
  group?: DocumentGroup;
  items: BundleItem[];
}

export interface PaginatedBundles {
  bundles: Bundle[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}
