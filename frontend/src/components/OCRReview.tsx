import React, { useState } from 'react';
import type { Document, DocumentType, ReviewPayload } from '../types';
import { documentsApi } from '../services/api';
import { ImagePreviewModal } from './ImagePreviewModal';
import { DOCUMENT_TYPE_LABELS, PREVIEW_TYPE_ORDER } from '../constants/documentTypeLabels';

interface Props {
  document: Document;
  /** All documents from the current upload session, used for the preview carousel. */
  allDocs?: Document[];
  onSaved: (doc: Document) => void;
  /** Switch the active review form when a different page is selected. */
  onSelectDocument?: (doc: Document) => void;
  onCancel: () => void;
}

const DOCUMENT_TYPES: DocumentType[] = ['LR', 'INVOICE', 'TOLL', 'WEIGHMENT', 'WEIGHMENT_PARTY', 'WEIGHMENT_SITE', 'EWAYBILL', 'RECEIVING', 'UNKNOWN'];
const WEIGHMENT_TYPES: DocumentType[] = ['WEIGHMENT', 'WEIGHMENT_PARTY', 'WEIGHMENT_SITE'];
/** Types where we split parties into Bill To / Ship To instead of a free-text list */
const PARTY_SPLIT_TYPES: DocumentType[] = ['LR', 'INVOICE'];
/** Types where Weight Info is meaningful */
const WEIGHT_INFO_TYPES: DocumentType[] = ['TOLL', 'EWAYBILL', 'RECEIVING', 'UNKNOWN'];

