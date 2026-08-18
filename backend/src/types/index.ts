export type DocumentType = 'LR' | 'INVOICE' | 'TOLL' | 'WEIGHMENT' | 'WEIGHMENT_PARTY' | 'WEIGHMENT_SITE' | 'EWAYBILL' | 'RECEIVING' | 'UNKNOWN';
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
  // Extended LR fields extracted from document
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
  // Seal number — printed "Seal No." on the LR, or handwritten/annotated on
  // a weighment slip. Used as a strong auto-link match key for weighment docs.
  sealNo?: string;
  // Time-of-day the document itself records: LR "Out Time", the weighbridge
  // in/out time, or the toll "Debited at" time. Format "HH:MM" or "HH:MM:SS",
  // 24-hour where possible. Used to disambiguate same-vehicle, same-day trips.
  documentTime?: string;
  // Recipient-side visual acknowledgement checks from the OCR vision model.
  hasStamp?: boolean;
  hasSignature?: boolean;

  // ── Weighbridge slip fields ───────────────────────────────────────────────
  // These drive the challanNo / netWeight auto-link tiers and the origin vs
  // destination classification. Without them the matcher falls back to the
  // weak vehicle+date heuristic, so every one of these must survive the trip
  // from the OCR JSON into extracted_data.
  /** "Challan No" / "GRN No" on a weighbridge slip. Sometimes equals the invoice number verbatim. */
  challanNo?: string;
  /** Weighbridge or company name from the slip letterhead. */
  bridgeName?: string;
  /** Gross / tare in kg, when the slip uses those labels. */
  grossWeightKg?: number;
  tareWeightKg?: number;
  /** First / second reading in kg, when the slip labels them that way instead. */
  firstWeightKg?: number;
  secondWeightKg?: number;
  /** Net weight in kg, parsed rather than left inside the weightInfo blob. */
  netWeightKg?: number;
  /** Per-reading timestamps, ISO 8601. Readings routinely straddle midnight. */
  grossWeightAt?: string;
  tareWeightAt?: string;
  firstWeightAt?: string;
  secondWeightAt?: string;
  /** Shortage as PRINTED on the slip (e.g. "Weight Diff. Qty"). */
  statedWeightDiffKg?: number;

  documentType?: DocumentType;
  confidence?: number;
  classificationConfidence?: number;
  ocrConfidence?: number;
  appliedRotation?: number;
  imageQuality?: 'HIGH' | 'MEDIUM' | 'LOW';
  processingNotes?: string[];
  fieldConfidence?: Record<string, number>;
  validationIssues?: string[];
  // ── Multi-document-per-page support ──────────────────────────────────────
  // Some source documents are photographed/scanned with more than one
  // physical slip on a single page image (e.g. two FASTag toll-swipe
  // screenshots stitched together, or an origin + destination weighment
  // slip on the same sheet). The primary fields above always describe the
  // FIRST/most prominent entry; any further entries the model can identify
  // on the same image are captured here so they aren't silently dropped.
  // The OCR route turns each of these into its own sibling Document record.
  additionalTollEntries?: Array<{
    tollAmount?: string;
    documentTime?: string;
    vehicleNo?: string;
    date?: string;
  }>;
  additionalWeighments?: Array<{
    vehicleNo?: string;
    date?: string;
    weightInfo?: string;
    sealNo?: string;
    documentTime?: string;
    documentType?: DocumentType;
  }>;
}

export interface OcrResult {
  fields: ExtractedFields;
  rawResponse: string;
  documentType: DocumentType;
  confidence: number;
  metadata: {
    classificationConfidence: number;
    ocrConfidence: number;
    appliedRotation: number;
    imageQuality: 'HIGH' | 'MEDIUM' | 'LOW';
    processingNotes: string[];
    fieldConfidence: Record<string, number>;
    validationIssues: string[];
  };
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
    billToParty: string | null;
    shipToParty: string | null;
    principalCompany: string | null;
    branchName: string | null;
    loadingSlipNo: string | null;
    companyInvoiceNo: string | null;
    companyInvoiceDate: string | null;
    companyEwayBillNo: string | null;
    ewayBillDate: string | null;
    approvedDestination: string | null;
    deliveryDestination: string | null;
    orderNo: string | null;
    productName: string | null;
    transporterName: string | null;
    orderType: string | null;
    tptCode: string | null;
    quantityInMt: number | null;
    quantityInBags: number | null;
    driverName: string | null;
    driverCellNo: string | null;
    workingCenter: string | null;
    depotPlantCode: string | null;
    source: string | null;
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
  sealNo?: string;
  documentTime?: string;
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
