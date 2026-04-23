import React, { useState, useEffect, useCallback } from 'react';
import type { DispatchLog, DispatchChannel, DispatchStatus } from '../types';
import { dispatchApi } from '../services/api';

const CHANNEL_ICONS: Record<DispatchChannel, string> = {
  EMAIL: '📧',
  WHATSAPP: '💬',
};

const STATUS_COLORS: Record<DispatchStatus, string> = {
  PENDING: '#f59e0b',
  SENT: '#22c55e',
  FAILED: '#ef4444',
};

const STATUS_LABELS: Record<DispatchStatus, string> = {
  PENDING: 'Pending',
  SENT: '✅ Sent',
  FAILED: '❌ Failed',
};

export function DispatchHistory() {
  const [logs, setLogs] = useState<DispatchLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await dispatchApi.listLogs({ page: p, limit: 20 });
      setLogs(res.logs);
      setTotal(res.total);
      setPages(res.pages);
      setPage(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dispatch history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(1); }, [load]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.title}>📬 Dispatch History</h2>
          <p style={styles.subtitle}>
            {loading ? 'Loading…' : `${total} dispatch record${total !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button style={styles.refreshBtn} onClick={() => void load(page)} disabled={loading}>
          🔄 Refresh
        </button>
      </div>

      {error && <p style={styles.error}>⚠️ {error}</p>}

      {!loading && logs.length === 0 && !error && (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>📭</div>
          <p>No dispatch records yet.</p>
          <p style={styles.emptySub}>
            Send a bundle via Email or WhatsApp to see the history here.
          </p>
        </div>
      )}

      {logs.length > 0 && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Channel</th>
                <th style={styles.th}>Vehicle / Date</th>
                <th style={styles.th}>Recipient</th>
                <th style={styles.th}>CC</th>
                <th style={styles.th}>Recipient Type</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Sent At</th>
                <th style={styles.th}>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <React.Fragment key={log.id}>
                  <tr
                    style={{
                      ...styles.tr,
                      ...(log.status === 'FAILED' ? styles.trFailed : {}),
                    }}
                  >
                    <td style={styles.td}>
                      <span style={styles.channelBadge}>
                        {CHANNEL_ICONS[log.channel]} {log.channel}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <strong>{log.bundle?.group.vehicleNo ?? '—'}</strong>
                      <br />
                      <span style={styles.dateStr}>{log.bundle?.group.date ?? '—'}</span>
                    </td>
                    <td style={styles.td}>{log.recipient}</td>
                    <td style={styles.td}>{log.ccRecipient ?? '—'}</td>
                    <td style={styles.td}>
                      <span style={styles.recipientType}>
                        {log.bundle?.recipientType ?? '—'}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.statusBadge,
                          background: STATUS_COLORS[log.status] + '22',
                          color: STATUS_COLORS[log.status],
                        }}
                      >
                        {STATUS_LABELS[log.status]}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={styles.timestamp}>
                        {new Date(log.sentAt).toLocaleString('en-IN', {
                          dateStyle: 'medium', timeStyle: 'short',
                        })}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <button
                        style={styles.expandBtn}
                        onClick={() => toggleExpand(log.id)}
                      >
                        {expandedId === log.id ? '▲' : '▼'}
                      </button>
                    </td>
                  </tr>

                  {expandedId === log.id && (
                    <tr style={styles.expandedRow}>
                      <td colSpan={8} style={styles.expandedCell}>
                        <div style={styles.expandedContent}>
                          <div style={styles.expandedSection}>
                            <strong>Message:</strong>
                            <pre style={styles.messagePreview}>
                              {log.message || '(no message recorded)'}
                            </pre>
                          </div>
                          {log.status === 'FAILED' && log.errorMsg && (
                            <div style={styles.errorSection}>
                              <strong>Error:</strong> {log.errorMsg}
                            </div>
                          )}
                          <div style={styles.logIdRow}>
                            Log ID: <span style={styles.logId}>{log.id}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div style={styles.pagination}>
          <button
            style={styles.pageBtn}
            onClick={() => void load(page - 1)}
            disabled={page <= 1 || loading}
          >
            ← Prev
          </button>
          <span style={styles.pageInfo}>Page {page} of {pages}</span>
          <button
            style={styles.pageBtn}
            onClick={() => void load(page + 1)}
            disabled={page >= pages || loading}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '0 24px' },

  headerRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20,
  },
  title: { margin: 0, fontSize: 22, fontWeight: 800, color: '#1a1a2e' },
  subtitle: { margin: '4px 0 0', fontSize: 13, color: '#888' },
  refreshBtn: {
    padding: '8px 16px', background: '#eef0ff', color: '#4361ee',
    border: '1px solid #c0c8ff', borderRadius: 8, cursor: 'pointer',
    fontWeight: 600, fontSize: 13,
  },

  error: { color: '#e53e3e', fontSize: 13, marginBottom: 12 },

  empty: { textAlign: 'center', padding: '40px 0', color: '#555' },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptySub: { fontSize: 13, color: '#888' },

  tableWrap: {
    overflowX: 'auto', background: '#fff', borderRadius: 10,
    boxShadow: '0 1px 6px rgba(0,0,0,0.07)', border: '1px solid #e8e8f0',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    padding: '10px 12px', background: '#f5f6ff', color: '#555',
    fontWeight: 700, textAlign: 'left', borderBottom: '1px solid #e8e8f0',
    whiteSpace: 'nowrap',
  },
  tr: { borderBottom: '1px solid #f0f0f8' },
  trFailed: { background: '#fff5f5' },
  td: { padding: '9px 12px', color: '#333', verticalAlign: 'middle' },

  channelBadge: { fontWeight: 600 },
  dateStr: { fontSize: 11, color: '#888' },
  recipientType: { fontWeight: 600, color: '#4361ee', fontSize: 12 },
  statusBadge: {
    padding: '2px 8px', borderRadius: 8,
    fontSize: 11, fontWeight: 600,
  },
  timestamp: { fontSize: 12, color: '#666' },

  expandBtn: {
    background: 'none', border: '1px solid #e0e0f0', borderRadius: 4,
    cursor: 'pointer', padding: '2px 8px', fontSize: 11, color: '#666',
  },

  expandedRow: { background: '#fafafe' },
  expandedCell: { padding: '0 12px 12px' },
  expandedContent: { borderLeft: '3px solid #4361ee', paddingLeft: 12, marginTop: 8 },
  expandedSection: { marginBottom: 8 },
  messagePreview: {
    margin: '6px 0 0', background: '#f0f0f8', border: '1px solid #e0e0f0',
    borderRadius: 6, padding: '8px 10px', fontSize: 12,
    whiteSpace: 'pre-wrap', fontFamily: 'monospace',
  },
  errorSection: {
    color: '#e53e3e', fontSize: 12, background: '#fff5f5',
    border: '1px solid #fed7d7', borderRadius: 6, padding: '6px 10px',
    marginBottom: 6,
  },
  logIdRow: { fontSize: 11, color: '#aaa', marginTop: 6 },
  logId: { fontFamily: 'monospace' },

  pagination: {
    display: 'flex', alignItems: 'center', gap: 12,
    justifyContent: 'center', marginTop: 16, fontSize: 13,
  },
  pageBtn: {
    padding: '6px 14px', background: '#eef0ff', color: '#4361ee',
    border: '1px solid #c0c8ff', borderRadius: 6, cursor: 'pointer',
    fontWeight: 600,
  },
  pageInfo: { color: '#555' },
};
