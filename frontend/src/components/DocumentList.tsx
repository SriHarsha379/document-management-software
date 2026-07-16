import React, { useEffect, useState, useCallback } from 'react';
import type { Document, DocumentType, DocumentStatus, DocumentGroup } from '../types';
import { documentsApi } from '../services/api';
import { useCurrentUser, PERM } from '../contexts/UserContext';

interface Props {
  onSelect: (doc: Document) => void;
  refreshTrigger?: number;
}

const TYPE_COLORS: Record<DocumentType, string> = {
  LR: '#4361ee', INVOICE: '#06b6d4', TOLL: '#f59e0b',
  WEIGHMENT: '#8b5cf6', WEIGHMENT_PARTY: '#7c3aed', WEIGHMENT_SITE: '#6d28d9',
  EWAYBILL: '#10b981', RECEIVING: '#ec4899', UNKNOWN: '#9ca3af',
};

const STATUS_COLORS: Record<DocumentStatus, string> = {
  PENDING_OCR: '#f59e0b', PENDING_REVIEW: '#3b82f6', REVIEWED: '#8b5cf6', SAVED: '#22c55e',
};

const STATUS_LABELS: Record<DocumentStatus, string> = {
  PENDING_OCR: 'Pending OCR', PENDING_REVIEW: 'Needs Review', REVIEWED: 'Reviewed', SAVED: 'Saved',
};

