import React, { useState, useRef, useCallback } from 'react';
import type { SearchDocumentResult, SearchFilters, DocumentType, DocumentStatus } from '../types';
import { searchApi } from '../services/api';

const TYPE_COLORS: Record<DocumentType, string> = {
  LR: '#4361ee', INVOICE: '#06b6d4', TOLL: '#f59e0b',
  WEIGHMENT: '#8b5cf6', EWAYBILL: '#10b981', RECEIVING: '#ec4899', UNKNOWN: '#9ca3af',
};

const STATUS_LABELS: Record<DocumentStatus, string> = {
  PENDING_OCR: 'Pending OCR', PENDING_REVIEW: 'Needs Review', REVIEWED: 'Reviewed', SAVED: 'Saved',
};

const STATUS_COLORS: Record<DocumentStatus, string> = {
  PENDING_OCR: '#f59e0b', PENDING_REVIEW: '#3b82f6', REVIEWED: '#8b5cf6', SAVED: '#22c55e',
};

const EXAMPLE_QUERIES = [
  'Show invoices from last week',
  'Find vehicle KA01AB1234 shipments',
  'LR documents this month',
  'Weighment slips from yesterday',
  'Toll receipts for MH12AB5678',
];

interface Props { onSelectDocument?: (doc: SearchDocumentResult) => void; }

