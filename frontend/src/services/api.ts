import axios from 'axios';
import type { Document, PaginatedDocuments, ReviewPayload, DocumentType, DocumentStatus, DocumentGroup } from '../types';

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
};
