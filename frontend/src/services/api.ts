import axios from 'axios';
import type {
  Document, PaginatedDocuments, ReviewPayload, DocumentType, DocumentStatus, DocumentGroup,
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

export const documentsApi = {
  upload: async (file: File): Promise<Document> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post<{ document: Document }>('/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data.document;
  },

  runOcr: async (documentId: string): Promise<Document> => {
    const res = await api.post<{ document: Document }>(`/documents/${documentId}/ocr`);
    return res.data.document;
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

  listGroups: async (): Promise<DocumentGroup[]> => {
    const res = await api.get<{ groups: DocumentGroup[] }>('/documents/groups');
    return res.data.groups;
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

// ── LR API ────────────────────────────────────────────────────────────────────

export type LrCreatePayload = Omit<Lr, 'id' | 'serialNo' | 'createdAt' | 'updatedAt' | 'company' | 'branch'>;

export const lrApi = {
  list: async (params?: { limit?: number; offset?: number }): Promise<PaginatedLrs> => {
    const res = await api.get<PaginatedLrs>('/lrs', { params });
    return res.data;
  },

  summary: async (): Promise<LrSummary> => {
    const res = await api.get<LrSummary>('/lrs/summary');
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

export type DriverDocType = 'LR' | 'TOLL' | 'WEIGHMENT_SLIP';

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
}

export interface Party {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
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
  gstNo?: string;
  address?: string;
}

export interface PaginatedParties {
  items: Party[];
  pagination: { total: number; page: number; limit: number; pages: number };
}

export const masterApi = {
  partiesDropdown: async (): Promise<PartyDropdownItem[]> => {
    const res = await api.get<PartyDropdownItem[]>('/master/parties/dropdown');
    return res.data;
  },

  listParties: async (params?: { page?: number; limit?: number; search?: string; includeInactive?: boolean }): Promise<PaginatedParties> => {
    const res = await api.get<PaginatedParties>('/master/parties', { params });
    return res.data;
  },

  createParty: async (data: PartyCreateInput): Promise<Party> => {
    const res = await api.post<Party>('/master/parties', data);
    return res.data;
  },

  updateParty: async (id: string, data: Partial<PartyCreateInput> & { isActive?: boolean }): Promise<Party> => {
    const res = await api.put<Party>(`/master/parties/${id}`, data);
    return res.data;
  },

  deleteParty: async (id: string): Promise<void> => {
    await api.delete(`/master/parties/${id}`);
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