export function DocumentList({ onSelect, refreshTrigger }: Props) {
  const { hasPermission } = useCurrentUser();
  const canDelete = hasPermission(PERM.DOCUMENT_DELETE);

  const [documents, setDocuments] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterVehicle, setFilterVehicle] = useState('');
  const [filterUngrouped, setFilterUngrouped] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [groupLoadingId, setGroupLoadingId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<DocumentGroup | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);

  const LIMIT = 15;

  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const result = await documentsApi.list({
        type: filterType as DocumentType || undefined,
        status: filterStatus as DocumentStatus || undefined,
        vehicleNo: filterVehicle || undefined,
        ungrouped: filterUngrouped || undefined,
        page, limit: LIMIT,
      });
      setDocuments(result.documents);
      setTotal(result.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally { setLoading(false); }
  }, [filterType, filterStatus, filterVehicle, filterUngrouped, page]);

  const handleDelete = useCallback(async (doc: Document) => {
    if (!window.confirm(`Delete "${doc.originalFilename}"? This cannot be undone.`)) return;
    setDeletingId(doc.id);
    try {
      await documentsApi.delete(doc.id);
      await fetchDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete document');
    } finally { setDeletingId(null); }
  }, [fetchDocuments]);

  const handleOpenGroup = useCallback(async (groupId: string) => {
    try {
      setGroupLoadingId(groupId);
      setGroupError(null);
      const group = await documentsApi.getGroup(groupId);
      setSelectedGroup(group);
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : 'Failed to load linked group');
    } finally {
      setGroupLoadingId(null);
    }
  }, []);

  useEffect(() => { void fetchDocuments(); }, [fetchDocuments, refreshTrigger]);

  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div>
      {/* Header + filters */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', padding: '16px 20px', marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>Documents ({total})</h2>
          <button style={btnRefresh} onClick={() => void fetchDocuments()} disabled={loading}>🔄 Refresh</button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select style={filterCtrl} value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(1); }}>
            <option value="">All Types</option>
            <option value="LR">LR</option>
            <option value="INVOICE">Invoice</option>
            <option value="TOLL">Toll</option>
            <option value="WEIGHMENT">Weighment</option>
            <option value="EWAYBILL">E-Way Bill</option>
            <option value="RECEIVING">Receiving Copy</option>
            <option value="UNKNOWN">Unknown</option>
          </select>
          <select style={filterCtrl} value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
            <option value="">All Statuses</option>
            <option value="PENDING_OCR">Pending OCR</option>
            <option value="PENDING_REVIEW">Needs Review</option>
            <option value="SAVED">Saved</option>
          </select>
          <input
            style={filterCtrl}
            placeholder="Vehicle No…"
            value={filterVehicle}
            onChange={(e) => { setFilterVehicle(e.target.value); setPage(1); }}
          />
          <label style={{ ...filterCtrl, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={filterUngrouped} onChange={(e) => { setFilterUngrouped(e.target.checked); setPage(1); }} />
            ⚠️ Ungrouped only
          </label>
        </div>
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', color: '#b91c1c', fontSize: 13, marginBottom: 12 }}>⚠️ {error}</div>}

      {loading && documents.length === 0 && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', padding: 20 }}>
          {[1,2,3,4,5].map((i) => (
            <div key={i} style={{ height: 40, borderRadius: 6, background: 'linear-gradient(90deg,#e0e0f0 25%,#eef0ff 50%,#e0e0f0 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite', marginBottom: 8 }} />
          ))}
        </div>
      )}

      {!loading && documents.length === 0 && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', padding: '48px 24px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
          <p style={{ color: '#6b7280', margin: 0, fontWeight: 500 }}>No documents found.</p>
          <p style={{ color: '#9ca3af', margin: '6px 0 0', fontSize: 13 }}>Try adjusting your filters.</p>
        </div>
      )}

      {documents.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Type</th>
                  <th style={th}>Filename</th>
                  <th style={th}>LR No</th>
                  <th style={th}>Invoice No</th>
                  <th style={th}>Vehicle No</th>
                  <th style={th}>Party</th>
                  <th style={th}>Date</th>
                  <th style={th}>Status</th>
                  <th style={th}>Group</th>
                  <th style={th}>View</th>
                  <th style={th}></th>
                  {canDelete && <th style={th}></th>}
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const ed = doc.extractedData;
                  const groupId = doc.groupId;
                  const missingVehicle = !ed?.vehicleNo;
                  const missingDate = !ed?.date;
                  const needsFix = !groupId && (missingVehicle || missingDate);
                  return (
                    <tr
                      key={doc.id}
                      style={{ borderBottom: '1px solid #f0f0f8', background: needsFix ? '#fff8f0' : '#fff', transition: 'background 0.1s', cursor: 'pointer' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = needsFix ? '#fff1e0' : '#fafafe'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = needsFix ? '#fff8f0' : '#fff'; }}
                    >
                      <td style={td}>
                        <span style={{ ...badge, background: TYPE_COLORS[doc.type] }}>{doc.type}</span>
                      </td>
                      <td style={{ ...td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.originalFilename}>
                        {doc.originalFilename.length > 26 ? doc.originalFilename.slice(0, 24) + '…' : doc.originalFilename}
                      </td>
                      <td style={td}>{ed?.lrNo ?? '—'}</td>
                      <td style={td}>{ed?.invoiceNo ?? '—'}</td>
                      <td style={{ ...td, fontFamily: 'monospace', color: missingVehicle ? '#e53e3e' : undefined }}>
                        {missingVehicle ? '⚠️ missing' : ed!.vehicleNo}
                      </td>
                      <td style={{ ...td, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ed?.partyNames ? ed.partyNames.join(', ') : '—'}
                      </td>
                      <td style={{ ...td, color: missingDate ? '#e53e3e' : undefined }}>
                        {missingDate ? '⚠️ missing' : ed!.date}
                      </td>
                      <td style={td}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                          background: STATUS_COLORS[doc.status] + '22',
                          color: STATUS_COLORS[doc.status],
                        }}>
                          {STATUS_LABELS[doc.status]}
                        </span>
                      </td>
                      <td style={td}>
                        {groupId ? (
                          <button
                            style={btnGroup}
                            onClick={(e) => { e.stopPropagation(); void handleOpenGroup(groupId); }}
                            disabled={groupLoadingId === groupId}
                          >
                            {groupLoadingId === groupId ? 'Loading…' : '🔗 Linked Group'}
                          </button>
                        ) : (
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#e53e3e' }}>⚠️ No group</span>
                        )}
                      </td>
                      <td style={td} onClick={(e) => e.stopPropagation()}>
                        <a
                          href={`/uploads/${doc.filePath}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#4361ee', fontSize: 12, fontWeight: 600, textDecoration: 'none', padding: '2px 8px', border: '1px solid #c0c8ff', borderRadius: 6, whiteSpace: 'nowrap' }}
                        >
                          👁 View
                        </a>
                      </td>
                      <td style={td}>
                        <button
                          style={needsFix ? btnFix : btnReview}
                          onClick={() => onSelect(doc)}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                        >
                          {needsFix ? '✏️ Fix' : doc.status === 'PENDING_REVIEW' ? '✏️ Review' : '✏️ Edit'}
                        </button>
                      </td>
                      {canDelete && (
                        <td style={td}>
                          <button
                            style={btnDelete}
                            onClick={(e) => { e.stopPropagation(); void handleDelete(doc); }}
                            disabled={deletingId === doc.id}
                          >
                            {deletingId === doc.id ? '…' : '🗑'}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, justifyContent: 'center' }}>
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} style={pageBtn}>← Prev</button>
          <span style={{ fontSize: 13, color: '#555' }}>Page {page} / {pages}</span>
          <button disabled={page === pages} onClick={() => setPage((p) => p + 1)} style={pageBtn}>Next →</button>
        </div>
      )}

      {groupError && (
        <div style={{ marginTop: 12, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', color: '#b91c1c', fontSize: 13 }}>
          ⚠️ {groupError}
        </div>
      )}

      {selectedGroup && (
        <div style={groupBackdrop} onClick={() => setSelectedGroup(null)}>
          <div style={groupModal} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, color: '#1a1a2e' }}>
                🔗 Linked Documents · {selectedGroup.vehicleNo} · {selectedGroup.date}
              </h3>
              <button style={groupCloseBtn} onClick={() => setSelectedGroup(null)}>✕</button>
            </div>
            <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {(selectedGroup.documents ?? []).map((linkedDoc) => (
                <div key={linkedDoc.id} style={groupDocRow}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#1a1a2e' }}>{linkedDoc.type}</div>
                    <div style={{ fontSize: 12, color: '#4b5563' }}>{linkedDoc.originalFilename}</div>
                  </div>
                  <a
                    href={`/uploads/${linkedDoc.filePath}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={groupDocLink}
                  >
                    👁 View
                  </a>
                </div>
              ))}
              {(selectedGroup.documents ?? []).length === 0 && (
                <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>No documents found in this linked group.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const filterCtrl: React.CSSProperties = {
  padding: '7px 10px', border: '1.5px solid #d0d0e0', borderRadius: 7,
  fontSize: 13, background: '#fff', outline: 'none', color: '#1a1a2e',
  transition: 'border-color 0.15s',
};
const btnRefresh: React.CSSProperties = {
  padding: '6px 14px', background: '#f0f0f8', border: '1px solid #e0e0f0',
  borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#4361ee',
};
const th: React.CSSProperties = {
  padding: '9px 10px', background: '#f5f6ff', color: '#555',
  fontWeight: 700, fontSize: 11, textAlign: 'left', borderBottom: '1px solid #e0e0f0',
  whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em',
  overflow: 'hidden', textOverflow: 'ellipsis',
};
const td: React.CSSProperties = { padding: '8px 10px', color: '#333', fontSize: 12, verticalAlign: 'middle', whiteSpace: 'nowrap' };
const badge: React.CSSProperties = { color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 };
const btnReview: React.CSSProperties = {
  padding: '3px 8px', background: '#4361ee', color: '#fff', border: 'none',
  borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600, transition: 'opacity 0.15s',
};
const btnFix: React.CSSProperties = {
  ...btnReview, background: '#e97a00',
};
const btnDelete: React.CSSProperties = {
  padding: '3px 8px', background: '#ef4444', color: '#fff', border: 'none',
  borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600,
};
const btnGroup: React.CSSProperties = {
  padding: '4px 8px', background: '#eef2ff', border: '1px solid #c7d2fe',
  color: '#3730a3', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700,
};
const pageBtn: React.CSSProperties = {
  padding: '6px 14px', background: '#eef0ff', border: '1px solid #c0c8ff',
  borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#4361ee', fontWeight: 500,
};
const groupBackdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 2000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const groupModal: React.CSSProperties = {
  width: 'min(760px, 100%)', background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb',
  boxShadow: '0 10px 30px rgba(0,0,0,0.2)', padding: 16,
};
const groupCloseBtn: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 8, border: '1px solid #e5e7eb',
  background: '#fff', cursor: 'pointer', fontWeight: 700,
};
const groupDocRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  border: '1px solid #eef2ff', borderRadius: 8, padding: '10px 12px', marginBottom: 8,
};
const groupDocLink: React.CSSProperties = {
  color: '#4361ee', fontSize: 12, fontWeight: 700, textDecoration: 'none',
  border: '1px solid #c0c8ff', borderRadius: 6, padding: '4px 10px',
};
