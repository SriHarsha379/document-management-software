export type DocumentType = 'LR' | 'INVOICE' | 'TOLL' | 'WEIGHMENT' | 'UNKNOWN';
export type DocumentStatus = 'PENDING_OCR' | 'PENDING_REVIEW' | 'REVIEWED' | 'SAVED';

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
