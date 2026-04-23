import React, { useState, useRef, useCallback } from 'react';
import type { SearchDocumentResult, SearchFilters, DocumentType, DocumentStatus } from '../types';
import { searchApi } from '../services/api';

const TYPE_COLORS: Record<DocumentType, string> = {
  LR: '#4361ee',
  INVOICE: '#06b6d4',
  TOLL: '#f59e0b',
  WEIGHMENT: '#8b5cf6',
  EWAYBILL: '#10b981',
  RECEIVING: '#ec4899',
  UNKNOWN: '#9ca3af',
};

const STATUS_LABELS: Record<DocumentStatus, string> = {
  PENDING_OCR: 'Pending OCR',
  PENDING_REVIEW: 'Needs Review',
  REVIEWED: 'Reviewed',
  SAVED: '✅ Saved',
};

const STATUS_COLORS: Record<DocumentStatus, string> = {
  PENDING_OCR: '#f59e0b',
  PENDING_REVIEW: '#3b82f6',
  REVIEWED: '#8b5cf6',
  SAVED: '#22c55e',
};

const EXAMPLE_QUERIES = [
  'Show invoices from last week',
  'Find vehicle KA01AB1234 shipments',
  'LR documents this month',
  'Weighment slips from yesterday',
  'Toll receipts for MH12AB5678',
];

interface Props {
  onSelectDocument?: (doc: SearchDocumentResult) => void;
}

