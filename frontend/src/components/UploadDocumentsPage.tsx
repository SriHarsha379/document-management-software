import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Document, DocumentGroup, DocumentType, Lr, LrDocumentCategory } from '../types';
import { documentsApi, lrApi } from '../services/api';
import { useCurrentUser, PERM } from '../contexts/UserContext';
import { DocumentExtractionSummary } from './DocumentExtractionSummary';

const PAGE_SIZE = 10;

const SLOT_CONFIG: Array<{ type: DocumentType; category: LrDocumentCategory; label: string }> = [
  { type: 'INVOICE', category: 'ACKNOWLEDGED_INVOICE', label: 'Tax Invoice' },
  { type: 'LR', category: 'LR_GENERATED', label: 'Lorry Receipt' },
  { type: 'WEIGHMENT_PARTY', category: 'DEPOT_PLANT_WEIGHMENT_SLIP', label: 'Party Weighment Slip' },
  { type: 'WEIGHMENT_SITE', category: 'SITE_WEIGHMENT_SLIP', label: 'Site Weighment Slip' },
  { type: 'TOLL', category: 'TOLL_RECEIPT', label: 'Tollgate' },
  { type: 'EWAYBILL', category: 'ADDITIONAL_ATTACHMENT_1', label: 'E-Way Bill' },
  { type: 'RECEIVING', category: 'ACKNOWLEDGED_LR_COPY', label: 'Receiving Copy' },
];

type ModalState =
  | { type: 'documents'; lr: Lr }
  | { type: 'send'; lr: Lr }
  | null;

