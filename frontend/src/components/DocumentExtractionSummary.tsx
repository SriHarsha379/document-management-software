import type { CSSProperties } from 'react';
import type { Document, DocumentType } from '../types';

const TYPE_LABELS: Record<DocumentType, string> = {
  LR: 'Lorry Receipt',
  INVOICE: 'Invoice',
  TOLL: 'Toll Receipt',
  WEIGHMENT: 'Weighment Slip',
  WEIGHMENT_PARTY: 'Party Weighment Slip',
  WEIGHMENT_SITE: 'Site Weighment Slip',
  EWAYBILL: 'E-Way Bill',
  RECEIVING: 'Receiving Copy',
  UNKNOWN: 'Unknown',
};

export function DocumentExtractionSummary({ document, compact = false }: { document: Document; compact?: boolean }) {
  const fields = getDocumentSummaryFields(document);
  if (fields.length === 0) {
    return <span style={emptyText}>No extracted fields yet.</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 4 : 6 }}>
      {fields.map((field) => (
        <div key={field.label} style={fieldRow}>
          <span style={fieldLabel}>{field.label}</span>
          <span style={{ ...fieldValue, ...(compact ? compactFieldValue : null) }}>{field.value}</span>
        </div>
      ))}
    </div>
  );
}

export function getDocumentSummaryTitle(document: Document) {
  const pagePart = document.pageNumber ? ` · Page ${document.pageNumber}` : '';
  return `${TYPE_LABELS[document.type]}${pagePart}`;
}

function getDocumentSummaryFields(document: Document) {
  const ed = document.extractedData;
  if (!ed) return [];

  const partyText = ed.partyNames?.filter(Boolean).join(', ') || null;
  const common = [
    makeField('LR No', ed.lrNo),
    makeField('Invoice No', ed.invoiceNo || ed.companyInvoiceNo),
    makeField('Vehicle No', ed.vehicleNo),
    makeField('Date', ed.date || ed.companyInvoiceDate || ed.ewayBillDate),
  ];

  switch (document.type) {
    case 'LR':
      return [
        ...common,
        makeField('Bill To', ed.billToParty),
        makeField('Ship To', ed.shipToParty),
        makeField('Driver', ed.driverName),
        makeField('Qty', ed.quantity || formatQuantities(ed.quantityInMt, ed.quantityInBags)),
      ].filter(Boolean) as Array<{ label: string; value: string }>;
    case 'INVOICE':
      return [
        ...common,
        makeField('Bill To', ed.billToParty),
        makeField('Ship To', ed.shipToParty),
        makeField('Product', ed.productName),
        makeField('Source', ed.source),
      ].filter(Boolean) as Array<{ label: string; value: string }>;
    case 'WEIGHMENT':
    case 'WEIGHMENT_PARTY':
    case 'WEIGHMENT_SITE':
      return [
        ...common,
        makeField('Weight', ed.weightInfo),
        makeField('Qty', ed.quantity || formatQuantities(ed.quantityInMt, ed.quantityInBags)),
        makeField('Party', partyText),
      ].filter(Boolean) as Array<{ label: string; value: string }>;
    case 'TOLL':
      return [
        ...common,
        makeField('Toll', ed.tollAmount),
        makeField('Party', partyText),
      ].filter(Boolean) as Array<{ label: string; value: string }>;
    default:
      return [
        ...common,
        makeField('Party', partyText),
        makeField('Weight', ed.weightInfo),
      ].filter(Boolean) as Array<{ label: string; value: string }>;
  }
}

function makeField(label: string, value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return { label, value: trimmed };
}

function formatQuantities(quantityInMt?: number | null, quantityInBags?: number | null) {
  const parts = [
    quantityInMt != null ? `${quantityInMt} MT` : null,
    quantityInBags != null ? `${quantityInBags} Bags` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

const fieldRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '96px minmax(0, 1fr)',
  gap: 8,
  alignItems: 'start',
};

const fieldLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const fieldValue: CSSProperties = {
  fontSize: 12,
  color: '#1f2937',
  lineHeight: 1.5,
};

const compactFieldValue: CSSProperties = {
  fontSize: 11,
};

const emptyText: CSSProperties = {
  fontSize: 12,
  color: '#9ca3af',
};
