import axios from 'axios';
import type {
  Document, PaginatedDocuments, ReviewPayload, DocumentType, DocumentStatus, DocumentGroup, LrDocumentCategory,
  Bundle, PaginatedBundles, BundlePreview, RecipientType, BundleStatus,
} from '../types';
import { authService } from './authService';

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
});

api.interceptors.request.use((config) => {
  const token = authService.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => Promise.reject(error));

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      authService.clearToken();
    }
    return Promise.reject(error);
  }
);

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    companyId: string;
    roleKeys: string[];
    permissionKeys: string[];
    isSuperAdmin: boolean;
  };
}

export const authApi = {
  login: async (email: string, password: string): Promise<LoginResponse> => {
    const res = await api.post<LoginResponse>('/auth/login', { email, password });
    return res.data;
  },
};

export interface ListDocumentsParams {
  type?: DocumentType;
  status?: DocumentStatus;
  vehicleNo?: string;
  ungrouped?: boolean;
  page?: number;
  limit?: number;
}

/** Response shape returned by POST /api/documents/upload. */
export interface UploadResponse {
  /** The primary document (first page doc for multi-page PDFs, the only doc otherwise). */
  document: Document;
  /** All created documents – one per page for multi-page PDFs, one element otherwise. */
  documents: Document[];
  pageCount: number;
  isPdfMultiPage: boolean;
  /** ID of the source Document that holds the original PDF file (multi-page only). */
  sourceDocumentId?: string | null;
}

