import React, { useEffect, useState, useCallback } from 'react';
import type { Document, DocumentType, DocumentStatus } from '../types';
import { documentsApi } from '../services/api';

interface Props {
  onSelect: (doc: Document) => void;
  refreshTrigger?: number;
}

const TYPE_COLORS: Record<DocumentType, string> = {
  LR: '#4361ee',
  INVOICE: '#06b6d4',
  TOLL: '#f59e0b',
  WEIGHMENT: '#8b5cf6',
  EWAYBILL: '#10b981',
  RECEIVING: '#ec4899',
  UNKNOWN: '#9ca3af',
};

const STATUS_COLORS: Record<DocumentStatus, string> = {
  PENDING_OCR: '#f59e0b',
  PENDING_REVIEW: '#3b82f6',
  REVIEWED: '#8b5cf6',
  SAVED: '#22c55e',
};

const STATUS_LABELS: Record<DocumentStatus, string> = {
  PENDING_OCR: 'Pending OCR',
  PENDING_REVIEW: 'Needs Review',
  REVIEWED: 'Reviewed',
  SAVED: '✅ Saved',
};

export function DocumentList({ onSelect, refreshTrigger }: Props) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterVehicle, setFilterVehicle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const LIMIT = 15;

  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await documentsApi.list({
        type: filterType as DocumentType || undefined,
        status: filterStatus as DocumentStatus || undefined,
        vehicleNo: filterVehicle || undefined,
        page,
        limit: LIMIT,
      });
      setDocuments(result.documents);
      setTotal(result.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [filterType, filterStatus, filterVehicle, page]);

  const handleDelete = useCallback(async (doc: Document) => {
    if (!window.confirm(`Delete "${doc.originalFilename}"? This cannot be undone.`)) return;
    setDeletingId(doc.id);
    try {
      await documentsApi.delete(doc.id);
      await fetchDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete document');
    } finally {
      setDeletingId(null);
    }
  }, [fetchDocuments]);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments, refreshTrigger]);

  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Documents ({total})</h2>
        <button style={styles.btnRefresh} onClick={() => void fetchDocuments()} disabled={loading}>
          🔄 Refresh
        </button>
      </div>

      {/* Filters */}
      <div style={styles.filters}>
        <select style={styles.filter} value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(1); }}>
          <option value="">All Types</option>
          <option value="LR">LR</option>
          <option value="INVOICE">Invoice</option>
          <option value="TOLL">Toll</option>
          <option value="WEIGHMENT">Weighment</option>
          <option value="EWAYBILL">E-Way Bill</option>
          <option value="RECEIVING">Receiving Copy</option>
          <option value="UNKNOWN">Unknown</option>
        </select>
        <select style={styles.filter} value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          <option value="PENDING_OCR">Pending OCR</option>
          <option value="PENDING_REVIEW">Needs Review</option>
          <option value="SAVED">Saved</option>
        </select>
        <input
          style={styles.filter}
          placeholder="Vehicle No…"
          value={filterVehicle}
          onChange={(e) => { setFilterVehicle(e.target.value); setPage(1); }}
        />
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {loading && <p style={styles.loading}>Loading…</p>}

      {!loading && documents.length === 0 && (
        <div style={styles.empty}>
          <p>No documents found.</p>
        </div>
      )}

      {documents.length > 0 && (
        <div style={styles.table}>
          <div style={styles.tableHeader}>
            <span>File</span>
            <span>Type</span>
            <span>Vehicle No</span>
            <span>Date</span>
            <span>Status</span>
            <span>Group</span>
            <span></span>
            <span></span>
          </div>
          {documents.map((doc) => (
            <div key={doc.id} style={styles.row}>
              <span style={styles.filename} title={doc.originalFilename}>
                {doc.originalFilename.length > 28
                  ? doc.originalFilename.slice(0, 26) + '…'
                  : doc.originalFilename}
              </span>
              <span>
                <span style={{ ...styles.badge, background: TYPE_COLORS[doc.type] }}>
                  {doc.type}
                </span>
              </span>
              <span style={styles.mono}>{doc.extractedData?.vehicleNo ?? '—'}</span>
              <span>{doc.extractedData?.date ?? '—'}</span>
              <span>
                <span style={{ ...styles.statusBadge, color: STATUS_COLORS[doc.status] }}>
                  {STATUS_LABELS[doc.status]}
                </span>
              </span>
              <span style={{ fontSize: 12, color: '#888' }}>
                {doc.groupId ? '🔗 Linked' : '—'}
              </span>
              <span>
                <button style={styles.btnView} onClick={() => onSelect(doc)}>
                  {doc.status === 'PENDING_REVIEW' ? '✏️ Review' : '👁 View'}
                </button>
              </span>
              <span>
                <button
                  style={styles.btnDelete}
                  onClick={() => void handleDelete(doc)}
                  disabled={deletingId === doc.id}
                >
                  {deletingId === doc.id ? '…' : '🗑 Delete'}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div style={styles.pagination}>
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} style={styles.pageBtn}>
            ← Prev
          </button>
          <span style={styles.pageInfo}>Page {page} / {pages}</span>
          <button disabled={page === pages} onClick={() => setPage((p) => p + 1)} style={styles.pageBtn}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '0 24px 24px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: 700, color: '#1a1a2e' },
  btnRefresh: {
    padding: '6px 14px', background: '#f0f0f0', border: 'none',
    borderRadius: 6, cursor: 'pointer', fontSize: 13,
  },
  filters: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  filter: { padding: '7px 10px', border: '1px solid #d0d0e0', borderRadius: 6, fontSize: 13, background: '#fff' },
  error: { color: '#e53e3e', fontSize: 13 },
  loading: { color: '#888', fontSize: 14, fontStyle: 'italic' },
  empty: { textAlign: 'center', padding: 40, color: '#888' },
  table: { border: '1px solid #e0e0f0', borderRadius: 8, overflow: 'hidden' },
  tableHeader: {
    display: 'grid', gridTemplateColumns: '2fr 90px 120px 110px 130px 80px 80px 90px',
    background: '#f5f6ff', padding: '10px 12px', fontSize: 12, fontWeight: 700,
    color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', gap: 8,
  },
  row: {
    display: 'grid', gridTemplateColumns: '2fr 90px 120px 110px 130px 80px 80px 90px',
    padding: '10px 12px', borderTop: '1px solid #eee', alignItems: 'center',
    fontSize: 13, gap: 8, background: '#fff',
  },
  filename: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  badge: { color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 },
  statusBadge: { fontWeight: 600, fontSize: 12 },
  mono: { fontFamily: 'monospace', fontSize: 13 },
  btnView: {
    padding: '4px 10px', background: '#4361ee', color: '#fff', border: 'none',
    borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600,
  },
  btnDelete: {
    padding: '4px 10px', background: '#ef4444', color: '#fff', border: 'none',
    borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600,
  },
  pagination: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, justifyContent: 'center' },
  pageBtn: {
    padding: '6px 14px', background: '#eee', border: 'none', borderRadius: 6,
    cursor: 'pointer', fontSize: 13,
  },
  pageInfo: { fontSize: 13, color: '#555' },
};
