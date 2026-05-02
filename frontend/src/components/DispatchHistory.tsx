import React, { useState, useEffect, useCallback } from 'react';
import type { DispatchLog, DispatchChannel, DispatchStatus } from '../types';
import { dispatchApi } from '../services/api';

const CHANNEL_ICONS: Record<DispatchChannel, string> = { EMAIL: '📧', WHATSAPP: '💬' };

const STATUS_COLORS: Record<DispatchStatus, string> = {
  PENDING: '#f59e0b', SENT: '#22c55e', FAILED: '#ef4444',
};

const STATUS_LABELS: Record<DispatchStatus, string> = {
  PENDING: 'Pending', SENT: 'Sent', FAILED: 'Failed',
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
    setLoading(true); setError(null);
    try {
      const res = await dispatchApi.listLogs({ page: p, limit: 20 });
      setLogs(res.logs); setTotal(res.total); setPages(res.pages); setPage(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dispatch history');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(1); }, [load]);

  return (
    <div>
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', padding: '20px', marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>📬 Dispatch History</h2>
          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
            {loading ? 'Loading…' : `${total} dispatch record${total !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button style={btnRefresh} onClick={() => void load(page)} disabled={loading}>🔄 Refresh</button>
      </div>

      {error && <div style={errorBox}>⚠️ {error}</div>}

      {!loading && logs.length === 0 && !error && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', padding: '48px 24px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
          <p style={{ margin: '0 0 4px', fontWeight: 500, color: '#555' }}>No dispatch records yet.</p>
          <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>Send a bundle via Email or WhatsApp to see the history here.</p>
        </div>
      )}

      {logs.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Channel', 'Vehicle / Date', 'Recipient', 'CC', 'Type', 'Status', 'Sent At', ''].map((h) => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <React.Fragment key={log.id}>
                    <tr style={{ borderBottom: '1px solid #f0f0f8', background: log.status === 'FAILED' ? '#fef2f2' : '#fff', transition: 'background 0.1s' }}
                      onMouseEnter={(e) => { if (log.status !== 'FAILED') (e.currentTarget as HTMLTableRowElement).style.background = '#fafafe'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = log.status === 'FAILED' ? '#fef2f2' : '#fff'; }}
                    >
                      <td style={td}>
                        <span style={{ fontWeight: 600 }}>{CHANNEL_ICONS[log.channel]} {log.channel}</span>
                      </td>
                      <td style={td}>
                        <strong>{log.bundle?.group.vehicleNo ?? '—'}</strong>
                        <br /><span style={{ fontSize: 11, color: '#9ca3af' }}>{log.bundle?.group.date ?? '—'}</span>
                      </td>
                      <td style={td}>{log.recipient}</td>
                      <td style={td}>{log.ccRecipient ?? '—'}</td>
                      <td style={td}>
                        <span style={{ fontWeight: 600, color: '#4361ee', fontSize: 12 }}>{log.bundle?.recipientType ?? '—'}</span>
                      </td>
                      <td style={td}>
                        <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: STATUS_COLORS[log.status] + '22', color: STATUS_COLORS[log.status] }}>
                          {log.status === 'SENT' ? '✅ ' : log.status === 'FAILED' ? '❌ ' : ''}{STATUS_LABELS[log.status]}
                        </span>
                      </td>
                      <td style={{ ...td, fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
                        {new Date(log.sentAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </td>
                      <td style={td}>
                        <button
                          style={{ background: 'none', border: '1px solid #e0e0f0', borderRadius: 5, cursor: 'pointer', padding: '3px 10px', fontSize: 11, color: '#555', transition: 'background 0.1s' }}
                          onClick={() => setExpandedId((prev) => (prev === log.id ? null : log.id))}
                        >
                          {expandedId === log.id ? '▲' : '▼'}
                        </button>
                      </td>
                    </tr>

                    {expandedId === log.id && (
                      <tr style={{ background: '#fafafe' }}>
                        <td colSpan={8} style={{ padding: '4px 16px 16px' }}>
                          <div style={{ borderLeft: '3px solid #4361ee', paddingLeft: 14, marginTop: 8 }}>
                            <div style={{ marginBottom: 8 }}>
                              <strong style={{ fontSize: 12, color: '#555' }}>Message:</strong>
                              <pre style={{ margin: '6px 0 0', background: '#f0f0f8', border: '1px solid #e0e0f0', borderRadius: 6, padding: '8px 10px', fontSize: 12, whiteSpace: 'pre-wrap', fontFamily: 'monospace', color: '#333' }}>
                                {log.message || '(no message recorded)'}
                              </pre>
                            </div>
                            {log.status === 'FAILED' && log.errorMsg && (
                              <div style={{ color: '#b91c1c', fontSize: 12, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '6px 10px', marginBottom: 6 }}>
                                <strong>Error:</strong> {log.errorMsg}
                              </div>
                            )}
                            <div style={{ fontSize: 11, color: '#aaa', marginTop: 6 }}>Log ID: <span style={{ fontFamily: 'monospace' }}>{log.id}</span></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, justifyContent: 'center' }}>
          <button style={pageBtn} onClick={() => void load(page - 1)} disabled={page <= 1 || loading}>← Prev</button>
          <span style={{ fontSize: 13, color: '#555' }}>Page {page} of {pages}</span>
          <button style={pageBtn} onClick={() => void load(page + 1)} disabled={page >= pages || loading}>Next →</button>
        </div>
      )}
    </div>
  );
}

const btnRefresh: React.CSSProperties = { padding: '6px 14px', background: '#eef0ff', color: '#4361ee', border: '1px solid #c0c8ff', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: 13 };
const errorBox: React.CSSProperties = { background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', color: '#b91c1c', fontSize: 13, marginBottom: 12 };
const th: React.CSSProperties = { padding: '10px 12px', background: '#f5f6ff', color: '#555', fontWeight: 700, fontSize: 11, textAlign: 'left', borderBottom: '1px solid #e0e0f0', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.05em' };
const td: React.CSSProperties = { padding: '10px 12px', color: '#333', verticalAlign: 'middle' };
const pageBtn: React.CSSProperties = { padding: '6px 14px', background: '#eef0ff', border: '1px solid #c0c8ff', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#4361ee', fontWeight: 500 };
