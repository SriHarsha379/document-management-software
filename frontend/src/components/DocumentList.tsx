import React, { useEffect, useState, useCallback } from 'react';
import type { Lr } from '../types';
import { lrApi } from '../services/api';
import { LrTable } from './LrTable';

interface Props {
  onSelect?: (lr: Lr) => void;
  refreshTrigger?: number;
}

export function DocumentList({ refreshTrigger }: Props) {
  const [lrs, setLrs] = useState<Lr[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterQ, setFilterQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');

  const LIMIT = 20;

  const fetchLrs = useCallback(async (q: string, pg: number) => {
    try {
      setLoading(true); setError(null);
      const offset = (pg - 1) * LIMIT;
      const result = await lrApi.list({ q: q || undefined, limit: LIMIT, offset });
      setLrs(result.data);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load LR records');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchLrs(appliedQ, page); }, [fetchLrs, appliedQ, page, refreshTrigger]);

  const handleSearch = () => {
    setAppliedQ(filterQ);
    setPage(1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleClear = () => {
    setFilterQ('');
    setAppliedQ('');
    setPage(1);
  };

  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div>
      {/* Header + filters */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', padding: '16px 20px', marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>LR Records ({total})</h2>
          <button style={btnRefresh} onClick={() => void fetchLrs(appliedQ, page)} disabled={loading}>🔄 Refresh</button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flex: 1, minWidth: 200, gap: 0, border: '1.5px solid #d0d0e0', borderRadius: 7, overflow: 'hidden' }}>
            <input
              style={{ flex: 1, padding: '7px 10px', border: 'none', outline: 'none', fontSize: 13, color: '#1a1a2e', background: '#fff' }}
              placeholder="Search LR No, Vehicle, Party, Transporter…"
              value={filterQ}
              onChange={(e) => setFilterQ(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {filterQ && (
              <button
                style={{ padding: '0 10px', background: '#f5f6ff', border: 'none', cursor: 'pointer', color: '#888', fontSize: 13 }}
                onClick={handleClear}
              >✕</button>
            )}
          </div>
          <button style={btnSearch} onClick={handleSearch} disabled={loading}>🔍 Search</button>
        </div>
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', color: '#b91c1c', fontSize: 13, marginBottom: 12 }}>⚠️ {error}</div>}

      {loading && lrs.length === 0 && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', padding: 20 }}>
          {[1,2,3,4,5].map((i) => (
            <div key={i} style={{ height: 40, borderRadius: 6, background: 'linear-gradient(90deg,#e0e0f0 25%,#eef0ff 50%,#e0e0f0 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite', marginBottom: 8 }} />
          ))}
        </div>
      )}

      {!loading && lrs.length === 0 && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', padding: '48px 24px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
          <p style={{ color: '#6b7280', margin: 0, fontWeight: 500 }}>No LR records found.</p>
          <p style={{ color: '#9ca3af', margin: '6px 0 0', fontSize: 13 }}>Try adjusting your search or clearing filters.</p>
        </div>
      )}

      {lrs.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <LrTable
            lrs={lrs}
            onLrUpdated={(updated) => setLrs((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))}
          />
        </div>
      )}

      {pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, justifyContent: 'center' }}>
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} style={pageBtn}>← Prev</button>
          <span style={{ fontSize: 13, color: '#555' }}>Page {page} / {pages}</span>
          <button disabled={page === pages} onClick={() => setPage((p) => p + 1)} style={pageBtn}>Next →</button>
        </div>
      )}
    </div>
  );
}

const btnRefresh: React.CSSProperties = {
  padding: '6px 14px', background: '#f0f0f8', border: '1px solid #e0e0f0',
  borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#4361ee',
};
const btnSearch: React.CSSProperties = {
  padding: '7px 16px', background: '#4361ee', color: '#fff', border: 'none',
  borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600,
};
const pageBtn: React.CSSProperties = {
  padding: '6px 14px', background: '#eef0ff', border: '1px solid #c0c8ff',
  borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#4361ee', fontWeight: 500,
};
