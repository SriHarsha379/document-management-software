export type DocumentType = 'LR' | 'INVOICE' | 'TOLL' | 'WEIGHMENT' | 'WEIGHMENT_PARTY' | 'WEIGHMENT_SITE' | 'EWAYBILL' | 'RECEIVING' | 'UNKNOWN';
export type DocumentStatus = 'PENDING_OCR' | 'PENDING_REVIEW' | 'REVIEWED' | 'SAVED';
export type RecipientType = 'ACCOUNTS' | 'PARTY' | 'TRANSPORTER';
export type BundleStatus = 'DRAFT' | 'READY' | 'SENT';
export type LrDocumentCategory =
  | 'LR_GENERATED'
  | 'ACKNOWLEDGED_INVOICE'
  | 'ACKNOWLEDGED_LR_COPY'
  | 'DEPOT_PLANT_WEIGHMENT_SLIP'
  | 'SITE_WEIGHMENT_SLIP'
  | 'TOLL_RECEIPT'
  | 'ADDITIONAL_ATTACHMENT_1'
  | 'ADDITIONAL_ATTACHMENT_2';

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
  driverCellNo: string | null;
  driverBillNo: string | null;
  billDate: string | null;
  billNo: string | null;
  billAmount: number | null;
  // Additional logistics fields
  ewayBillDate: string | null;
  approvedDestination: string | null;
  orderNo: string | null;
  workingCenter: string | null;
  depotPlantCode: string | null;
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
  uploadedDocuments?: Document[];
  // Confirmed document<->LR matches from the auto-link pipeline (lrNo /
  // invoiceNo / vehicleNo+date within tolerance) or a manual link. This is
  // the correct source for "which documents belong to this LR" — unlike
  // uploadedDocuments (direct lrId FK, rarely populated) it reflects the
  // actual matching logic, and unlike raw document groups it never includes
  // another LR's documents just because they share a vehicle+date.
  documentLinks?: DocumentLink[];
}

export interface DocumentLink {
  lrId: string;
  matchedFields: string; // JSON-encoded string[], e.g. '["vehicleNo","date"]'
  confidence: number;
  isManual: boolean;
  linkedAt: string;
  document: Document;
}

export interface PaginatedLrs {
  data: Lr[];
  total: number;
  limit: number;
  offset: number;
}

export interface LrSummary {
  generatedLrCount: number | null;
  generatedInvoiceCount: number | null;
  acknowledgedLrCount: number;
  acknowledgedInvoiceCount: number;
  totalUploadedDocuments: number;
  /** Uploaded-document count per LrDocumentCategory. */
  documentCountsByCategory: Record<string, number>;
  /** Uploaded-document count per DocumentType. */
  documentCountsByType: Record<string, number>;
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
  classificationConfidence?: number | null;
  ocrConfidence?: number | null;
  appliedRotation?: number | null;
  imageQuality?: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  processingNotes?: string[] | null;
  fieldConfidence?: Record<string, number> | null;
  validationIssues?: string[] | null;
  ocrProcessedAt: string;
  userReviewed: boolean;
  reviewedAt: string | null;
  userEdits: Record<string, unknown> | null;
  hasStamp?: boolean | null;
  hasSignature?: boolean | null;
  billToParty?: string | null;
  shipToParty?: string | null;
  principalCompany?: string | null;
  branchName?: string | null;
  loadingSlipNo?: string | null;
  companyInvoiceNo?: string | null;
  companyInvoiceDate?: string | null;
  companyEwayBillNo?: string | null;
  ewayBillDate?: string | null;
  approvedDestination?: string | null;
  deliveryDestination?: string | null;
  orderNo?: string | null;
  productName?: string | null;
  transporterName?: string | null;
  orderType?: string | null;
  tptCode?: string | null;
  quantityInMt?: number | null;
  quantityInBags?: number | null;
  driverName?: string | null;
  driverCellNo?: string | null;
  workingCenter?: string | null;
  depotPlantCode?: string | null;
  source?: string | null;
}

export interface DocumentGroup {
  id: string;
  vehicleNo: string;
  date: string;
  createdAt: string;
  documents?: Document[];
}

/** Another document whose Invoice No AND LR No both match this one's. */
export interface DuplicateMatch {
  documentId: string;
  originalFilename: string;
  lrDocumentCategory: LrDocumentCategory | null;
  uploadedAt: string;
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
  lrId?: string | null;
  lrDocumentCategory?: LrDocumentCategory | null;
  uploadedById?: string | null;
  uploadedBy?: { id: string; name: string; email: string } | null;
  /** Present when this document was extracted from a multi-page PDF. */
  sourceDocumentId?: string | null;
  /** 1-based page index within the source PDF; null for non-page documents. */
  pageNumber?: number | null;
  extractedData?: ExtractedData;
  group?: DocumentGroup;
  /** Other documents sharing this one's Invoice No AND LR No. Empty when none. */
  duplicates?: DuplicateMatch[];
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
  billToParty?: string;
  shipToParty?: string;
  principalCompany?: string;
  branchName?: string;
  loadingSlipNo?: string;
  companyInvoiceNo?: string;
  companyInvoiceDate?: string;
  companyEwayBillNo?: string;
  ewayBillDate?: string;
  approvedDestination?: string;
  deliveryDestination?: string;
  orderNo?: string;
  productName?: string;
  transporterName?: string;
  orderType?: string;
  tptCode?: string;
  quantityInMt?: number;
  quantityInBags?: number;
  driverName?: string;
  driverCellNo?: string;
  workingCenter?: string;
  depotPlantCode?: string;
  source?: string;
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
  smtp?: {
    messageId: string;
    accepted: string[];
    rejected: string[];
    response?: string;
  };
}

export interface PaginatedDispatchLogs {
  logs: DispatchLog[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}