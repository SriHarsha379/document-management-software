import React, { useState, useEffect, useCallback } from 'react';
import type {
  DocumentGroup, DocumentType, RecipientType, DispatchChannel, Bundle,
} from '../types';
import { documentsApi, bundlesApi, dispatchApi } from '../services/api';

interface Props {
  onBundleSaved?: (bundle: Bundle) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RECIPIENT_TYPES: RecipientType[] = ['ACCOUNTS', 'PARTY', 'TRANSPORTER'];

const RECIPIENT_LABELS: Record<RecipientType, string> = {
  ACCOUNTS: '📊 Accounts',
  PARTY: '🤝 Party',
  TRANSPORTER: '🚛 Transporter',
};

const RECIPIENT_DESCRIPTIONS: Record<RecipientType, string> = {
  ACCOUNTS: 'Invoice, E-Way Bill, LR, Weighment, Toll, Receiving',
  PARTY: 'Invoice, LR, Receiving, Weighment',
  TRANSPORTER: 'LR, Invoice, Weighment, Toll',
};

const TYPE_LABELS: Record<DocumentType, string> = {
  LR: 'LR',
  INVOICE: 'Invoice',
  TOLL: 'Toll',
  WEIGHMENT: 'Weighment',
  WEIGHMENT_PARTY: 'Party Wt.',
  WEIGHMENT_SITE: 'Site Wt.',
  EWAYBILL: 'E-Way Bill',
  RECEIVING: 'Receiving',
  UNKNOWN: 'Unknown',
};

const TYPE_COLORS: Record<DocumentType, string> = {
  LR: '#4361ee',
  INVOICE: '#06b6d4',
  TOLL: '#f59e0b',
  WEIGHMENT: '#8b5cf6',
  WEIGHMENT_PARTY: '#7c3aed',
  WEIGHMENT_SITE: '#a855f7',
  EWAYBILL: '#10b981',
  RECEIVING: '#ec4899',
  UNKNOWN: '#9ca3af',
};

// Ordered column definitions for the table
const TABLE_COL_TYPES: DocumentType[] = [
  'LR', 'INVOICE', 'WEIGHMENT_PARTY', 'WEIGHMENT_SITE', 'TOLL', 'EWAYBILL', 'RECEIVING',
];

const CHANNEL_INFO: Record<DispatchChannel, { icon: string; label: string; placeholder: string }> = {
  EMAIL:    { icon: '📧', label: 'Email',    placeholder: 'recipient@company.com' },
  WHATSAPP: { icon: '💬', label: 'WhatsApp', placeholder: '+919876543210' },
};

// ── QuickSendModal ─────────────────────────────────────────────────────────────
// Opens when the user clicks "Send" on a table row. Handles recipient-type
// selection, channel selection, address entry, and the full
// preview → bundle create → dispatch pipeline.

interface QuickSendModalProps {
  group: DocumentGroup;
  onClose: () => void;
  onSent?: (bundle: Bundle) => void;
}

function QuickSendModal({ group, onClose, onSent }: QuickSendModalProps) {
  const [recipientType, setRecipientType] = useState<RecipientType | ''>('');
  const [channel, setChannel] = useState<DispatchChannel>('EMAIL');
  const [recipient, setRecipient] = useState('');
  const [ccRecipient, setCcRecipient] = useState('');
  const [step, setStep] = useState<'setup' | 'sending' | 'done'>('setup');
  const [result, setResult] = useState<{ success: boolean; error?: string; logId?: string } | null>(null);

  const handleSend = async () => {
    if (!recipientType || !recipient.trim()) return;
    setStep('sending');
    try {
      // 1. Get auto-selected document IDs via preview
      const preview = await bundlesApi.preview(group.id, recipientType);
      const docIds = preview.autoSelectedDocuments.map((d) => d.documentId);

      // 2. Create the bundle
      const bundle = await bundlesApi.create({
        groupId: group.id,
        recipientType,
        documentIds: docIds,
      });

      // 3. Dispatch
      const res = await dispatchApi.send({
        bundleId: bundle.id,
        channel,
        recipient: recipient.trim(),
        ccRecipient: ccRecipient.trim() || undefined,
      });

      setResult({ success: res.success, logId: res.logId, error: res.error });
      onSent?.(bundle);
    } catch (err) {
      setResult({ success: false, error: err instanceof Error ? err.message : 'Send failed' });
    } finally {
      setStep('done');
    }
  };

  const canSend = !!recipientType && !!recipient.trim();
  const info = CHANNEL_INFO[channel];

  return (
    <div style={qs.backdrop} onClick={onClose}>
      <div style={qs.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={qs.header}>
          <div>
            <h2 style={qs.title}>📤 Send Documents</h2>
            <p style={qs.subtitle}>
              🚛 <strong>{group.vehicleNo}</strong> &nbsp;·&nbsp; 📅 {group.date}
            </p>
          </div>
          <button style={qs.closeBtn} onClick={onClose}>✕</button>
        </div>

        {step === 'setup' && (
          <>
            {/* Recipient type */}
            <div style={qs.section}>
              <label style={qs.sLabel}>Send to</label>
              <div style={qs.recipientRow}>
                {RECIPIENT_TYPES.map((rt) => (
                  <button
                    key={rt}
                    style={{ ...qs.rtBtn, ...(recipientType === rt ? qs.rtBtnActive : {}) }}
                    onClick={() => setRecipientType(rt)}
                  >
                    <span style={qs.rtBtnTitle}>{RECIPIENT_LABELS[rt]}</span>
                    <span style={qs.rtBtnDesc}>{RECIPIENT_DESCRIPTIONS[rt]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Channel */}
            <div style={qs.section}>
              <label style={qs.sLabel}>Send via</label>
              <div style={{ display: 'flex', gap: 10 }}>
                {(['EMAIL', 'WHATSAPP'] as DispatchChannel[]).map((ch) => (
                  <button
                    key={ch}
                    style={{ ...qs.chBtn, ...(channel === ch ? qs.chBtnActive : {}) }}
                    onClick={() => setChannel(ch)}
                  >
                    {CHANNEL_INFO[ch].icon} {CHANNEL_INFO[ch].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Recipient address */}
            <div style={qs.section}>
              <label style={qs.sLabel}>{info.icon} Recipient {info.label}</label>
              <input
                style={qs.input}
                type={channel === 'EMAIL' ? 'email' : 'tel'}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder={info.placeholder}
                autoFocus
              />
            </div>

            {/* Optional CC */}
            <div style={qs.section}>
              <label style={qs.sLabel}>CC (optional)</label>
              <input
                style={qs.input}
                type={channel === 'EMAIL' ? 'email' : 'tel'}
                value={ccRecipient}
                onChange={(e) => setCcRecipient(e.target.value)}
                placeholder={channel === 'EMAIL' ? 'accounts@company.com' : '+910000000000'}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button style={qs.cancelBtn} onClick={onClose}>Cancel</button>
              <button
                style={{ ...qs.sendBtn, ...(!canSend ? qs.sendBtnDisabled : {}) }}
                onClick={() => { void handleSend(); }}
                disabled={!canSend}
              >
                {info.icon} Send via {info.label}
              </button>
            </div>
          </>
        )}

        {step === 'sending' && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⏳</div>
            <p style={{ fontSize: 17, fontWeight: 700, color: '#1a1a2e', margin: '0 0 6px' }}>
              Sending via {info.label}…
            </p>
            <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
              Building bundle and dispatching documents.
            </p>
          </div>
        )}

        {step === 'done' && result && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            {result.success ? (
              <>
                <div style={{ fontSize: 52 }}>✅</div>
                <p style={{ fontSize: 17, fontWeight: 700, color: '#1a1a2e', margin: '12px 0 6px' }}>
                  Sent successfully!
                </p>
                <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
                  Documents dispatched to <strong>{recipient}</strong>
                  {ccRecipient ? ` (CC: ${ccRecipient})` : ''} via {info.label}.
                </p>
                {result.logId && (
                  <div style={{ marginTop: 8, fontSize: 11, color: '#aaa', fontFamily: 'monospace' }}>
                    Log ID: {result.logId}
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: 52 }}>❌</div>
                <p style={{ fontSize: 17, fontWeight: 700, color: '#1a1a2e', margin: '12px 0 6px' }}>
                  Send failed
                </p>
                <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>{result.error}</p>
              </>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
              <button style={qs.sendBtn} onClick={onClose}>Close</button>
              {!result.success && (
                <button style={qs.cancelBtn} onClick={() => { setStep('setup'); setResult(null); }}>
                  Try again
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── DocumentBundler ────────────────────────────────────────────────────────────

export function DocumentBundler({ onBundleSaved }: Props) {
  const [groups, setGroups] = useState<DocumentGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<{ groupId: string; type: DocumentType } | null>(null);

  // The group for which the QuickSendModal is open (null = closed)
  const [sendGroup, setSendGroup] = useState<DocumentGroup | null>(null);

  const refreshGroups = useCallback(() => {
    documentsApi.listGroups()
      .then((g) => setGroups(g))
      .catch(() => {/* ignore */});
  }, []);

  useEffect(() => {
    setGroupsLoading(true);
    documentsApi.listGroups()
      .then((g) => setGroups(g))
      .catch(() => setGroups([]))
      .finally(() => setGroupsLoading(false));
  }, []);

  const handleAddDoc = useCallback(async (groupId: string, type: DocumentType, file: File) => {
    setUploadingSlot({ groupId, type });
    setUploadError(null);
    try {
      await documentsApi.upload(file, { type, groupId });
      refreshGroups();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingSlot(null);
    }
  }, [refreshGroups]);

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>📦 Document Bundles</h2>
      <p style={styles.subtitle}>
        Each row is a vehicle trip. Click{' '}
        <strong>📤 Send</strong> to bundle and dispatch documents via Email or WhatsApp.
      </p>

      {uploadError && (
        <p style={styles.error}>Upload failed: {uploadError}</p>
      )}

      {groupsLoading && <p style={styles.loading}>Loading groups…</p>}

      {!groupsLoading && groups.length === 0 && (
        <p style={styles.empty}>
          No document groups found. Upload and link documents to create a group.
        </p>
      )}

      {!groupsLoading && groups.length > 0 && (
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={{ ...styles.th, ...styles.thFixed, minWidth: 110 }}>Vehicle No.</th>
                <th style={{ ...styles.th, ...styles.thFixed, minWidth: 90 }}>Date</th>
                {TABLE_COL_TYPES.map((t) => (
                  <th key={t} style={{ ...styles.th, minWidth: 90 }}>
                    <span style={{ ...styles.colBadge, background: TYPE_COLORS[t] }}>
                      {TYPE_LABELS[t]}
                    </span>
                  </th>
                ))}
                <th style={{ ...styles.th, minWidth: 90 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, rowIdx) => {
                const docTypeSet = new Set((g.documents ?? []).map((d) => d.type));
                const rowBg = rowIdx % 2 === 0 ? '#fff' : '#f8f9ff';
                return (
                  <tr key={g.id} style={{ background: rowBg }}>
                    {/* Vehicle No */}
                    <td style={{ ...styles.td, fontWeight: 700, color: '#1a1a2e' }}>
                      🚛 {g.vehicleNo}
                    </td>
                    {/* Date */}
                    <td style={{ ...styles.td, color: '#555', fontSize: 12 }}>
                      {g.date}
                    </td>
                    {/* Doc type cells */}
                    {TABLE_COL_TYPES.map((colType) => {
                      const exists =
                        docTypeSet.has(colType) ||
                        (colType === 'WEIGHMENT_PARTY' && docTypeSet.has('WEIGHMENT'));
                      const isUploading =
                        uploadingSlot?.groupId === g.id && uploadingSlot?.type === colType;
                      return (
                        <td key={colType} style={{ ...styles.td, textAlign: 'center' }}>
                          {exists ? (
                            <span style={{ ...styles.presentBadge, background: TYPE_COLORS[colType] }}>
                              ✓
                            </span>
                          ) : isUploading ? (
                            <span style={styles.uploadingCell}>⏳</span>
                          ) : (
                            <label style={styles.addCell} title={`Upload ${TYPE_LABELS[colType]}`}>
                              <input
                                type="file"
                                accept="image/*,application/pdf"
                                style={{ display: 'none' }}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) void handleAddDoc(g.id, colType, f);
                                  e.target.value = '';
                                }}
                              />
                              ➕
                            </label>
                          )}
                        </td>
                      );
                    })}
                    {/* Send button */}
                    <td style={{ ...styles.td, textAlign: 'center' }}>
                      <button
                        style={styles.sendBtn}
                        onClick={() => setSendGroup(g)}
                      >
                        📤 Send
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Quick-send modal */}
      {sendGroup && (
        <QuickSendModal
          group={sendGroup}
          onClose={() => setSendGroup(null)}
          onSent={(bundle) => {
            onBundleSaved?.(bundle);
            setSendGroup(null);
          }}
        />
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: '100%', padding: 0 },
  title: { fontSize: 22, fontWeight: 700, color: '#1a1a2e', marginBottom: 4, marginTop: 0 },
  subtitle: { fontSize: 14, color: '#555', marginBottom: 16, marginTop: 0 },
  error: { color: '#e53e3e', fontSize: 13, marginBottom: 8, padding: '8px 12px', background: '#fff5f5', borderRadius: 6 },
  loading: { color: '#888', fontStyle: 'italic', fontSize: 14 },
  empty: { color: '#888', fontSize: 14 },

  tableWrapper: {
    overflowX: 'auto',
    borderRadius: 10,
    border: '1.5px solid #e0e0f0',
    boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    padding: '10px 12px',
    background: '#f0f3ff',
    color: '#333',
    fontWeight: 700,
    textAlign: 'center',
    borderBottom: '2px solid #d8dcf8',
    whiteSpace: 'nowrap',
  },
  thFixed: {
    textAlign: 'left',
  },
  colBadge: {
    color: '#fff',
    padding: '2px 8px',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 700,
    display: 'inline-block',
  },
  td: {
    padding: '9px 12px',
    borderBottom: '1px solid #eef0f8',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
  },
  presentBadge: {
    color: '#fff',
    padding: '3px 10px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 700,
    display: 'inline-block',
  },
  uploadingCell: {
    fontSize: 14,
    color: '#888',
  },
  addCell: {
    fontSize: 16,
    cursor: 'pointer',
    display: 'inline-block',
    opacity: 0.5,
    transition: 'opacity 0.15s',
  },
  sendBtn: {
    padding: '6px 14px',
    background: '#4361ee',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 13,
    boxShadow: '0 1px 4px rgba(67,97,238,0.25)',
    whiteSpace: 'nowrap',
  },
};

// QuickSendModal styles
const qs: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 16,
  },
  modal: {
    background: '#fff', borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
    width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', padding: 28,
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 },
  title: { margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: '#1a1a2e' },
  subtitle: { margin: 0, fontSize: 13, color: '#6b7280' },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9ca3af', lineHeight: 1 },
  section: { marginBottom: 18 },
  sLabel: { display: 'block', fontWeight: 700, fontSize: 13, color: '#555', marginBottom: 8 },
  recipientRow: { display: 'flex', gap: 8 },
  rtBtn: {
    flex: 1, padding: '10px 8px', border: '2px solid #e0e0f0', borderRadius: 9,
    cursor: 'pointer', background: '#f8f8ff', textAlign: 'center',
    display: 'flex', flexDirection: 'column', gap: 4, transition: 'all 0.15s',
  },
  rtBtnActive: { border: '2px solid #4361ee', background: '#eef0ff' },
  rtBtnTitle: { fontSize: 13, fontWeight: 700, color: '#1a1a2e' },
  rtBtnDesc: { fontSize: 10, color: '#888', lineHeight: 1.3 },
  chBtn: {
    flex: 1, padding: '10px 0', border: '2px solid #e0e0f0', borderRadius: 9,
    cursor: 'pointer', fontSize: 14, fontWeight: 600, background: '#f8f8ff',
    color: '#555', transition: 'all 0.15s',
  },
  chBtnActive: { border: '2px solid #4361ee', background: '#eef0ff', color: '#4361ee' },
  input: {
    width: '100%', padding: '10px 12px', border: '1.5px solid #d0d0e0',
    borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box',
    color: '#1a1a2e', fontFamily: 'inherit',
  },
  cancelBtn: {
    padding: '10px 20px', border: '1.5px solid #d0d0e0', borderRadius: 8,
    background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#555',
  },
  sendBtn: {
    padding: '10px 24px', background: '#4361ee', color: '#fff', border: 'none',
    borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700,
    boxShadow: '0 2px 8px rgba(67,97,238,0.3)',
  },
  sendBtnDisabled: { background: '#9ca3af', cursor: 'not-allowed', boxShadow: 'none' },
};
