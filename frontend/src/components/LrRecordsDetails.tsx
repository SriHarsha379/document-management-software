import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { Lr } from '../types';
import { lrApi } from '../services/api';
import { useCurrentUser, PERM } from '../contexts/UserContext';
import { LrEditModal } from './LrEditModal';

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

type SortDir = 'asc' | 'desc';

interface Filters {
  principalCompany: string;
  branchId: string;
  workingCenter: string;
  depot: string;
  plantCode: string;
  lrDate: string;
  invoiceDate: string;
  ewayBillDate: string;
}

const EMPTY_FILTERS: Filters = {
  principalCompany: '',
  branchId: '',
  workingCenter: '',
  depot: '',
  plantCode: '',
  lrDate: '',
  invoiceDate: '',
  ewayBillDate: '',
};

interface FetchParams {
  page: number;
  search: string;
  filters: Filters;
  sortBy: string | null;
  sortDir: SortDir;
}

const INITIAL_FETCH_PARAMS: FetchParams = {
  page: 1,
  search: '',
  filters: EMPTY_FILTERS,
  sortBy: null,
  sortDir: 'asc',
};

// ── Column definitions ────────────────────────────────────────────────────────

interface ColDef {
  key: string;
  label: string;
  sortField: string | null;
  width: number;
  render: (lr: Lr) => React.ReactNode;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}

function fmtNum(v: number | null | undefined): string {
  return v == null ? '—' : String(v);
}

const COLUMNS: ColDef[] = [
  { key: 'lrDate',               label: 'LR Date',               sortField: 'lrDate',               width: 100, render: (lr) => fmtDate(lr.lrDate) },
  { key: 'lrNo',                 label: 'LR Number',             sortField: 'lrNo',                 width: 150, render: (lr) => lr.lrNo },
  { key: 'inDate',               label: 'In Date',               sortField: 'date',                 width: 100, render: (lr) => fmtDate(lr.date) },
  { key: 'companyInvoiceNo',     label: 'Invoice Number',        sortField: 'companyInvoiceNo',     width: 150, render: (lr) => lr.companyInvoiceNo ?? '—' },
  { key: 'ewayBillDate',         label: 'E-Way Bill Date',       sortField: null,                   width: 120, render: () => '—' },
  { key: 'companyEwayBillNo',    label: 'E-Way Bill Number',     sortField: 'companyEwayBillNo',    width: 160, render: (lr) => lr.companyEwayBillNo ?? '—' },
  { key: 'loadingSlipNo',        label: 'Loading Slip Number',   sortField: 'loadingSlipNo',        width: 150, render: (lr) => lr.loadingSlipNo ?? '—' },
  { key: 'billNo',               label: 'Bill Number',           sortField: 'billNo',               width: 120, render: (lr) => lr.billNo ?? '—' },
  { key: 'shipApproved',         label: 'Ship Approved',         sortField: null,                   width: 110, render: () => '—' },
  { key: 'destination',          label: 'Destination',           sortField: 'shipToParty',          width: 160, render: (lr) => lr.shipToParty ?? '—' },
  { key: 'deliveredDestination', label: 'Delivered Destination', sortField: 'deliveryDestination',  width: 170, render: (lr) => lr.deliveryDestination ?? '—' },
  { key: 'quantityInBags',       label: 'Order Quantity (Bags)', sortField: 'quantityInBags',       width: 150, render: (lr) => fmtNum(lr.quantityInBags) },
  { key: 'quantityInMt',         label: 'Quantity (MT)',         sortField: 'quantityInMt',         width: 120, render: (lr) => fmtNum(lr.quantityInMt) },
  { key: 'productName',          label: 'Product',               sortField: 'productName',          width: 140, render: (lr) => lr.productName ?? '—' },
  { key: 'vehicleNo',            label: 'Vehicle Number',        sortField: 'vehicleNo',            width: 130, render: (lr) => lr.vehicleNo ?? '—' },
  { key: 'tptCode',              label: 'Transport Code',        sortField: 'tptCode',              width: 130, render: (lr) => lr.tptCode ?? '—' },
  { key: 'driverName',           label: 'Driver Name',           sortField: 'driverName',           width: 140, render: (lr) => lr.driverName ?? '—' },
  { key: 'driverMobile',         label: 'Driver Mobile Number',  sortField: null,                   width: 150, render: () => '—' },
];

// ── SearchableSelect ──────────────────────────────────────────────────────────

