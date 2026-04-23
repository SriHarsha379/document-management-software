import React, { useState } from 'react';
import type { Document, DocumentType, ReviewPayload } from '../types';
import { documentsApi } from '../services/api';

interface Props {
  document: Document;
  onSaved: (doc: Document) => void;
  onCancel: () => void;
}

const DOCUMENT_TYPES: DocumentType[] = ['LR', 'INVOICE', 'TOLL', 'WEIGHMENT', 'UNKNOWN'];

const TYPE_LABELS: Record<DocumentType, string> = {
  LR: '📦 Lorry Receipt (LR)',
  INVOICE: '🧾 Invoice',
  TOLL: '🛣️ Toll Receipt',
  WEIGHMENT: '⚖️ Weighment Slip',
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

  const [partyNamesText, setPartyNamesText] = useState(
    (ed?.partyNames ?? []).join('\n')
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (field: keyof ReviewPayload, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePartyNamesChange = (val: string) => {
    setPartyNamesText(val);
    const names = val.split('\n').map((s) => s.trim()).filter(Boolean);
    setForm((prev) => ({ ...prev, partyNames: names }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      const saved = await documentsApi.review(document.id, form);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const confidence = ed?.confidence ?? null;
  const imageUrl = document.mimeType.startsWith('image/') ? `/uploads/${document.filePath}` : null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Review Extracted Data</h2>
          <p style={styles.sub}>{document.originalFilename}</p>
        </div>
        {confidence !== null && (
          <div style={{ ...styles.confidence, color: CONFIDENCE_COLOR(confidence) }}>
            {Math.round(confidence * 100)}% confidence
          </div>
        )}
      </div>

      <div style={styles.layout}>
        {/* Left: image preview */}
        {imageUrl && (
          <div style={styles.previewPane}>
            <img src={imageUrl} alt="Document" style={styles.img} />
          </div>
        )}

        {/* Right: form */}
        <div style={styles.formPane}>
          {/* Document Type */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Document Type</label>
            <select
              style={styles.select}
              value={form.documentType}
              onChange={(e) => handleChange('documentType', e.target.value)}
            >
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>

          <div style={styles.grid}>
            <Field label="LR Number" value={form.lrNo ?? ''} onChange={(v) => handleChange('lrNo', v)} />
            <Field label="Invoice Number" value={form.invoiceNo ?? ''} onChange={(v) => handleChange('invoiceNo', v)} />
            <Field
              label="Vehicle Number"
              value={form.vehicleNo ?? ''}
              onChange={(v) => handleChange('vehicleNo', v)}
              placeholder="e.g. MH12AB1234"
            />
            <Field label="Date (YYYY-MM-DD)" value={form.date ?? ''} onChange={(v) => handleChange('date', v)} placeholder="YYYY-MM-DD" />
            <Field label="Quantity" value={form.quantity ?? ''} onChange={(v) => handleChange('quantity', v)} placeholder="e.g. 10 MT" />
            <Field label="Toll Amount" value={form.tollAmount ?? ''} onChange={(v) => handleChange('tollAmount', v)} />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Weight Info</label>
            <input
              style={styles.input}
              value={form.weightInfo ?? ''}
              onChange={(e) => handleChange('weightInfo', e.target.value)}
              placeholder="e.g. Gross: 15000 kg, Tare: 5000 kg, Net: 10000 kg"
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Party Names (one per line)</label>
            <textarea
              style={styles.textarea}
              value={partyNamesText}
              onChange={(e) => handlePartyNamesChange(e.target.value)}
              rows={3}
              placeholder="Consignor name&#10;Consignee name"
            />
          </div>

          {/* Linked group info */}
          {document.groupId && (
            <div style={styles.groupBadge}>
              🔗 Linked to group: <strong>{document.groupId.slice(0, 8)}…</strong>
              {document.group && (
                <span> · {document.group.vehicleNo} on {document.group.date}
                  {document.group.documents && ` · ${document.group.documents.length} doc(s)`}
                </span>
              )}
            </div>
          )}

          {error && <p style={styles.error}>{error}</p>}

          <div style={styles.actions}>
            <button style={styles.btnPrimary} onClick={handleSave} disabled={saving}>
              {saving ? '💾 Saving…' : '✅ Save & Confirm'}
            </button>
            <button style={styles.btnSecondary} onClick={onCancel} disabled={saving}>
              ← Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div style={styles.fieldGroup}>
      <label style={styles.label}>{label}</label>
      <input
        style={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '—'}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 960, margin: '0 auto', padding: 24 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 700, color: '#1a1a2e', marginBottom: 2 },
  sub: { fontSize: 13, color: '#888' },
  confidence: { fontWeight: 700, fontSize: 16, border: '2px solid currentColor', borderRadius: 20, padding: '4px 12px' },
  layout: { display: 'flex', gap: 24, flexWrap: 'wrap' },
  previewPane: { flex: '0 0 280px', maxWidth: 280 },
  img: { width: '100%', borderRadius: 8, border: '1px solid #ddd', objectFit: 'contain', maxHeight: 480 },
  formPane: { flex: '1 1 400px' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' },
  fieldGroup: { marginBottom: 14 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #d0d0e0', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' },
  select: { width: '100%', padding: '8px 10px', border: '1px solid #d0d0e0', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' },
  textarea: { width: '100%', padding: '8px 10px', border: '1px solid #d0d0e0', borderRadius: 6, fontSize: 14, resize: 'vertical', boxSizing: 'border-box' },
  groupBadge: { background: '#eef0ff', border: '1px solid #c0c8ff', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#4361ee', marginBottom: 14 },
  error: { color: '#e53e3e', fontSize: 13, marginBottom: 8 },
  actions: { display: 'flex', gap: 8, marginTop: 8 },
  btnPrimary: {
    padding: '10px 20px', background: '#4361ee', color: '#fff', border: 'none',
    borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14,
  },
  btnSecondary: {
    padding: '10px 16px', background: '#eee', color: '#444', border: 'none',
    borderRadius: 6, cursor: 'pointer', fontSize: 14,
  },
};