export const documentsApi = {
  upload: async (file: File, opts?: { type?: DocumentType; groupId?: string; lrDocumentCategory?: LrDocumentCategory }): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    if (opts?.type) formData.append('type', opts.type);
    if (opts?.groupId) formData.append('groupId', opts.groupId);
    if (opts?.lrDocumentCategory) formData.append('lrDocumentCategory', opts.lrDocumentCategory);
    const res = await api.post<UploadResponse>('/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },

  runOcr: async (documentId: string): Promise<{ document: Document; additionalDocumentIds: string[] }> => {
    // OCR can trigger multiple sequential GPT-4o vision calls on the backend
    // (up to 4 rotation variants + a hints-guided retry), which routinely
    // exceeds the default 60s timeout. Give this call much more headroom.
    const res = await api.post<{ document: Document; additionalDocumentIds?: string[] }>(
      `/documents/${documentId}/ocr`,
      undefined,
      { timeout: 180000 },
    );
    // additionalDocumentIds is populated when the source image contained more
    // than one toll swipe or weighment slip (see additionalTollEntries /
    // additionalWeighments in the OCR prompt) — each one became its own
    // sibling Document server-side. Callers that care about surfacing those
    // for review (e.g. DocumentUpload) should fetch them via getById.
    return { document: res.data.document, additionalDocumentIds: res.data.additionalDocumentIds ?? [] };
  },

  review: async (documentId: string, payload: ReviewPayload): Promise<Document> => {
    const res = await api.put<{ document: Document }>(`/documents/${documentId}/review`, payload);
    return res.data.document;
  },

  list: async (params?: ListDocumentsParams): Promise<PaginatedDocuments> => {
    const res = await api.get<PaginatedDocuments>('/documents', { params });
    return res.data;
  },

  getById: async (id: string): Promise<Document> => {
    const res = await api.get<{ document: Document }>(`/documents/${id}`);
    return res.data.document;
  },

  getGroup: async (groupId: string): Promise<DocumentGroup> => {
    const res = await api.get<{ group: DocumentGroup }>(`/documents/groups/${groupId}`);
    return res.data.group;
  },

  listGroups: async (params?: { page?: number; limit?: number; q?: string }): Promise<{ groups: DocumentGroup[]; pagination: { total: number; page: number; limit: number; pages: number } }> => {
    const res = await api.get<{ groups: DocumentGroup[]; pagination: { total: number; page: number; limit: number; pages: number } }>('/documents/groups', { params });
    return res.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/documents/${id}`);
  },
};

export interface ListBundlesParams {
  recipientType?: RecipientType;
  status?: BundleStatus;
  groupId?: string;
  page?: number;
  limit?: number;
}

export const bundlesApi = {
  preview: async (groupId: string, recipientType: RecipientType): Promise<BundlePreview> => {
    const res = await api.post<{ preview: BundlePreview }>('/bundles/preview', { groupId, recipientType });
    return res.data.preview;
  },

  create: async (payload: {
    groupId: string;
    recipientType: RecipientType;
    documentIds: string[];
    notes?: string;
  }): Promise<Bundle> => {
    const res = await api.post<{ bundle: Bundle }>('/bundles', payload);
    return res.data.bundle;
  },

  list: async (params?: ListBundlesParams): Promise<PaginatedBundles> => {
    const res = await api.get<PaginatedBundles>('/bundles', { params });
    return res.data;
  },

  getById: async (id: string): Promise<Bundle> => {
    const res = await api.get<{ bundle: Bundle }>(`/bundles/${id}`);
    return res.data.bundle;
  },

  update: async (id: string, payload: {
    documentIds?: string[];
    status?: BundleStatus;
    notes?: string;
  }): Promise<Bundle> => {
    const res = await api.put<{ bundle: Bundle }>(`/bundles/${id}`, payload);
    return res.data.bundle;
  },

  remove: async (id: string): Promise<void> => {
    await api.delete(`/bundles/${id}`);
  },
};

import type { SearchResponse } from '../types';
import type { Lr, PaginatedLrs, LrSummary } from '../types';

export const ACCOUNTANT_ROLE = 'Accountant';

// ── LR API ────────────────────────────────────────────────────────────────────

export type LrCreatePayload = Omit<Lr, 'id' | 'serialNo' | 'createdAt' | 'updatedAt' | 'company' | 'branch'>;

export const lrApi = {
  list: async (params?: {
    limit?: number;
    offset?: number;
    q?: string;
    principalCompany?: string;
    branchId?: string;
    lrDate?: string;
    invoiceDate?: string;
    invoiceNo?: string;
    lrNo?: string;
    vehicleNo?: string;
    driverName?: string;
    productName?: string;
    tptCode?: string;
    workingCenter?: string;
    depotPlantCode?: string;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
  }): Promise<PaginatedLrs> => {
    const res = await api.get<PaginatedLrs>('/lrs', { params });
    return res.data;
  },

  summary: async (): Promise<LrSummary> => {
    const res = await api.get<LrSummary>('/lrs/summary');
    return res.data;
  },

  listDocuments: async (lrId: string): Promise<{
    lr: { id: string; lrNo: string; lrDate: string | null; billToParty: string | null; shipToParty: string | null };
    documents: Document[];
    recipientSuggestions: {
      suggestedTo: string[];
      suggestions: Array<{ type: string; label: string; value: string; sourceName: string }>;
    };
  }> => {
    const res = await api.get<{
      lr: { id: string; lrNo: string; lrDate: string | null; billToParty: string | null; shipToParty: string | null };
      documents: Document[];
      recipientSuggestions: {
        suggestedTo: string[];
        suggestions: Array<{ type: string; label: string; value: string; sourceName: string }>;
      };
    }>(`/lrs/${lrId}/documents`);
    return res.data;
  },

  uploadDocument: async (lrId: string, category: LrDocumentCategory, file: File): Promise<Document> => {
    const formData = new FormData();
    formData.append('category', category);
    formData.append('file', file);
    const res = await api.post<{ message: string; document: Document }>(`/lrs/${lrId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data.document;
  },

  deleteDocument: async (lrId: string, documentId: string): Promise<void> => {
    await api.delete(`/lrs/${lrId}/documents/${documentId}`);
  },

  sendDocumentsEmail: async (lrId: string, payload: { to: string[]; cc?: string[]; bcc?: string[] }): Promise<{
    message: string;
    smtp: {
      messageId: string;
      accepted: string[];
      rejected: string[];
      response?: string;
    };
  }> => {
    const res = await api.post<{
      message: string;
      smtp: {
        messageId: string;
        accepted: string[];
        rejected: string[];
        response?: string;
      };
    }>(`/lrs/${lrId}/send-email`, payload);
    return res.data;
  },

  filterValues: async (): Promise<{
    principalCompanies: string[];
    vehicleNos: string[];
    productNames: string[];
    tptCodes: string[];
    driverNames: string[];
    workingCenters: string[];
    depotPlantCodes: string[];
  }> => {
    const res = await api.get<{
      principalCompanies: string[];
      vehicleNos: string[];
      productNames: string[];
      tptCodes: string[];
      driverNames: string[];
      workingCenters: string[];
      depotPlantCodes: string[];
    }>('/lrs/filter-values');
    return res.data;
  },

  create: async (payload: Partial<LrCreatePayload>): Promise<Lr> => {
    const res = await api.post<{ data: Lr }>('/lrs', payload);
    return res.data.data;
  },

  update: async (id: string, payload: Partial<LrCreatePayload>): Promise<Lr> => {
    const res = await api.patch<{ data: Lr }>(`/lrs/${id}`, payload);
    return res.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/lrs/${id}`);
  },

  syncFromDocuments: async (): Promise<{ processed: number; created: number; linked: number }> => {
    const res = await api.post<{ processed: number; created: number; linked: number }>('/lrs/sync-from-documents');
    return res.data;
  },

  branches: async (): Promise<{ id: string; name: string }[]> => {
    const res = await api.get<{ id: string; name: string }[]>('/lrs/branches');
    return res.data;
  },
};

export const searchApi = {
  query: async (query: string): Promise<SearchResponse> => {
    const res = await api.post<SearchResponse>('/search', { query });
    return res.data;
  },
};

import type { DispatchResult, PaginatedDispatchLogs, DispatchChannel } from '../types';

export interface DispatchSendParams {
  bundleId: string;
  channel: DispatchChannel;
  recipient: string;
  ccRecipient?: string;
}

export const dispatchApi = {
  send: async (params: DispatchSendParams): Promise<DispatchResult> => {
    const res = await api.post<DispatchResult>('/dispatch/send', params);
    return res.data;
  },

  listLogs: async (params?: { page?: number; limit?: number }): Promise<PaginatedDispatchLogs> => {
    const res = await api.get<PaginatedDispatchLogs>('/dispatch/logs', { params });
    return res.data;
  },

  getLogsForBundle: async (bundleId: string): Promise<PaginatedDispatchLogs> => {
    const res = await api.get<PaginatedDispatchLogs>(`/dispatch/logs/${bundleId}`);
    return res.data;
  },
};

// ── Driver Portal API ─────────────────────────────────────────────────────────

export type DriverDocType = 'LR' | 'TOLL' | 'WEIGHMENT_PARTY' | 'WEIGHMENT_SITE' | 'PARTY_ACK';

export interface DriverAccess {
  id: string;
  phone: string;
  createdAt: string;
  expiresAt: string;
  lastLoginAt: string | null;
  isRevoked: boolean;
  isExpired: boolean;
  uploadCount: number;
}

export interface DriverUploadDoc {
  id: string;
  docType: DriverDocType;
  status: 'PENDING_OCR' | 'PROCESSED' | 'UNLINKED';
  originalFilename: string;
  uploadedAt: string;
  vehicleNumber: string | null;
  documentDate: string | null;
  linkedGroupId: string | null;
  /** Present only in admin all-uploads response */
  driverPhone?: string | null;
}

export interface DriverLoginResponse {
  token: string;
  expiresAt: string;
  phone: string;
}

export interface DriverStatusResponse {
  phone: string;
  expiresAt: string;
  uploadCount: number;
}

const driverApi = axios.create({
  baseURL: '/api/driver',
  timeout: 60000,
});

const adminDriverApi = axios.create({
  baseURL: '/api/admin/driver-access',
  timeout: 30000,
});

export const driverPortalApi = {
  login: async (phone: string, password: string): Promise<DriverLoginResponse> => {
    const res = await driverApi.post<DriverLoginResponse>('/login', { phone, password });
    return res.data;
  },

  status: async (token: string): Promise<DriverStatusResponse> => {
    const res = await driverApi.get<DriverStatusResponse>('/status', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },

  upload: async (token: string, file: File, docType: DriverDocType): Promise<DriverUploadDoc> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('docType', docType);
    const res = await driverApi.post<{ document: DriverUploadDoc }>('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        Authorization: `Bearer ${token}`,
      },
    });
    return res.data.document;
  },

  listUploads: async (token: string): Promise<DriverUploadDoc[]> => {
    const res = await driverApi.get<{ uploads: DriverUploadDoc[] }>('/uploads', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data.uploads;
  },
};

export const adminDriverAccessApi = {
  create: async (phone: string): Promise<{ driverAccess: DriverAccess; generatedPassword: string }> => {
    const res = await adminDriverApi.post<{ driverAccess: DriverAccess; generatedPassword: string }>('/', { phone });
    return res.data;
  },

  list: async (): Promise<DriverAccess[]> => {
    const res = await adminDriverApi.get<{ accesses: DriverAccess[] }>('/');
    return res.data.accesses;
  },

  revoke: async (id: string): Promise<void> => {
    await adminDriverApi.put(`/${id}/revoke`);
  },

  getUploads: async (id: string): Promise<DriverUploadDoc[]> => {
    const res = await adminDriverApi.get<{ uploads: DriverUploadDoc[] }>(`/${id}/uploads`);
    return res.data.uploads;
  },

  listAllUploads: async (params?: { limit?: number; offset?: number }): Promise<{ uploads: DriverUploadDoc[]; total: number }> => {
    const res = await adminDriverApi.get<{ uploads: DriverUploadDoc[]; total: number }>('/all-uploads', { params });
    return res.data;
  },
};

// ── Customer Portal API ───────────────────────────────────────────────────────

export interface CustomerPortalAccess {
  id: string;
  partyId: string;
  partyName: string;
  partyCode: string;
  companyId: string;
  loginEmail: string;
  createdAt: string;
  expiresAt: string;
  lastLoginAt: string | null;
  isRevoked: boolean;
  isExpired: boolean;
}

export interface CustomerLoginResponse {
  token: string;
  expiresAt: string;
  partyName: string;
  loginEmail: string;
}

export interface CustomerMeResponse {
  partyName: string;
  partyCode: string;
  loginEmail: string;
  expiresAt: string;
  address: string | null;
}

export interface CustomerShipment {
  id: string;
  status: 'READY' | 'SENT';
  vehicleNo: string;
  date: string;
  documentCount: number;
  lastDispatch: { sentAt: string; channel: string; status: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDocument {
  id: string;
  type: string;
  originalFilename: string;
  uploadedAt: string;
  mimeType: string;
  extractedData: {
    lrNo: string | null;
    invoiceNo: string | null;
    vehicleNo: string | null;
    date: string | null;
    partyNames: string | null;
    transporter: string | null;
  } | null;
}

export interface CustomerShipmentDetail {
  id: string;
  status: string;
  notes: string | null;
  vehicleNo: string;
  date: string;
  documents: CustomerDocument[];
  dispatchLogs: { sentAt: string; channel: string; status: string; recipient: string }[];
  createdAt: string;
  updatedAt: string;
}

const customerApi = axios.create({
  baseURL: '/api/customer',
  timeout: 60000,
});

const adminCustomerApi = axios.create({
  baseURL: '/api/admin/customer-portal-access',
  timeout: 30000,
});

adminCustomerApi.interceptors.request.use((config) => {
  const token = authService.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => Promise.reject(error));

export const customerPortalApi = {
  login: async (email: string, token: string): Promise<CustomerLoginResponse> => {
    const res = await customerApi.post<CustomerLoginResponse>('/login', { email, token });
    return res.data;
  },

  me: async (jwtToken: string): Promise<CustomerMeResponse> => {
    const res = await customerApi.get<CustomerMeResponse>('/me', {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return res.data;
  },

  listShipments: async (jwtToken: string): Promise<CustomerShipment[]> => {
    const res = await customerApi.get<{ shipments: CustomerShipment[] }>('/shipments', {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return res.data.shipments;
  },

  getShipment: async (jwtToken: string, bundleId: string): Promise<CustomerShipmentDetail> => {
    const res = await customerApi.get<{ shipment: CustomerShipmentDetail }>(`/shipments/${bundleId}`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    return res.data.shipment;
  },

  downloadUrl: (documentId: string): string => `/api/customer/documents/${documentId}/download`,
};

// ── Master Data API ───────────────────────────────────────────────────────────

export interface PartyDropdownItem {
  id: string;
  label: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface OfficerDropdownItem {
  id: string;
  label: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface TransporterDropdownItem {
  id: string;
  label: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface Party {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  isBillToParty: boolean;
  isShipToParty: boolean;
  gstNo: string | null;
  address: string | null;
  isActive: boolean;
  companyId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PartyCreateInput {
  code: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  isBillToParty?: boolean;
  isShipToParty?: boolean;
  gstNo?: string;
  address?: string;
}

export interface Officer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string | null;
  isActive: boolean;
  companyId: string;
  createdAt: string;
  updatedAt: string;
}

export interface OfficerCreateInput {
  name: string;
  phone?: string;
  email?: string;
  role?: string;
}

export interface Transporter {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  isActive: boolean;
  companyId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransporterCreateInput {
  code: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface PaginatedParties {
  items: Party[];
  pagination: { total: number; page: number; limit: number; pages: number };
}

export interface PaginatedOfficers {
  items: Officer[];
  pagination: { total: number; page: number; limit: number; pages: number };
}

export interface PaginatedTransporters {
  items: Transporter[];
  pagination: { total: number; page: number; limit: number; pages: number };
}

export const masterApi = {
  partiesDropdown: async (usage?: 'billTo' | 'shipTo'): Promise<PartyDropdownItem[]> => {
    const res = await api.get<PartyDropdownItem[]>('/master/parties/dropdown', { params: usage ? { usage } : undefined });
    return res.data;
  },

  officersDropdown: async (role?: string): Promise<OfficerDropdownItem[]> => {
    const res = await api.get<OfficerDropdownItem[]>('/master/officers/dropdown', { params: role ? { role } : undefined });
    return res.data;
  },

  transportersDropdown: async (): Promise<TransporterDropdownItem[]> => {
    const res = await api.get<TransporterDropdownItem[]>('/master/transporters/dropdown');
    return res.data;
  },

  listParties: async (params?: { page?: number; limit?: number; search?: string; includeInactive?: boolean }): Promise<PaginatedParties> => {
    const res = await api.get<PaginatedParties>('/master/parties', { params });
    return res.data;
  },

  listOfficers: async (params?: { page?: number; limit?: number; search?: string; includeInactive?: boolean }): Promise<PaginatedOfficers> => {
    const res = await api.get<PaginatedOfficers>('/master/officers', { params });
    return res.data;
  },

  listTransporters: async (params?: { page?: number; limit?: number; search?: string; includeInactive?: boolean }): Promise<PaginatedTransporters> => {
    const res = await api.get<PaginatedTransporters>('/master/transporters', { params });
    return res.data;
  },

  createParty: async (data: PartyCreateInput): Promise<Party> => {
    const res = await api.post<Party>('/master/parties', data);
    return res.data;
  },

  createOfficer: async (data: OfficerCreateInput): Promise<Officer> => {
    const res = await api.post<Officer>('/master/officers', data);
    return res.data;
  },

  createTransporter: async (data: TransporterCreateInput): Promise<Transporter> => {
    const res = await api.post<Transporter>('/master/transporters', data);
    return res.data;
  },

  updateParty: async (id: string, data: Partial<PartyCreateInput> & { isActive?: boolean }): Promise<Party> => {
    const res = await api.put<Party>(`/master/parties/${id}`, data);
    return res.data;
  },

  deleteParty: async (id: string): Promise<void> => {
    await api.delete(`/master/parties/${id}`);
  },

  deleteOfficer: async (id: string): Promise<void> => {
    await api.delete(`/master/officers/${id}`);
  },

  deleteTransporter: async (id: string): Promise<void> => {
    await api.delete(`/master/transporters/${id}`);
  },
};

export const adminCustomerPortalApi = {
  create: async (
    partyId: string,
    loginEmail?: string,
    daysValid?: number
  ): Promise<{ access: CustomerPortalAccess; generatedToken: string }> => {
    const res = await adminCustomerApi.post<{ access: CustomerPortalAccess; generatedToken: string }>('/', {
      partyId,
      loginEmail,
      daysValid,
    });
    return res.data;
  },

  list: async (): Promise<CustomerPortalAccess[]> => {
    const res = await adminCustomerApi.get<{ accesses: CustomerPortalAccess[] }>('/');
    return res.data.accesses;
  },

  revoke: async (id: string): Promise<void> => {
    await adminCustomerApi.put(`/${id}/revoke`);
  },

  delete: async (id: string): Promise<void> => {
    await adminCustomerApi.delete(`/${id}`);
  },
};
