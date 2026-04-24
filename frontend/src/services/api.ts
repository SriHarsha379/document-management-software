import axios from 'axios';
import type {
  Document, PaginatedDocuments, ReviewPayload, DocumentType, DocumentStatus, DocumentGroup,
  Bundle, PaginatedBundles, BundlePreview, RecipientType, BundleStatus,
} from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
});

export interface ListDocumentsParams {
  type?: DocumentType;
  status?: DocumentStatus;
  vehicleNo?: string;
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
};
