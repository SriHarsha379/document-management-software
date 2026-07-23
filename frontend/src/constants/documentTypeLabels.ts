import type { DocumentType } from '../types';

/** Short human-readable label for each document type, used in previews and modals. */
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  LR: 'LR',
  INVOICE: 'Invoice',
  TOLL: 'Toll Receipt',
  WEIGHMENT: 'Weighment Slip',
  WEIGHMENT_PARTY: 'Party Weighment Slip',
  WEIGHMENT_SITE: 'Site Weighment Slip',
  EWAYBILL: 'E-Way Bill',
  RECEIVING: 'Receiving Copy',
  UNKNOWN: 'Document',
};

/** Display order for the document preview carousel. */
export const PREVIEW_TYPE_ORDER: DocumentType[] = [
  'INVOICE',
  'LR',
  'WEIGHMENT_PARTY',
  'WEIGHMENT_SITE',
  'WEIGHMENT',
  'TOLL',
  'EWAYBILL',
  'RECEIVING',
  'UNKNOWN',
];
