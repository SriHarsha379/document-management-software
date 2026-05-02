import React, { useState } from 'react';
import type { Document, DocumentType, ReviewPayload } from '../types';
import { documentsApi } from '../services/api';

interface Props {
  document: Document;
  onSaved: (doc: Document) => void;
  onCancel: () => void;
}

const DOCUMENT_TYPES: DocumentType[] = ['LR', 'INVOICE', 'TOLL', 'WEIGHMENT', 'EWAYBILL', 'RECEIVING', 'UNKNOWN'];

const TYPE_LABELS: Record<DocumentType, string> = {
  LR: '📦 Lorry Receipt (LR)',
  INVOICE: '🧾 Invoice',
  TOLL: '🛣️ Toll Receipt',
  WEIGHMENT: '⚖️ Weighment Slip',
  EWAYBILL: '🔖 E-Way Bill',
  RECEIVING: '📬 Receiving Copy',
  UNKNOWN: '❓ Unknown',
};

const CONFIDENCE_COLOR = (c: number | null) => {
  if (c === null) return '#888';
  if (c >= 0.8) return '#22c55e';
  if (c >= 0.6) return '#f59e0b';
  return '#ef4444';
};

export function OCRReview({ document, onSaved, onCancel }: Props) {
  const ed = document.extractedData;

  const [form, setForm] = useState<ReviewPayload>({
    documentType: document.type,
    lrNo: ed?.lrNo ?? '',
    invoiceNo: ed?.invoiceNo ?? '',
    vehicleNo: ed?.vehicleNo ?? '',
    quantity: ed?.quantity ?? '',
    date: ed?.date ?? '',
    partyNames: ed?.partyNames ?? [],
    tollAmount: ed?.tollAmount ?? '',
    weightInfo: ed?.weightInfo ?? '',
  });

  const [partyNamesText, setPartyNamesText] = useState((ed?.partyNames ?? []).join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (field: keyof ReviewPayload, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePartyNamesChange = (val: string) => {
    setPartyNamesText(val);
    setForm((prev) => ({ ...prev, partyNames: val.split('\n').map((s) => s.trim()).filter(Boolean) }));
  };

  const handleSave = async () => {
    try {
      setSaving(true); setError(null);
      const saved = await documentsApi.review(document.id, form);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const confidence = ed?.confidence ?? null;
  const imageUrl = document.mimeType.startsWith('image/') ? `/uploads/${document.filePath}` : null;

  return (
    <div>
      {/* Header */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', padding: '20px 24px', marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: '#1a1a2e' }}>Review Extracted Data</h2>
          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>{document.originalFilename}</p>
        </div>
        {confidence !== null && (
          <div style={{ fontWeight: 700, fontSize: 14, border: '2px solid currentColor', borderRadius: 20, padding: '5px 14px', color: CONFIDENCE_COLOR(confidence) }}>
            {Math.round(confidence * 100)}% confidence
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Preview */}
        {imageUrl && (
          <div style={{ flex: '0 0 280px', background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', padding: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <img src={imageUrl} alt="Document" style={{ width: '100%', borderRadius: 8, objectFit: 'contain', maxHeight: 480 }} />
          </div>
        )}

        {/* Form */}
        <div style={{ flex: '1 1 400px', background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          {(!form.vehicleNo || !form.date) && (
            <div style={{ background: '#fff8f0', border: '1.5px solid #e97a00', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#7a3f00', marginBottom: 16, lineHeight: 1.5 }}>
              ⚠️ <strong>Action needed:</strong>{' '}
              {[!form.vehicleNo && 'Vehicle Number', !form.date && 'Date'].filter(Boolean).join(' and ')}{' '}
              {(!form.vehicleNo && !form.date) ? 'are' : 'is'} missing.
            </div>
          )}

          <div style={fieldGroup}>
            <label style={labelStyle}>Document Type</label>
            <select style={inputStyle} value={form.documentType} onChange={(e) => handleChange('documentType', e.target.value)}>
              {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Field label="LR Number" value={form.lrNo ?? ''} onChange={(v) => handleChange('lrNo', v)} />
            <Field label="Invoice Number" value={form.invoiceNo ?? ''} onChange={(v) => handleChange('invoiceNo', v)} />
            <Field label="Vehicle Number ✱" value={form.vehicleNo ?? ''} onChange={(v) => handleChange('vehicleNo', v)} placeholder="e.g. MH12AB1234" highlight={!form.vehicleNo} />
            <Field label="Date (YYYY-MM-DD) ✱" value={form.date ?? ''} onChange={(v) => handleChange('date', v)} placeholder="YYYY-MM-DD" highlight={!form.date} />
            <Field label="Quantity" value={form.quantity ?? ''} onChange={(v) => handleChange('quantity', v)} placeholder="e.g. 10 MT" />
            <Field label="Toll Amount" value={form.tollAmount ?? ''} onChange={(v) => handleChange('tollAmount', v)} />
          </div>

          <div style={fieldGroup}>
            <label style={labelStyle}>Weight Info</label>
            <input style={inputStyle} value={form.weightInfo ?? ''} onChange={(e) => handleChange('weightInfo', e.target.value)} placeholder="Gross: 15000 kg, Tare: 5000 kg, Net: 10000 kg" />
          </div>

          <div style={fieldGroup}>
            <label style={labelStyle}>Party Names (one per line)</label>
            <textarea
              style={{ ...inputStyle, resize: 'vertical' as const }}
              value={partyNamesText}
              onChange={(e) => handlePartyNamesChange(e.target.value)}
              rows={3}
              placeholder={"Consignor name\nConsignee name"}
            />
          </div>

          {document.groupId && (
            <div style={{ background: '#eef0ff', border: '1px solid #c0c8ff', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#4361ee', marginBottom: 14 }}>
              🔗 Linked to group: <strong>{document.groupId.slice(0, 8)}…</strong>
              {document.group && (
                <span> · {document.group.vehicleNo} on {document.group.date}
                  {document.group.documents && ` · ${document.group.documents.length} doc(s)`}
                </span>
              )}
            </div>
          )}

          {error && <div style={{ color: '#b91c1c', fontSize: 13, background: '#fef2f2', borderRadius: 7, padding: '8px 12px', marginBottom: 12 }}>⚠️ {error}</div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button
              style={{ flex: 1, padding: '11px 20px', background: saving ? '#9ca3af' : '#4361ee', color: '#fff', border: 'none', borderRadius: 9, cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 14, boxShadow: saving ? 'none' : '0 2px 8px rgba(67,97,238,0.3)', transition: 'background 0.15s' }}
              onClick={() => { void handleSave(); }}
              disabled={saving}
            >
              {saving ? '💾 Saving…' : '✅ Save & Confirm'}
            </button>
            <button
              style={{ padding: '11px 16px', background: '#f0f0f8', color: '#444', border: '1px solid #e0e0f0', borderRadius: 9, cursor: 'pointer', fontSize: 14 }}
              onClick={onCancel}
              disabled={saving}
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, highlight }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; highlight?: boolean;
}) {
  return (
    <div style={fieldGroup}>
      <label style={{ ...labelStyle, ...(highlight ? { color: '#e97a00' } : {}) }}>{label}</label>
      <input
        style={{ ...inputStyle, ...(highlight ? { border: '2px solid #e97a00', background: '#fff8f0' } : {}) }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '—'}
      />
    </div>
  );
}

const fieldGroup: React.CSSProperties = { marginBottom: 14 };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #d0d0e0', borderRadius: 7, fontSize: 14, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit', color: '#1a1a2e', transition: 'border-color 0.15s, box-shadow 0.15s' };