export function SmartSearch({ onSelectDocument }: Props) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchDocumentResult[]>([]);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [total, setTotal] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setSelectedIds(new Set());
    try {
      const res = await searchApi.query(q.trim());
      setResults(res.results);
      setFilters(res.filters);
      setTotal(res.total);
      setHasSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
      setFilters({});
      setTotal(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void handleSearch(query);
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === results.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(results.map((r) => r.id)));
    }
  };

  // Build filter chips from the parsed filters object
  const filterChips = buildFilterChips(filters);

  const removeFilter = (key: keyof SearchFilters) => {
    const updated = { ...filters };
    delete updated[key];
    setFilters(updated);
    // Re-run the search with the remaining filters (note: re-query the backend)
    // For simplicity, we just update the display and re-search with query
    void handleSearch(query);
  };

  return (
    <div style={styles.container}>
      <div style={styles.heroSection}>
        <h2 style={styles.title}>🔍 AI-Powered Search</h2>
        <p style={styles.subtitle}>
          Search logistics records using natural language — describe what you need and the AI will find it.
        </p>

        {/* Search bar */}
        <div style={styles.searchBarWrap}>
          <div style={styles.searchBar}>
            <span style={styles.searchIcon}>🔍</span>
            <input
              ref={inputRef}
              style={styles.searchInput}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Show invoices from My Home last week, or vehicle KA01AB1234"
              autoComplete="off"
            />
            {query && (
              <button
                style={styles.clearBtn}
                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              >
                ✕
              </button>
            )}
          </div>
          <button
            style={{ ...styles.searchBtn, ...(loading ? styles.btnDisabled : {}) }}
            onClick={() => void handleSearch(query)}
            disabled={loading || !query.trim()}
          >
            {loading ? '⏳' : 'Search'}
          </button>
        </div>

        {/* Example queries */}
        {!hasSearched && (
          <div style={styles.examples}>
            <span style={styles.exampleLabel}>Try: </span>
            {EXAMPLE_QUERIES.map((q) => (
              <button
                key={q}
                style={styles.exampleChip}
                onClick={() => { setQuery(q); void handleSearch(q); }}
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && <p style={styles.error}>⚠️ {error}</p>}

      {/* Results section */}
      {hasSearched && !loading && (
        <div style={styles.resultsSection}>
          {/* Filter chips */}
          {filterChips.length > 0 && (
            <div style={styles.chipsRow}>
              <span style={styles.chipsLabel}>Filters: </span>
              {filterChips.map(({ key, label }) => (
                <span key={key} style={styles.filterChip}>
                  {label}
                  <button
                    style={styles.chipRemove}
                    onClick={() => removeFilter(key as keyof SearchFilters)}
                    title="Remove filter"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Result count and selection info */}
          <div style={styles.resultsMeta}>
            <span style={styles.resultCount}>
              {total === 0
                ? 'No records found'
                : `${total} record${total !== 1 ? 's' : ''} found`}
              {total !== null && results.length < total && ` (showing first ${results.length})`}
            </span>
            {selectedIds.size > 0 && (
              <span style={styles.selectionInfo}>
                {selectedIds.size} selected
                <button
                  style={styles.clearSelBtn}
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear selection
                </button>
              </span>
            )}
          </div>

          {/* Results table */}
          {results.length === 0 ? (
            <div style={styles.emptyResults}>
              <div style={styles.emptyIcon}>📭</div>
              <p>No documents matched your query.</p>
              <p style={styles.emptySub}>Try different keywords or broaden your date range.</p>
            </div>
          ) : (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, width: 32 }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.size === results.length && results.length > 0}
                        onChange={toggleAll}
                      />
                    </th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Filename</th>
                    <th style={styles.th}>Vehicle No</th>
                    <th style={styles.th}>LR No</th>
                    <th style={styles.th}>Invoice No</th>
                    <th style={styles.th}>Party</th>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((doc) => {
                    const isSelected = selectedIds.has(doc.id);
                    const ed = doc.extractedData;
                    return (
                      <tr
                        key={doc.id}
                        style={{ ...styles.tr, ...(isSelected ? styles.trSelected : {}) }}
                        onClick={() => {
                          toggleRow(doc.id);
                          onSelectDocument?.(doc);
                        }}
                      >
                        <td style={styles.td} onClick={(e) => { e.stopPropagation(); toggleRow(doc.id); }}>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleRow(doc.id)} />
                        </td>
                        <td style={styles.td}>
                          <span
                            style={{
                              ...styles.typeBadge,
                              background: TYPE_COLORS[doc.type as DocumentType] ?? '#9ca3af',
                            }}
                          >
                            {doc.type}
                          </span>
                        </td>
                        <td style={{ ...styles.td, ...styles.filenameCell }}>
                          {doc.originalFilename}
                        </td>
                        <td style={styles.td}>{ed?.vehicleNo ?? '—'}</td>
                        <td style={styles.td}>{ed?.lrNo ?? '—'}</td>
                        <td style={styles.td}>{ed?.invoiceNo ?? '—'}</td>
                        <td style={{ ...styles.td, ...styles.partyCell }}>
                          {ed?.partyNames ? ed.partyNames.join(', ') : '—'}
                        </td>
                        <td style={styles.td}>{ed?.date ?? '—'}</td>
                        <td style={styles.td}>
                          <span
                            style={{
                              ...styles.statusBadge,
                              background: STATUS_COLORS[doc.status as DocumentStatus] + '22',
                              color: STATUS_COLORS[doc.status as DocumentStatus],
                            }}
                          >
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

// ── Helpers ────────────────────────────────────────────────────────────────────

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

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '0 24px', maxWidth: 1100, margin: '0 auto' },

  heroSection: { textAlign: 'center', padding: '24px 0 16px' },
  title: { fontSize: 24, fontWeight: 800, color: '#1a1a2e', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 20 },

  searchBarWrap: { display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 12 },
  searchBar: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#fff', border: '2px solid #c0c8ff', borderRadius: 10,
    padding: '10px 14px', flex: 1, maxWidth: 680, boxShadow: '0 2px 12px rgba(67,97,238,0.08)',
  },
  searchIcon: { fontSize: 16, flexShrink: 0 },
  searchInput: {
    flex: 1, border: 'none', outline: 'none', fontSize: 15,
    background: 'transparent', color: '#1a1a2e',
  },
  clearBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: '#aaa', fontSize: 14, padding: '0 2px',
  },
  searchBtn: {
    padding: '10px 22px', background: '#4361ee', color: '#fff',
    border: 'none', borderRadius: 10, cursor: 'pointer',
    fontWeight: 700, fontSize: 15,
  },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },

  examples: { display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 4 },
  exampleLabel: { fontSize: 13, color: '#888', alignSelf: 'center' },
  exampleChip: {
    padding: '4px 10px', background: '#eef0ff', color: '#4361ee',
    border: '1px solid #c0c8ff', borderRadius: 20, cursor: 'pointer',
    fontSize: 12, fontWeight: 500,
  },

  error: { color: '#e53e3e', fontSize: 13, textAlign: 'center', marginBottom: 12 },

  resultsSection: { marginTop: 8 },

  chipsRow: {
    display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
    marginBottom: 10,
  },
  chipsLabel: { fontSize: 12, color: '#888', fontWeight: 600 },
  filterChip: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 10px', background: '#eef0ff', color: '#4361ee',
    border: '1px solid #c0c8ff', borderRadius: 20, fontSize: 12, fontWeight: 500,
  },
  chipRemove: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: '#8899dd', fontSize: 10, padding: 0, lineHeight: 1,
  },

  resultsMeta: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8, fontSize: 13,
  },
  resultCount: { color: '#555', fontWeight: 600 },
  selectionInfo: { display: 'flex', alignItems: 'center', gap: 8, color: '#4361ee', fontWeight: 600 },
  clearSelBtn: {
    background: 'none', border: '1px solid #c0c8ff', borderRadius: 6,
    cursor: 'pointer', color: '#4361ee', fontSize: 12, padding: '2px 8px',
  },

  emptyResults: { textAlign: 'center', padding: '40px 0', color: '#555' },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptySub: { fontSize: 13, color: '#888' },

  tableWrap: { overflowX: 'auto', background: '#fff', borderRadius: 10, boxShadow: '0 1px 6px rgba(0,0,0,0.07)', border: '1px solid #e8e8f0' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    padding: '10px 12px', background: '#f5f6ff', color: '#555',
    fontWeight: 700, textAlign: 'left', borderBottom: '1px solid #e8e8f0',
    whiteSpace: 'nowrap',
  },
  tr: { borderBottom: '1px solid #f0f0f8', cursor: 'pointer', transition: 'background 0.1s' },
  trSelected: { background: '#eef0ff' },
  td: { padding: '9px 12px', color: '#333', verticalAlign: 'middle' },
  filenameCell: { maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  partyCell: { maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  typeBadge: {
    color: '#fff', padding: '2px 8px', borderRadius: 10,
    fontSize: 11, fontWeight: 700,
  },
  statusBadge: {
    padding: '2px 8px', borderRadius: 8,
    fontSize: 11, fontWeight: 600,
  },
};
