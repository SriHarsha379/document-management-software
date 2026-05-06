import React, { useState, useRef, useCallback } from 'react';
import type { Lr } from '../types';
import { lrApi } from '../services/api';
import { LrTable } from './LrTable';

const EXAMPLE_QUERIES = [
  'SHREE PARSHWA',
  'MH46CL9571',
  'Head Office',
  'INTERNAL',
];

export function SmartSearch() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lrs, setLrs] = useState<Lr[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hasSearched, setHasSearched] = useState(false);
  const [focused, setFocused] = useState(false);
  const [lastQuery, setLastQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const LIMIT = 50;

  const handleSearch = useCallback(async (q: string, pg = 1) => {
    setLoading(true); setError(null);
    try {
      const offset = (pg - 1) * LIMIT;
      const res = await lrApi.list({ q: q.trim() || undefined, limit: LIMIT, offset });
      setLrs(res.data); setTotal(res.total); setPage(pg); setHasSearched(true); setLastQuery(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setLrs([]); setTotal(null);
    } finally { setLoading(false); }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void handleSearch(query);
  };

  const pages = total !== null ? Math.max(1, Math.ceil(total / LIMIT)) : 1;

  return (
    <div>
      {/* Hero search section */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e0e0f0', padding: '28px 28px 20px', marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', textAlign: 'center' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: '#1a1a2e' }}>🔍 Search LR Records</h2>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6b7280' }}>
          Search across LR No, Vehicle No, Principal Company, Party, Transporter, Product, and more.
        </p>

        {/* Search bar */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 14 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#fff', border: `2px solid ${focused ? '#4361ee' : '#c0c8ff'}`,
            borderRadius: 12, padding: '10px 14px', flex: 1, maxWidth: 680,
            boxShadow: focused ? '0 0 0 3px rgba(67,97,238,0.12)' : '0 2px 12px rgba(67,97,238,0.06)',
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}>
            <span style={{ fontSize: 16, flexShrink: 0, opacity: 0.5 }}>🔍</span>
            <input
              ref={inputRef}
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, background: 'transparent', color: '#1a1a2e' }}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="e.g. SHREE PARSHWA, MH46CL9571, or leave blank to show all"
              autoComplete="off"
            />
            {query && (
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 14, padding: '0 2px' }}
                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              >
                ✕
              </button>
            )}
          </div>
          <button
            style={{
              padding: '10px 22px', background: loading ? '#a0aec0' : '#4361ee',
              color: '#fff', border: 'none', borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 700, fontSize: 15, transition: 'background 0.15s',
              boxShadow: loading ? 'none' : '0 2px 8px rgba(67,97,238,0.3)',
            }}
            onClick={() => void handleSearch(query)}
            disabled={loading}
          >
            {loading ? '⏳' : 'Search'}
          </button>
        </div>

        {/* Example chips */}
        {!hasSearched && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
            <span style={{ fontSize: 12, color: '#9ca3af', alignSelf: 'center' }}>Try: </span>
            {EXAMPLE_QUERIES.map((q) => (
              <button
                key={q}
                style={{ padding: '4px 10px', background: '#eef0ff', color: '#4361ee', border: '1px solid #c0c8ff', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 500, transition: 'background 0.1s' }}
                onClick={() => { setQuery(q); void handleSearch(q); }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#dde2ff'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#eef0ff'; }}
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

      {hasSearched && !loading && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#555' }}>
              {total === 0
                ? 'No LR records found'
                : `${total} LR record${total !== 1 ? 's' : ''} found${lastQuery ? ` for "${lastQuery}"` : ''}`}
              {total !== null && lrs.length < total && ` (showing ${(page - 1) * LIMIT + 1}–${(page - 1) * LIMIT + lrs.length})`}
            </span>
            <button style={btnRefresh} onClick={() => void handleSearch(lastQuery, page)} disabled={loading}>
              🔄 Refresh
            </button>
          </div>

          {lrs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 24px', color: '#555' }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>📭</div>
              <p style={{ margin: 0, fontWeight: 500 }}>No LR records matched your query.</p>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: '#9ca3af' }}>Try different keywords or leave the search blank to see all records.</p>
            </div>
          ) : (
            <LrTable
              lrs={lrs}
              onLrUpdated={(updated) => setLrs((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))}
            />
          )}

          {pages > 1 && (
            <div style={pagination}>
              <button disabled={page === 1} onClick={() => void handleSearch(lastQuery, page - 1)} style={pageBtn}>← Prev</button>
              <span style={{ fontSize: 13, color: '#555' }}>Page {page} / {pages}</span>
              <button disabled={page === pages} onClick={() => void handleSearch(lastQuery, page + 1)} style={pageBtn}>Next →</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const btnRefresh: React.CSSProperties = {
  padding: '6px 14px', background: '#f0f0f8', border: '1px solid #e0e0f0',
  borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#4361ee',
};
const pagination: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, justifyContent: 'center',
};
const pageBtn: React.CSSProperties = {
  padding: '6px 14px', background: '#eef0ff', border: '1px solid #c0c8ff',
  borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#4361ee', fontWeight: 500,
};
