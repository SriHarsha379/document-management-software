export type DocumentType = 'LR' | 'INVOICE' | 'TOLL' | 'WEIGHMENT' | 'EWAYBILL' | 'RECEIVING' | 'UNKNOWN';
export type DocumentStatus = 'PENDING_OCR' | 'PENDING_REVIEW' | 'REVIEWED' | 'SAVED';
export type RecipientType = 'ACCOUNTS' | 'PARTY' | 'TRANSPORTER';
export type BundleStatus = 'DRAFT' | 'READY' | 'SENT';

// ── Lorry Receipt (LR) ────────────────────────────────────────────────────────

export interface Lr {
  id: string;
  serialNo: number | null;
  lrNo: string;
  lrDate: string | null;
  loadingSlipNo: string | null;
  companyInvoiceDate: string | null;
  companyInvoiceNo: string | null;
  companyEwayBillNo: string | null;
  principalCompany: string | null;
  billToParty: string | null;
  shipToParty: string | null;
  deliveryDestination: string | null;
  tpt: string | null;
  orderType: string | null;
  productName: string | null;
  vehicleNo: string | null;
  quantityInBags: number | null;
  quantityInMt: number | null;
  tollCharges: number | null;
  weighmentCharges: number | null;
  unloadingAtSite: number | null;
  driverBhatta: number | null;
  dayOpeningKm: number | null;
  dayClosingKm: number | null;
  totalRunningKm: number | null;
  fuelPerKm: number | null;
  fuelAmount: number | null;
  grandTotal: number | null;
  tptCode: string | null;
  transporterName: string | null;
  driverName: string | null;
  driverBillNo: string | null;
  billDate: string | null;
  billNo: string | null;
  billAmount: number | null;
  // Legacy
  invoiceNo: string | null;
  status: string;
  consignor: string | null;
  consignee: string | null;
  date: string | null;
  source: string;
  companyId: string;
  branchId: string;
  createdAt: string;
  updatedAt: string;
  company?: { id: string; name: string };
  branch?: { id: string; name: string };
}

export interface PaginatedLrs {
  data: Lr[];
  total: number;
  limit: number;
  offset: number;
}

export interface LrSummary {
  lrCount: number;
  invoiceCount: number;
}

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

// ── AI Search types ────────────────────────────────────────────────────────────

export interface SearchFilters {
  vehicleNo?: string;
  documentType?: DocumentType;
  lrNo?: string;
  invoiceNo?: string;
  partyName?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface SearchDocumentResult {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
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
  results: SearchDocumentResult[];
  total: number;
}

// ── Dispatch types ─────────────────────────────────────────────────────────────

export type DispatchChannel = 'EMAIL' | 'WHATSAPP';
export type DispatchStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface DispatchLog {
  id: string;
  bundleId: string;
  channel: DispatchChannel;
  recipient: string;
  ccRecipient: string | null;
  message: string;
  status: DispatchStatus;
  errorMsg: string | null;
  sentAt: string;
  bundle?: {
    recipientType: RecipientType;
    group: { vehicleNo: string; date: string };
  };
}

export interface DispatchResult {
  success: boolean;
  logId: string;
  message?: string;
  error?: string;
}

export interface PaginatedDispatchLogs {
  logs: DispatchLog[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}
