export type DocumentType = 'LR' | 'INVOICE' | 'TOLL' | 'WEIGHMENT' | 'UNKNOWN';
export type DocumentStatus = 'PENDING_OCR' | 'PENDING_REVIEW' | 'REVIEWED' | 'SAVED';

export interface ExtractedFields {
  lrNo?: string;
  invoiceNo?: string;
  vehicleNo?: string;
  quantity?: string;
  date?: string;
  partyNames?: string[];
  tollAmount?: string;
  weightInfo?: string;
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
  documentType?: DocumentType;
}