export function SmartSearch({ onSelectDocument }: Props) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchDocumentResult[]>([]);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [total, setTotal] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hasSearched, setHasSearched] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true); setError(null); setSelectedIds(new Set());
    try {
      const res = await searchApi.query(q.trim());
      setResults(res.results); setFilters(res.filters); setTotal(res.total); setHasSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]); setFilters({}); setTotal(null);
    } finally { setLoading(false); }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void handleSearch(query);
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const toggleAll = () => {
    setSelectedIds(selectedIds.size === results.length ? new Set() : new Set(results.map((r) => r.id)));
  };

  const filterChips = buildFilterChips(filters);

  const removeFilter = (key: keyof SearchFilters) => {
    const updated = { ...filters };
    delete updated[key];
    setFilters(updated);
    void handleSearch(query);
  };

  return (
    <div>
      {/* Hero search section */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e0e0f0', padding: '28px 28px 20px', marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', textAlign: 'center' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: '#1a1a2e' }}>🔍 AI-Powered Search</h2>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6b7280' }}>
          Search logistics records using natural language — describe what you need and the AI will find it.
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
              placeholder="e.g. Show invoices from My Home last week, or vehicle KA01AB1234"
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
              padding: '10px 22px', background: loading || !query.trim() ? '#a0aec0' : '#4361ee',
              color: '#fff', border: 'none', borderRadius: 12, cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
              fontWeight: 700, fontSize: 15, transition: 'background 0.15s',
              boxShadow: loading || !query.trim() ? 'none' : '0 2px 8px rgba(67,97,238,0.3)',
            }}
            onClick={() => void handleSearch(query)}
            disabled={loading || !query.trim()}
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
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #e0e0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#555' }}>
                {total === 0 ? 'No records found' : `${total} record${total !== 1 ? 's' : ''} found`}
                {total !== null && results.length < total && ` (showing first ${results.length})`}
              </span>
              {filterChips.length > 0 && (
                <>
                  <span style={{ fontSize: 11, color: '#aaa' }}>·</span>
                  {filterChips.map(({ key, label }) => (
                    <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: '#eef0ff', color: '#4361ee', border: '1px solid #c0c8ff', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
                      {label}
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8899dd', fontSize: 10, padding: 0, lineHeight: 1 }} onClick={() => removeFilter(key as keyof SearchFilters)}>✕</button>
                    </span>
                  ))}
                </>
              )}
            </div>
            {selectedIds.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#4361ee', fontWeight: 600 }}>
                {selectedIds.size} selected
                <button style={{ background: 'none', border: '1px solid #c0c8ff', borderRadius: 6, cursor: 'pointer', color: '#4361ee', fontSize: 12, padding: '2px 8px' }} onClick={() => setSelectedIds(new Set())}>Clear</button>
              </div>
            )}
          </div>

          {results.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 24px', color: '#555' }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>📭</div>
              <p style={{ margin: 0, fontWeight: 500 }}>No documents matched your query.</p>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: '#9ca3af' }}>Try different keywords or broaden your date range.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 32 }}>
                      <input type="checkbox" checked={selectedIds.size === results.length && results.length > 0} onChange={toggleAll} />
                    </th>
                    <th style={th}>Type</th>
                    <th style={th}>Filename</th>
                    <th style={th}>Vehicle No</th>
                    <th style={th}>LR No</th>
                    <th style={th}>Invoice No</th>
                    <th style={th}>Party</th>
                    <th style={th}>Date</th>
                    <th style={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((doc) => {
                    const isSelected = selectedIds.has(doc.id);
                    const ed = doc.extractedData;
                    return (
                      <tr
                        key={doc.id}
                        style={{ borderBottom: '1px solid #f0f0f8', cursor: 'pointer', background: isSelected ? '#eef0ff' : '#fff', transition: 'background 0.1s' }}
                        onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.background = '#fafafe'; }}
                        onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.background = '#fff'; }}
                        onClick={() => { toggleRow(doc.id); onSelectDocument?.(doc); }}
                      >
                        <td style={td} onClick={(e) => { e.stopPropagation(); toggleRow(doc.id); }}>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleRow(doc.id)} />
                        </td>
                        <td style={td}>
                          <span style={{ color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700, background: TYPE_COLORS[doc.type as DocumentType] ?? '#9ca3af' }}>
                            {doc.type}
                          </span>
                        </td>
                        <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.originalFilename}</td>
                        <td style={td}>{ed?.vehicleNo ?? '—'}</td>
                        <td style={td}>{ed?.lrNo ?? '—'}</td>
                        <td style={td}>{ed?.invoiceNo ?? '—'}</td>
                        <td style={{ ...td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ed?.partyNames ? ed.partyNames.join(', ') : '—'}
                        </td>
                        <td style={td}>{ed?.date ?? '—'}</td>
                        <td style={td}>
                          <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: STATUS_COLORS[doc.status as DocumentStatus] + '22', color: STATUS_COLORS[doc.status as DocumentStatus] }}>
                            {STATUS_LABELS[doc.status as DocumentStatus] ?? doc.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function buildFilterChips(filters: SearchFilters): { key: string; label: string }[] {
  const chips: { key: string; label: string }[] = [];
  if (filters.vehicleNo) chips.push({ key: 'vehicleNo', label: `🚛 Vehicle: ${filters.vehicleNo}` });
  if (filters.documentType) chips.push({ key: 'documentType', label: `📄 Type: ${filters.documentType}` });
  if (filters.lrNo) chips.push({ key: 'lrNo', label: `LR: ${filters.lrNo}` });
  if (filters.invoiceNo) chips.push({ key: 'invoiceNo', label: `Invoice: ${filters.invoiceNo}` });
  if (filters.partyName) chips.push({ key: 'partyName', label: `🤝 Party: ${filters.partyName}` });
  if (filters.dateFrom && filters.dateTo && filters.dateFrom === filters.dateTo) {
    chips.push({ key: 'dateFrom', label: `📅 Date: ${filters.dateFrom}` });
  } else {
    if (filters.dateFrom) chips.push({ key: 'dateFrom', label: `📅 From: ${filters.dateFrom}` });
    if (filters.dateTo) chips.push({ key: 'dateTo', label: `📅 To: ${filters.dateTo}` });
  }
  return chips;
}

const th: React.CSSProperties = {
  padding: '10px 12px', background: '#f5f6ff', color: '#555',
  fontWeight: 700, textAlign: 'left', borderBottom: '1px solid #e8e8f0',
  whiteSpace: 'nowrap', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em',
};
const td: React.CSSProperties = { padding: '9px 12px', color: '#333', verticalAlign: 'middle' };