const TYPE_LABELS: Record<DocumentType, string> = {
  LR: '📦 Lorry Receipt (LR)',
  INVOICE: '🧾 Invoice',
  TOLL: '🛣️ Toll Gate Slip',
  WEIGHMENT: '⚖️ Weighment Slip',
  WEIGHMENT_PARTY: '⚖️ Party Weighment Slip',
  WEIGHMENT_SITE: '⚖️ Site Weighment Slip',
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

function sortDocsByType(docs: Document[]): Document[] {
  return [...docs].sort((a, b) => {
    const ai = PREVIEW_TYPE_ORDER.indexOf(a.type);
    const bi = PREVIEW_TYPE_ORDER.indexOf(b.type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

export function OCRReview({ document, allDocs, onSaved, onSelectDocument, onCancel }: Props) {
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
    billToParty: ed?.billToParty ?? '',
    shipToParty: ed?.shipToParty ?? '',
    driverName: ed?.driverName ?? '',
    driverCellNo: ed?.driverCellNo ?? '',
    source: ed?.source ?? '',
  });

  const [partyNamesText, setPartyNamesText] = useState((ed?.partyNames ?? []).join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTypeOverride, setShowTypeOverride] = useState(false);

  // ── Preview carousel state ──────────────────────────────────────────────────
  const previewDocs: Document[] = sortDocsByType(
    allDocs && allDocs.length > 0 ? allDocs : [document],
  );
  const defaultPreviewIdx = Math.max(0, previewDocs.findIndex((d) => d.id === document.id));
  const [previewIdx, setPreviewIdx] = useState(defaultPreviewIdx);
  const [showModal, setShowModal] = useState(false);

  const clampedIdx = previewDocs.length > 0 ? Math.max(0, Math.min(previewIdx, previewDocs.length - 1)) : 0;
  const previewDoc = previewDocs[clampedIdx] ?? document;
  const previewUrl = previewDoc.mimeType.startsWith('image/') ? `/uploads/${previewDoc.filePath}` : null;
  const previewIsPdf = previewDoc.mimeType === 'application/pdf';

  const selectPreviewDocument = (index: number) => {
    const nextIndex = Math.max(0, Math.min(index, previewDocs.length - 1));
    const nextDocument = previewDocs[nextIndex];
    if (!nextDocument) return;
    setPreviewIdx(nextIndex);
    if (nextDocument.id !== document.id) onSelectDocument?.(nextDocument);
  };

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
  const classificationConfidence = ed?.classificationConfidence ?? confidence;
  const ocrConfidence = ed?.ocrConfidence ?? confidence;
  const processingNotes = ed?.processingNotes ?? [];
  const validationIssues = ed?.validationIssues ?? [];

  return (
    <div>
      {/* Header */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', padding: '20px 24px', marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: '#1a1a2e' }}>Review Extracted Data</h2>
          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>{document.originalFilename}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {classificationConfidence !== null && (
            <div style={{ fontWeight: 700, fontSize: 14, border: '2px solid currentColor', borderRadius: 20, padding: '5px 14px', color: CONFIDENCE_COLOR(classificationConfidence) }}>
              Type {Math.round(classificationConfidence * 100)}%
            </div>
          )}
          {ocrConfidence !== null && (
            <div style={{ fontWeight: 700, fontSize: 14, border: '2px solid currentColor', borderRadius: 20, padding: '5px 14px', color: CONFIDENCE_COLOR(ocrConfidence) }}>
              OCR {Math.round(ocrConfidence * 100)}%
            </div>
          )}
          {ed?.imageQuality && (
            <div style={{ fontWeight: 700, fontSize: 13, borderRadius: 20, padding: '7px 14px', background: ed.imageQuality === 'LOW' ? '#fff1f2' : ed.imageQuality === 'MEDIUM' ? '#fff7ed' : '#ecfdf5', color: ed.imageQuality === 'LOW' ? '#be123c' : ed.imageQuality === 'MEDIUM' ? '#c2410c' : '#166534' }}>
              {ed.imageQuality} quality
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* ── Preview carousel ───────────────────────────────────────────────── */}
        <div style={{ flex: '0 0 280px', background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', padding: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Position label */}
          <div style={{ fontSize: 12, fontWeight: 700, color: '#4361ee', textAlign: 'center', padding: '4px 0' }}>
            {DOCUMENT_TYPE_LABELS[previewDoc.type]}{' '}
            <span style={{ color: '#6b7280', fontWeight: 500 }}>{clampedIdx + 1} of {previewDocs.length}</span>
          </div>

          {/* Image / PDF preview — clickable */}
          <div
            title="Click to view full size"
            style={{ cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: '1px solid #e0e0f0', position: 'relative', background: '#f0f0f5', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setShowModal(true)}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={previewDoc.originalFilename}
                style={{ width: '100%', objectFit: 'contain', maxHeight: 400, display: 'block' }}
              />
            ) : previewIsPdf ? (
              <div style={{ textAlign: 'center', padding: 24, color: '#6b7280' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>PDF Document</div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Click to view</div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 24, color: '#6b7280' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>📎</div>
                <div style={{ fontSize: 12 }}>{previewDoc.originalFilename}</div>
              </div>
            )}
            {/* Zoom hint overlay */}
            <div style={{ position: 'absolute', bottom: 6, right: 6, background: 'rgba(0,0,0,0.45)', color: '#fff', borderRadius: 5, fontSize: 10, padding: '2px 6px', pointerEvents: 'none' }}>
              🔍 Click to enlarge
            </div>
          </div>

          {/* Prev / Next navigation */}
          {previewDocs.length > 1 && (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
              <button
                style={navBtn}
                disabled={clampedIdx === 0}
                onClick={() => selectPreviewDocument(clampedIdx - 1)}
              >
                ‹ Prev
              </button>
              <button
                style={navBtn}
                disabled={clampedIdx === previewDocs.length - 1}
                onClick={() => selectPreviewDocument(clampedIdx + 1)}
              >
                Next ›
              </button>
            </div>
          )}

          {/* Thumbnail strip for 2–8 docs */}
          {previewDocs.length > 1 && previewDocs.length <= 8 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 }}>
              {previewDocs.map((d, idx) => {
                const thumbUrl = d.mimeType.startsWith('image/') ? `/uploads/${d.filePath}` : null;
                const isActive = idx === clampedIdx;
                return (
                  <div
                    key={d.id}
                    onClick={() => selectPreviewDocument(idx)}
                    title={DOCUMENT_TYPE_LABELS[d.type]}
                    style={{
                      width: 40, height: 40, borderRadius: 5, overflow: 'hidden',
                      cursor: 'pointer', flexShrink: 0,
                      border: isActive ? '2px solid #4361ee' : '2px solid #e0e0f0',
                      background: '#f0f0f5',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {thumbUrl ? (
                      <img src={thumbUrl} alt={d.originalFilename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: 16 }}>📄</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Form */}
        <div style={{ flex: '1 1 400px', background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          {(processingNotes.length > 0 || validationIssues.length > 0 || ed?.appliedRotation) && (
            <div style={{ background: '#f8faff', border: '1px solid #dbe4ff', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#334155', marginBottom: 16, lineHeight: 1.6 }}>
              {ed?.appliedRotation ? <div><strong>Rotation applied:</strong> {ed.appliedRotation}°</div> : null}
              {processingNotes.length > 0 ? <div><strong>OCR handling:</strong> {processingNotes.join(' • ')}</div> : null}
              {validationIssues.length > 0 ? <div><strong>Review flags:</strong> {validationIssues.join(' • ')}</div> : null}
            </div>
          )}

          {(!form.vehicleNo || !form.date) && (
            <div style={{ background: '#fff8f0', border: '1.5px solid #e97a00', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#7a3f00', marginBottom: 16, lineHeight: 1.5 }}>
              ⚠️ <strong>Action needed:</strong>{' '}
              {[!form.vehicleNo && 'Vehicle Number', !form.date && 'Date'].filter(Boolean).join(' and ')}{' '}
              {(!form.vehicleNo && !form.date) ? 'are' : 'is'} missing.
            </div>
          )}

          <div style={fieldGroup}>
            <label style={labelStyle}>Document Type</label>
            {showTypeOverride ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select style={{ ...inputStyle, flex: 1 }} value={form.documentType} onChange={(e) => handleChange('documentType', e.target.value)}>
                  {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => setShowTypeOverride(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap', padding: '0 4px' }}
                >
                  ✕ Cancel
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 14px', background: '#eef0ff', border: '1.5px solid #c0c8ff', borderRadius: 20, fontSize: 13, fontWeight: 700, color: '#4361ee' }}>
                  {form.documentType ? TYPE_LABELS[form.documentType] : '❓ Unknown'}
                  <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 500, color: '#7c8cf8', opacity: 0.85 }}>auto-detected</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowTypeOverride(true)}
                  style={{ background: 'none', border: '1px solid #d0d0e0', cursor: 'pointer', fontSize: 12, color: '#6b7280', borderRadius: 6, padding: '4px 10px', transition: 'border-color 0.15s' }}
                >
                  ✏️ Change
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Field label="LR Number" value={form.lrNo ?? ''} onChange={(v) => handleChange('lrNo', v)} />
            <Field label="Invoice Number" value={form.invoiceNo ?? ''} onChange={(v) => handleChange('invoiceNo', v)} />
            <Field label="Vehicle Number ✱" value={form.vehicleNo ?? ''} onChange={(v) => handleChange('vehicleNo', v)} placeholder="e.g. MH12AB1234" highlight={!form.vehicleNo} />
            <Field label="Date (YYYY-MM-DD) ✱" value={form.date ?? ''} onChange={(v) => handleChange('date', v)} placeholder="YYYY-MM-DD" highlight={!form.date} />
            <Field label="Quantity" value={form.quantity ?? ''} onChange={(v) => handleChange('quantity', v)} placeholder="e.g. 10 MT" />
            {form.documentType === 'LR' && (
              <>
                <Field label="Driver Name" value={form.driverName ?? ''} onChange={(v) => handleChange('driverName', v)} placeholder="e.g. MADHU" />
                <Field label="Driver Cell No." value={form.driverCellNo ?? ''} onChange={(v) => handleChange('driverCellNo', v)} placeholder="e.g. 6281121317" />
              </>
            )}
            {form.documentType === 'INVOICE' && (
              <Field label="Source" value={form.source ?? ''} onChange={(v) => handleChange('source', v)} placeholder="e.g. DRONAGIRI" />
            )}
          </div>

          {form.documentType && WEIGHT_INFO_TYPES.includes(form.documentType) && (
          <div style={fieldGroup}>
            <label style={labelStyle}>Weight Info</label>
            <input style={inputStyle} value={form.weightInfo ?? ''} onChange={(e) => handleChange('weightInfo', e.target.value)} placeholder="Gross: 15000 kg, Tare: 5000 kg, Net: 10000 kg" />
          </div>
          )}

          {form.documentType && PARTY_SPLIT_TYPES.includes(form.documentType) ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <Field label="Bill To Party" value={form.billToParty ?? ''} onChange={(v) => handleChange('billToParty', v)} placeholder="e.g. R N P INFRACON PVT LTD" />
              <Field label="Ship To Party" value={form.shipToParty ?? ''} onChange={(v) => handleChange('shipToParty', v)} placeholder="e.g. SITE / DELIVERY ADDRESS" />
            </div>
          ) : !form.documentType || !WEIGHMENT_TYPES.includes(form.documentType) ? (
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
          ) : null}

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
              {saving ? '💾 Saving…' : '✅ Save & Review Next'}
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

      {/* Full-screen image viewer */}
      {showModal && (
        <ImagePreviewModal
          docs={previewDocs}
          header={`${DOCUMENT_TYPE_LABELS[previewDoc.type]} – ${previewDoc.originalFilename}`}
          initialIndex={clampedIdx}
          onClose={() => setShowModal(false)}
        />
      )}
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

const navBtn: React.CSSProperties = {
  flex: 1, padding: '5px 10px', border: '1.5px solid #d0d0e0', borderRadius: 6,
  background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#4361ee',
};
const fieldGroup: React.CSSProperties = { marginBottom: 14 };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #d0d0e0', borderRadius: 7, fontSize: 14, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit', color: '#1a1a2e', transition: 'border-color 0.15s, box-shadow 0.15s' };