interface SearchableSelectProps {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  disabled?: boolean;
}

function SearchableSelect({ value, onChange, options, placeholder, disabled }: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const filtered = options.filter(
    (o) => !search || o.label.toLowerCase().includes(search.toLowerCase()),
  );

  const selectedLabel = options.find((o) => o.value === value)?.label ?? '';

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div
        style={{
          border: '1px solid #d1d5db', borderRadius: 7, padding: '6px 10px',
          background: disabled ? '#f9f9f9' : '#fff',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          color: value ? '#1a1a2e' : '#9ca3af', userSelect: 'none',
          opacity: disabled ? 0.6 : 1,
        }}
        onClick={() => { if (!disabled) setOpen((s) => !s); }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {value ? selectedLabel : placeholder}
        </span>
        <span style={{ fontSize: 9, color: '#9ca3af', flexShrink: 0, marginLeft: 4 }}>▼</span>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: '#fff', border: '1px solid #d1d5db', borderRadius: 7,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: 2,
          maxHeight: 240, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f8', flexShrink: 0 }}>
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              style={{
                width: '100%', border: '1px solid #e0e0f0', borderRadius: 5,
                padding: '4px 8px', fontSize: 12, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <div
              style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer', color: '#6b7280' }}
              onClick={() => { onChange(''); setOpen(false); }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#f5f6ff'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = ''; }}
            >
              — All —
            </div>
            {filtered.map((o) => (
              <div
                key={o.value}
                style={{
                  padding: '7px 12px', fontSize: 13, cursor: 'pointer',
                  background: value === o.value ? '#eef0ff' : 'transparent',
                  color: '#1a1a2e',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = value === o.value ? '#e0e6ff' : '#f5f6ff';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = value === o.value ? '#eef0ff' : 'transparent';
                }}
                onClick={() => { onChange(o.value); setOpen(false); }}
              >
                {o.label}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 12, color: '#9ca3af' }}>No options</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── LrRecordsDetails ──────────────────────────────────────────────────────────

export function LrRecordsDetails({ refreshTrigger = 0 }: { refreshTrigger?: number }) {
  const { hasPermission } = useCurrentUser();
  const canUpdate = hasPermission(PERM.LR_UPDATE);

  // ── Data ────────────────────────────────────────────────────────────────────
  const [lrs, setLrs] = useState<Lr[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch parameters (single state object to avoid double-fetches) ──────────
  const [fetchParams, setFetchParams] = useState<FetchParams>(INITIAL_FETCH_PARAMS);

  // ── Internal refresh key (for manual Refresh Data click) ────────────────────
  const [internalRefresh, setInternalRefresh] = useState(0);

  // ── Pending filter/search (staged until Apply is clicked) ───────────────────
  const [searchInput, setSearchInput] = useState('');
  const [pendingFilters, setPendingFilters] = useState<Filters>(EMPTY_FILTERS);

  // ── Dropdown option lists ───────────────────────────────────────────────────
  const [branches, setBranches] = useState<{ value: string; label: string }[]>([]);
  const [principalCompanies, setPrincipalCompanies] = useState<{ value: string; label: string }[]>([]);

  // ── Edit modal ──────────────────────────────────────────────────────────────
  const [editingLr, setEditingLr] = useState<Lr | null>(null);

  // ── Load dropdown options ────────────────────────────────────────────────────
  useEffect(() => {
    lrApi.branches().then((bs) => {
      setBranches(bs.map((b) => ({ value: b.id, label: b.name })));
    }).catch(() => {});

    lrApi.filterValues().then((fv) => {
      setPrincipalCompanies(fv.principalCompanies.map((v) => ({ value: v, label: v })));
    }).catch(() => {});
  }, []);

  // ── Fetch data ───────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (params: FetchParams) => {
    setLoading(true);
    setError(null);
    try {
      const offset = (params.page - 1) * PAGE_SIZE;
      const result = await lrApi.list({
        limit: PAGE_SIZE,
        offset,
        q: params.search || undefined,
        principalCompany: params.filters.principalCompany || undefined,
        branchId: params.filters.branchId || undefined,
        lrDate: params.filters.lrDate || undefined,
        invoiceDate: params.filters.invoiceDate || undefined,
        sortBy: params.sortBy ?? undefined,
        sortDir: params.sortBy ? params.sortDir : undefined,
      });
      setLrs(result.data);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load LR records');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData(fetchParams);
  }, [fetchData, fetchParams, refreshTrigger, internalRefresh]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleApplyFilters = () => {
    setFetchParams({
      page: 1,
      search: searchInput,
      filters: { ...pendingFilters },
      sortBy: fetchParams.sortBy,
      sortDir: fetchParams.sortDir,
    });
  };

  const handleResetFilters = () => {
    setSearchInput('');
    setPendingFilters(EMPTY_FILTERS);
    setFetchParams(INITIAL_FETCH_PARAMS);
  };

  const handleRefresh = () => setInternalRefresh((k) => k + 1);

  const handleSort = (field: string) => {
    setFetchParams((p) => ({
      ...p,
      page: 1,
      sortBy: field,
      sortDir: p.sortBy === field ? (p.sortDir === 'asc' ? 'desc' : 'asc') : 'asc',
    }));
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleApplyFilters();
    }
  };

  // ── Derived values ────────────────────────────────────────────────────────────
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasActiveFilters =
    fetchParams.search || Object.values(fetchParams.filters).some(Boolean);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={sCard}>
      {/* ── Section header ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>
          LR Records Details
          {total > 0 && (
            <span style={{ fontSize: 13, fontWeight: 400, color: '#6b7280', marginLeft: 8 }}>
              ({total.toLocaleString()} records)
            </span>
          )}
        </h3>
        {hasActiveFilters && (
          <span style={{
            fontSize: 11, fontWeight: 600, color: '#4361ee',
            background: '#eef0ff', borderRadius: 99, padding: '3px 10px',
          }}>
            Filters active
          </span>
        )}
      </div>

      {/* ── Global search ──────────────────────────────────────────── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ position: 'relative', maxWidth: 560 }}>
          <span style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            fontSize: 14, color: '#9ca3af', pointerEvents: 'none',
          }}>
            🔍
          </span>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search by LR No, Invoice No, Vehicle No, Driver Name, E-Way Bill No, Loading Slip No…"
            style={{
              width: '100%', padding: '8px 12px 8px 34px',
              borderRadius: 8, border: '1px solid #d1d5db',
              fontSize: 13, outline: 'none', boxSizing: 'border-box',
              color: '#1a1a2e', background: '#fafafa', transition: 'border-color 0.15s, background 0.15s',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#4361ee'; e.currentTarget.style.background = '#fff'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.background = '#fafafa'; }}
          />
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>
          Press Enter or click Apply Filters to search
        </div>
      </div>

      {/* ── Filter panel ───────────────────────────────────────────── */}
      <div style={filterPanel}>
        <div style={filterPanelTitle}>Filters</div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
          gap: 12,
          marginBottom: 14,
        }}>
          {/* Principal Company */}
          <div>
            <div style={sFilterLabel}>Principal Company</div>
            <SearchableSelect
              value={pendingFilters.principalCompany}
              onChange={(v) => setPendingFilters((f) => ({ ...f, principalCompany: v }))}
              options={principalCompanies}
              placeholder="All Companies"
            />
          </div>

          {/* Branch */}
          <div>
            <div style={sFilterLabel}>Branch</div>
            <SearchableSelect
              value={pendingFilters.branchId}
              onChange={(v) => setPendingFilters((f) => ({ ...f, branchId: v }))}
              options={branches}
              placeholder="All Branches"
            />
          </div>

          {/* Working Center */}
          <div>
            <div style={sFilterLabel}>Working Center</div>
            <SearchableSelect
              value={pendingFilters.workingCenter}
              onChange={(v) => setPendingFilters((f) => ({ ...f, workingCenter: v }))}
              options={[]}
              placeholder="All Centers"
              disabled
            />
          </div>

          {/* Depot */}
          <div>
            <div style={sFilterLabel}>Depot</div>
            <SearchableSelect
              value={pendingFilters.depot}
              onChange={(v) => setPendingFilters((f) => ({ ...f, depot: v }))}
              options={[]}
              placeholder="All Depots"
              disabled
            />
          </div>

          {/* Plant Code */}
          <div>
            <div style={sFilterLabel}>Plant Code</div>
            <SearchableSelect
              value={pendingFilters.plantCode}
              onChange={(v) => setPendingFilters((f) => ({ ...f, plantCode: v }))}
              options={[]}
              placeholder="All Plants"
              disabled
            />
          </div>

          {/* LR Date */}
          <div>
            <div style={sFilterLabel}>LR Date</div>
            <input
              type="date"
              value={pendingFilters.lrDate}
              onChange={(e) => setPendingFilters((f) => ({ ...f, lrDate: e.target.value }))}
              style={sDateInput}
            />
          </div>

          {/* Invoice Date */}
          <div>
            <div style={sFilterLabel}>Invoice Date</div>
            <input
              type="date"
              value={pendingFilters.invoiceDate}
              onChange={(e) => setPendingFilters((f) => ({ ...f, invoiceDate: e.target.value }))}
              style={sDateInput}
            />
          </div>

          {/* E-Way Bill Date */}
          <div>
            <div style={sFilterLabel}>E-Way Bill Date</div>
            <input
              type="date"
              value={pendingFilters.ewayBillDate}
              onChange={(e) => setPendingFilters((f) => ({ ...f, ewayBillDate: e.target.value }))}
              style={{ ...sDateInput, opacity: 0.5, cursor: 'not-allowed' }}
              disabled
              title="E-Way Bill Date filter coming soon"
            />
          </div>
        </div>

        {/* Filter action buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button style={sBtnApply} onClick={handleApplyFilters}>✓ Apply Filters</button>
          <button style={sBtnReset} onClick={handleResetFilters}>✕ Reset Filters</button>
          <button style={sBtnRefresh} onClick={handleRefresh} disabled={loading}>
            🔄 Refresh Data
          </button>
        </div>
      </div>

      {/* ── Error state ────────────────────────────────────────────── */}
      {error && <div style={sErrorBox}>⚠️ {error}</div>}

      {/* ── Table ──────────────────────────────────────────────────── */}
      <div style={{ overflowX: 'auto', border: '1px solid #e0e0f0', borderRadius: 8, position: 'relative' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 'max-content' }}>
          <thead>
            <tr>
              {COLUMNS.map((col) => {
                const isSorted = fetchParams.sortBy === col.sortField && col.sortField !== null;
                return (
                  <th
                    key={col.key}
                    style={{
                      ...sThBase,
                      minWidth: col.width,
                      cursor: col.sortField ? 'pointer' : 'default',
                      position: 'sticky',
                      top: 0,
                      zIndex: 2,
                      userSelect: 'none',
                      background: isSorted ? '#eaebff' : '#f5f6ff',
                    }}
                    onClick={() => { if (col.sortField) handleSort(col.sortField); }}
                    title={col.sortField ? `Sort by ${col.label}` : undefined}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {col.label}
                      {col.sortField && (
                        <span style={{ fontSize: 9, opacity: isSorted ? 1 : 0.3, color: '#4361ee' }}>
                          {isSorted ? (fetchParams.sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
              {canUpdate && (
                <th style={{
                  ...sThBase, minWidth: 60,
                  position: 'sticky', top: 0, zIndex: 2, background: '#f5f6ff',
                }}>
                  Edit
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {/* Loading skeleton */}
            {loading && lrs.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length + (canUpdate ? 1 : 0)}
                  style={{ textAlign: 'center', padding: '36px 0', color: '#9ca3af' }}
                >
                  <div style={{ fontSize: 13 }}>⏳ Loading records…</div>
                </td>
              </tr>
            )}

            {/* Empty state */}
            {!loading && lrs.length === 0 && !error && (
              <tr>
                <td
                  colSpan={COLUMNS.length + (canUpdate ? 1 : 0)}
                  style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}
                >
                  <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
                  <div style={{ fontSize: 13 }}>
                    {hasActiveFilters
                      ? 'No records match the current filters or search.'
                      : 'No LR records found.'}
                  </div>
                </td>
              </tr>
            )}

            {/* Data rows */}
            {lrs.map((lr, idx) => (
              <tr
                key={lr.id}
                style={{
                  background: idx % 2 === 0 ? '#fff' : '#fafafe',
                  borderBottom: '1px solid #f0f0f8',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = '#f0f4ff'; }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = idx % 2 === 0 ? '#fff' : '#fafafe';
                }}
              >
                {COLUMNS.map((col) => {
                  const rendered = col.render(lr);
                  const tipVal = typeof rendered === 'string' && rendered !== '—' ? rendered : undefined;
                  return (
                    <td key={col.key} style={sTdBase} title={tipVal}>
                      <span style={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: col.width,
                      }}>
                        {rendered}
                      </span>
                    </td>
                  );
                })}
                {canUpdate && (
                  <td style={sTdBase}>
                    <button
                      style={sEditBtn}
                      onClick={() => setEditingLr(lr)}
                      title="Edit LR record"
                    >
                      ✏️
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Refreshing indicator (subsequent fetches) ───────────────── */}
      {loading && lrs.length > 0 && (
        <div style={{ textAlign: 'center', padding: '6px 0', fontSize: 12, color: '#4361ee' }}>
          ⏳ Refreshing…
        </div>
      )}

      {/* ── Pagination ─────────────────────────────────────────────── */}
      {pages > 1 && (
        <div style={sPagination}>
          <button
            disabled={fetchParams.page === 1}
            onClick={() => setFetchParams((p) => ({ ...p, page: 1 }))}
            style={sPageBtn}
            title="First page"
          >
            «
          </button>
          <button
            disabled={fetchParams.page === 1}
            onClick={() => setFetchParams((p) => ({ ...p, page: p.page - 1 }))}
            style={sPageBtn}
          >
            ‹ Prev
          </button>
          <span style={{ fontSize: 13, color: '#555', padding: '0 6px' }}>
            Page {fetchParams.page} of {pages}
          </span>
          <button
            disabled={fetchParams.page === pages}
            onClick={() => setFetchParams((p) => ({ ...p, page: p.page + 1 }))}
            style={sPageBtn}
          >
            Next ›
          </button>
          <button
            disabled={fetchParams.page === pages}
            onClick={() => setFetchParams((p) => ({ ...p, page: pages }))}
            style={sPageBtn}
            title="Last page"
          >
            »
          </button>
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 4 }}>
            {total.toLocaleString()} total
          </span>
        </div>
      )}

      {/* ── Edit modal ─────────────────────────────────────────────── */}
      {editingLr && (
        <LrEditModal
          lr={editingLr}
          onSaved={(updated) => {
            setLrs((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
            setEditingLr(null);
          }}
          onCancel={() => setEditingLr(null)}
        />
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const sCard: React.CSSProperties = {
  background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0',
  padding: '20px', marginBottom: 20,
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
};

const filterPanel: React.CSSProperties = {
  background: '#f8f9ff', border: '1px solid #e8e9f8',
  borderRadius: 10, padding: '14px 16px', marginBottom: 16,
};

const filterPanelTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#555',
  marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em',
};

const sFilterLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: '#555',
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.03em',
};

const sDateInput: React.CSSProperties = {
  width: '100%', padding: '6px 10px',
  border: '1px solid #d1d5db', borderRadius: 7,
  fontSize: 13, outline: 'none', background: '#fff',
  color: '#1a1a2e', boxSizing: 'border-box',
};

const sBtnApply: React.CSSProperties = {
  padding: '7px 16px', background: '#4361ee', color: '#fff',
  border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600,
  boxShadow: '0 2px 6px rgba(67,97,238,0.22)',
};

const sBtnReset: React.CSSProperties = {
  padding: '7px 16px', background: '#fff', color: '#4361ee',
  border: '1px solid #4361ee', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 500,
};

const sBtnRefresh: React.CSSProperties = {
  padding: '7px 16px', background: '#f0f0f8', color: '#1a1a2e',
  border: '1px solid #e0e0f0', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 500,
};

const sErrorBox: React.CSSProperties = {
  background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
  padding: '10px 14px', color: '#b91c1c', fontSize: 13, marginBottom: 12,
};

const sThBase: React.CSSProperties = {
  padding: '9px 10px', fontSize: 11, fontWeight: 700, color: '#555',
  textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
  textAlign: 'left', borderBottom: '2px solid #e0e0f0',
  overflow: 'hidden', textOverflow: 'ellipsis',
};

const sTdBase: React.CSSProperties = {
  padding: '7px 10px', fontSize: 12, color: '#333',
  verticalAlign: 'middle',
};

const sEditBtn: React.CSSProperties = {
  background: 'none', border: '1px solid #d0d0e0', borderRadius: 4,
  cursor: 'pointer', fontSize: 13, padding: '2px 6px', lineHeight: 1,
};

const sPagination: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  marginTop: 14, justifyContent: 'center', flexWrap: 'wrap',
};

const sPageBtn: React.CSSProperties = {
  padding: '5px 12px', background: '#eef0ff', border: '1px solid #c0c8ff',
  borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#4361ee', fontWeight: 500,
};