export function UploadDocumentsPage() {
  const { hasPermission } = useCurrentUser();
  const canUpload = hasPermission(PERM.DOCUMENT_UPLOAD);
  const canDelete = hasPermission(PERM.DOCUMENT_DELETE);
  const canSend = hasPermission(PERM.COMMUNICATION_SEND);

  const [rows, setRows] = useState<Lr[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [groupsByKey, setGroupsByKey] = useState<Record<string, DocumentGroup>>({});
  const [modal, setModal] = useState<ModalState>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    let ignore = false;
    const run = async () => {
      setLoading(true);
      try {
        const result = await lrApi.list({
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
          q: search || undefined,
        });
        if (!ignore) {
          setRows(result.data);
          setTotal(result.total);
        }
      } catch (err) {
        if (!ignore) {
          setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load LR records' });
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void run();
    return () => { ignore = true; };
  }, [page, search, refreshKey]);

  useEffect(() => {
    let ignore = false;
    const run = async () => {
      try {
        const groups = await documentsApi.listGroups();
        if (!ignore) {
          setGroupsByKey(Object.fromEntries(groups.map((group) => [getGroupKey(group.vehicleNo, group.date), group])));
        }
      } catch {
        if (!ignore) setGroupsByKey({});
      }
    };
    void run();
    return () => { ignore = true; };
  }, [refreshKey]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const triggerRefresh = () => setRefreshKey((value) => value + 1);

  const getRowDocuments = (lr: Lr) => {
    const all = new Map<string, Document>();
    for (const document of lr.uploadedDocuments ?? []) all.set(document.id, document);
    const group = groupsByKey[getGroupKey(lr.vehicleNo, lr.lrDate ?? lr.date)];
    for (const document of group?.documents ?? []) {
      if (!all.has(document.id)) all.set(document.id, document);
    }
    return Array.from(all.values());
  };

  const handleUpload = async (
    lrId: string,
    slot: { type: DocumentType; category: LrDocumentCategory; label: string },
    file: File | null,
  ) => {
    if (!file) return;
    const key = `${lrId}:${slot.type}`;
    setUploadingKey(key);
    setMessage(null);
    try {
      await lrApi.uploadDocument(lrId, slot.category, file);
      setMessage({ type: 'success', text: `${slot.label} uploaded successfully.` });
      triggerRefresh();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Upload failed' });
    } finally {
      setUploadingKey(null);
      const refKey = `${lrId}-${slot.type}`;
      if (inputRefs.current[refKey]) inputRefs.current[refKey]!.value = '';
    }
  };

  return (
    <div>
      <div style={card}>
        <div style={toolbar}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#1a1a2e' }}>Upload Documents</h2>
            <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>
              Upload, review, view, and send LR-related documents stored in the DMS.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setPage(1);
                  setSearch(searchInput.trim());
                }
              }}
              placeholder="Search LR No, invoice, vehicle..."
              style={searchInputStyle}
            />
            <button
              style={primaryBtn}
              onClick={() => {
                setPage(1);
                setSearch(searchInput.trim());
              }}
            >
              Search
            </button>
          </div>
        </div>

        {message && (
          <div style={message.type === 'success' ? successAlert : errorAlert}>
            {message.text}
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1400 }}>
            <thead>
              <tr>
                <th style={th}>LR Number</th>
                <th style={th}>Date</th>
                {SLOT_CONFIG.map((slot) => (
                  <th key={slot.type} style={th}>{slot.label}</th>
                ))}
                <th style={th}>View Documents</th>
                <th style={th}>Send</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={SLOT_CONFIG.length + 4} style={{ ...td, textAlign: 'center', padding: 28, color: '#6b7280' }}>
                    Loading records...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={SLOT_CONFIG.length + 4} style={{ ...td, textAlign: 'center', padding: 28, color: '#6b7280' }}>
                    No LR records found.
                  </td>
                </tr>
              ) : rows.map((lr) => (
                <tr key={lr.id} style={{ borderBottom: '1px solid #eef0ff' }}>
                  <td style={{ ...td, fontWeight: 700 }}>{lr.lrNo}</td>
                  <td style={td}>{lr.lrDate ?? lr.date ?? '—'}</td>
                  {SLOT_CONFIG.map((slot) => {
                    const docs = getRowDocuments(lr).filter((document) => matchesSlot(document, slot.type));
                    const inputKey = `${lr.id}-${slot.type}`;
                    const busy = uploadingKey === `${lr.id}:${slot.type}`;
                    return (
                      <td key={slot.type} style={{ ...td, minWidth: 150 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                          <span style={docs.length > 0 ? presentBadge : missingBadge}>
                            {docs.length > 0 ? `${docs.length} uploaded` : 'Not uploaded'}
                          </span>
                          {canUpload && (
                            <>
                              <input
                                ref={(element) => { inputRefs.current[inputKey] = element; }}
                                type="file"
                                accept=".pdf,.png,.jpg,.jpeg,.webp,.gif"
                                style={{ display: 'none' }}
                                onChange={(e) => { void handleUpload(lr.id, slot, e.target.files?.[0] ?? null); }}
                              />
                              <button
                                style={secondaryBtn}
                                disabled={busy}
                                onClick={() => inputRefs.current[inputKey]?.click()}
                              >
                                {busy ? 'Uploading…' : docs.length > 0 ? 'Add More' : 'Upload'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td style={td}>
                    <button style={secondaryBtn} onClick={() => setModal({ type: 'documents', lr })}>
                      View
                    </button>
                  </td>
                  <td style={td}>
                    <button
                      style={primaryBtn}
                      disabled={!canSend}
                      onClick={() => setModal({ type: 'send', lr })}
                    >
                      Send
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 18, alignItems: 'center' }}>
            <button style={secondaryBtn} disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Prev</button>
            <span style={{ fontSize: 13, color: '#6b7280' }}>Page {page} of {pages}</span>
            <button style={secondaryBtn} disabled={page === pages} onClick={() => setPage((value) => value + 1)}>Next</button>
          </div>
        )}
      </div>

      {modal?.type === 'documents' && (
        <DocumentsModal
          lr={modal.lr}
          canDelete={canDelete}
          onClose={() => setModal(null)}
          onDeleteSuccess={() => {
            triggerRefresh();
          }}
          onError={(text) => setMessage({ type: 'error', text })}
        />
      )}

      {modal?.type === 'send' && (
        <SendEmailModal
          lr={modal.lr}
          onClose={() => setModal(null)}
          onSuccess={(text) => {
            setMessage({ type: 'success', text });
            setModal(null);
          }}
          onError={(text) => setMessage({ type: 'error', text })}
        />
      )}
    </div>
  );
}

function DocumentsModal({
  lr,
  canDelete,
  onClose,
  onDeleteSuccess,
  onError,
}: {
  lr: Lr;
  canDelete: boolean;
  onClose: () => void;
  onDeleteSuccess: () => void;
  onError: (text: string) => void;
}) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await lrApi.listDocuments(lr.id);
      setDocuments(result.documents);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [lr.id]);

  const groupedDocuments = useMemo(
    () => SLOT_CONFIG.flatMap((slot) =>
      documents
        .filter((document) => matchesSlot(document, slot.type))
        .map((document) => ({ document, categoryLabel: slot.label }))
    ),
    [documents]
  );

  const handleDelete = async (document: Document) => {
    if (!window.confirm(`Delete ${document.originalFilename}?`)) return;
    setDeletingId(document.id);
    try {
      if (document.lrId === lr.id && document.lrDocumentCategory) {
        await lrApi.deleteDocument(lr.id, document.id);
      } else {
        await documentsApi.delete(document.id);
      }
      await load();
      onDeleteSuccess();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete document');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <ModalShell title={`Documents for LR ${lr.lrNo}`} onClose={onClose}>
      {loading ? (
        <p style={modalHint}>Loading documents...</p>
      ) : groupedDocuments.length === 0 ? (
        <p style={modalHint}>No uploaded documents found for this LR.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={th}>Document Name</th>
                <th style={th}>Extracted Fields</th>
                <th style={th}>Uploaded Date</th>
                <th style={th}>Uploaded By</th>
                <th style={th}>View</th>
                {canDelete && <th style={th}>Delete</th>}
              </tr>
            </thead>
            <tbody>
              {groupedDocuments.map(({ document, categoryLabel }) => (
                <tr key={document.id} style={{ borderBottom: '1px solid #eef0ff' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 700 }}>{categoryLabel}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{document.originalFilename}</div>
                  </td>
                  <td style={{ ...td, minWidth: 260 }}>
                    <DocumentExtractionSummary document={document} compact />
                  </td>
                  <td style={td}>{new Date(document.uploadedAt).toLocaleString()}</td>
                  <td style={td}>{document.uploadedBy?.name ?? '—'}</td>
                  <td style={td}>
                    <a href={`/uploads/${document.filePath}`} target="_blank" rel="noreferrer" style={linkBtn}>
                      View
                    </a>
                  </td>
                  {canDelete && (
                    <td style={td}>
                      <button style={dangerBtn} disabled={deletingId === document.id} onClick={() => { void handleDelete(document); }}>
                        {deletingId === document.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ModalShell>
  );
}

function SendEmailModal({
  lr,
  onClose,
  onSuccess,
  onError,
}: {
  lr: Lr;
  onClose: () => void;
  onSuccess: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [toInput, setToInput] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [bccInput, setBccInput] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ type: string; label: string; value: string; sourceName: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [documentCount, setDocumentCount] = useState(0);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoading(true);
      try {
        const result = await lrApi.listDocuments(lr.id);
        if (ignore) return;
        setSuggestions(result.recipientSuggestions.suggestions);
        setToInput(result.recipientSuggestions.suggestedTo.join(', '));
        setDocumentCount(result.documents.length);
      } catch (err) {
        if (!ignore) onError(err instanceof Error ? err.message : 'Failed to load email details');
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void load();
    return () => { ignore = true; };
  }, [lr.id, onError]);

  const handleSend = async () => {
    setSending(true);
    try {
      await lrApi.sendDocumentsEmail(lr.id, {
        to: parseEmailInput(toInput),
        cc: parseEmailInput(ccInput),
        bcc: parseEmailInput(bccInput),
      });
      onSuccess(`Documents sent successfully for LR ${lr.lrNo}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  return (
    <ModalShell title={`Send Documents for LR ${lr.lrNo}`} onClose={onClose}>
      {loading ? (
        <p style={modalHint}>Loading recipient suggestions...</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={infoBox}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Attached documents</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>{documentCount} uploaded document(s) will be attached.</div>
          </div>

          {suggestions.length > 0 && (
            <div style={infoBox}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Suggested recipients</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {suggestions.map((suggestion) => (
                  <div key={`${suggestion.type}-${suggestion.value}`} style={{ fontSize: 13, color: '#4b5563' }}>
                    {suggestion.label}: <strong>{suggestion.value}</strong> <span style={{ color: '#9ca3af' }}>({suggestion.sourceName})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <label style={fieldWrap}>
            <span style={fieldLabel}>To</span>
            <textarea value={toInput} onChange={(e) => setToInput(e.target.value)} rows={3} style={textArea} />
          </label>
          <label style={fieldWrap}>
            <span style={fieldLabel}>CC</span>
            <textarea value={ccInput} onChange={(e) => setCcInput(e.target.value)} rows={2} style={textArea} />
          </label>
          <label style={fieldWrap}>
            <span style={fieldLabel}>BCC</span>
            <textarea value={bccInput} onChange={(e) => setBccInput(e.target.value)} rows={2} style={textArea} />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button style={secondaryBtn} onClick={onClose}>Cancel</button>
            <button style={primaryBtn} disabled={sending || parseEmailInput(toInput).length === 0} onClick={() => { void handleSend(); }}>
              {sending ? 'Sending…' : 'Send Email'}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#1a1a2e' }}>{title}</h3>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9ca3af' }} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function parseEmailInput(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getGroupKey(vehicleNo: string | null | undefined, date: string | null | undefined) {
  const normalizedVehicle = vehicleNo?.trim().toUpperCase().replace(/\s+/g, '') || '';
  const normalizedDate = date?.trim() || '';
  return `${normalizedVehicle}::${normalizedDate}`;
}

function matchesSlot(document: Document, slotType: DocumentType) {
  if (slotType === 'WEIGHMENT_PARTY') {
    return document.type === 'WEIGHMENT_PARTY' || document.type === 'WEIGHMENT';
  }
  return document.type === slotType;
}

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 14,
  border: '1px solid #e0e0f0',
  padding: 20,
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
};

const toolbar: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  alignItems: 'center',
  flexWrap: 'wrap',
  marginBottom: 18,
};

const searchInputStyle: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 13,
  minWidth: 260,
};

const th: CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 11,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  background: '#f8f9ff',
  borderBottom: '1px solid #e0e0f0',
};

const td: CSSProperties = {
  padding: '12px',
  fontSize: 13,
  color: '#1f2937',
  verticalAlign: 'top',
};

const primaryBtn: CSSProperties = {
  border: 'none',
  borderRadius: 8,
  background: '#4361ee',
  color: '#fff',
  padding: '9px 14px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};

const secondaryBtn: CSSProperties = {
  border: '1px solid #c7d2fe',
  borderRadius: 8,
  background: '#eef2ff',
  color: '#4338ca',
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

const dangerBtn: CSSProperties = {
  border: 'none',
  borderRadius: 8,
  background: '#ef4444',
  color: '#fff',
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

const presentBadge: CSSProperties = {
  display: 'inline-block',
  background: '#dcfce7',
  color: '#166534',
  borderRadius: 999,
  padding: '3px 8px',
  fontSize: 11,
  fontWeight: 700,
};

const missingBadge: CSSProperties = {
  display: 'inline-block',
  background: '#fef2f2',
  color: '#b91c1c',
  borderRadius: 999,
  padding: '3px 8px',
  fontSize: 11,
  fontWeight: 700,
};

const successAlert: CSSProperties = {
  background: '#ecfdf5',
  border: '1px solid #a7f3d0',
  color: '#166534',
  borderRadius: 10,
  padding: '10px 12px',
  marginBottom: 14,
  fontSize: 13,
};

const errorAlert: CSSProperties = {
  background: '#fef2f2',
  border: '1px solid #fecaca',
  color: '#b91c1c',
  borderRadius: 10,
  padding: '10px 12px',
  marginBottom: 14,
  fontSize: 13,
};

const modalBackdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(17,24,39,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  zIndex: 1000,
};

const modalCard: CSSProperties = {
  width: '100%',
  maxWidth: 920,
  maxHeight: '90vh',
  overflowY: 'auto',
  background: '#fff',
  borderRadius: 16,
  padding: 20,
  boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
};

const modalHint: CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: '#6b7280',
};

const linkBtn: CSSProperties = {
  color: '#4338ca',
  textDecoration: 'none',
  fontWeight: 700,
};

const infoBox: CSSProperties = {
  background: '#f8f9ff',
  border: '1px solid #e0e7ff',
  borderRadius: 10,
  padding: 12,
};

const fieldWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const fieldLabel: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: '#374151',
};

const textArea: CSSProperties = {
  width: '100%',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
  resize: 'vertical',
  boxSizing: 'border-box',
};
