import React, { useEffect, useState, useCallback } from 'react';
import type { Lr, LrSummary } from '../types';
import { lrApi, adminDriverAccessApi } from '../services/api';
import type { DriverUploadDoc } from '../services/api';
import { LrEditModal } from './LrEditModal';

// ── Column definitions ────────────────────────────────────────────────────────

interface Col {
  label: string;
  render: (lr: Lr) => React.ReactNode;
  width: number; // px
}

const ALL_COLUMNS: Col[] = [
  { label: 'S.No',               width: 60,  render: (lr) => lr.serialNo ?? '—' },
  { label: 'Principal Co.',      width: 130, render: (lr) => lr.principalCompany ?? '—' },
  { label: 'Branch',             width: 110, render: (lr) => lr.branch?.name ?? '—' },
  { label: 'Source',             width: 90,  render: (lr) => lr.source },
  { label: 'LR Date',            width: 100, render: (lr) => lr.lrDate ?? lr.date ?? '—' },
  { label: 'LR No',              width: 100, render: (lr) => lr.lrNo },
  { label: 'Loading Slip No',    width: 120, render: (lr) => lr.loadingSlipNo ?? '—' },
  { label: 'Inv. Date',          width: 100, render: (lr) => lr.companyInvoiceDate ?? '—' },
  { label: 'Inv. No',            width: 110, render: (lr) => lr.companyInvoiceNo ?? '—' },
  { label: 'E-Way Bill No',      width: 120, render: (lr) => lr.companyEwayBillNo ?? '—' },
  { label: 'Bill To Party',      width: 130, render: (lr) => lr.billToParty ?? '—' },
  { label: 'Ship To Party',      width: 130, render: (lr) => lr.shipToParty ?? '—' },
  { label: 'Delivery Dest.',     width: 130, render: (lr) => lr.deliveryDestination ?? '—' },
  { label: 'TPT',                width: 90,  render: (lr) => lr.tpt ?? '—' },
  { label: 'Order Type',         width: 100, render: (lr) => lr.orderType ?? '—' },
  // ── expanded columns below ────────────────────────────────────────────────
  { label: 'Product',            width: 120, render: (lr) => lr.productName ?? '—' },
  { label: 'Vehicle No',         width: 110, render: (lr) => lr.vehicleNo ?? '—' },
  { label: 'Qty (Bags)',         width: 90,  render: (lr) => lr.quantityInBags ?? '—' },
  { label: 'Qty (MT)',           width: 80,  render: (lr) => lr.quantityInMt ?? '—' },
  { label: 'Toll ₹',            width: 80,  render: (lr) => lr.tollCharges ?? '—' },
  { label: 'Weighment ₹',       width: 100, render: (lr) => lr.weighmentCharges ?? '—' },
  { label: 'Unloading ₹',       width: 100, render: (lr) => lr.unloadingAtSite ?? '—' },
  { label: 'Driver Bhatta ₹',   width: 110, render: (lr) => lr.driverBhatta ?? '—' },
  { label: 'Open KM',            width: 80,  render: (lr) => lr.dayOpeningKm ?? '—' },
  { label: 'Close KM',           width: 80,  render: (lr) => lr.dayClosingKm ?? '—' },
  { label: 'Total KM',           width: 80,  render: (lr) => lr.totalRunningKm ?? '—' },
  { label: 'Fuel/KM',            width: 80,  render: (lr) => lr.fuelPerKm ?? '—' },
  { label: 'Fuel Amt ₹',        width: 90,  render: (lr) => lr.fuelAmount ?? '—' },
  { label: 'Grand Total ₹',     width: 110, render: (lr) => lr.grandTotal ?? '—' },
  { label: 'TPT Code',           width: 90,  render: (lr) => lr.tptCode ?? '—' },
  { label: 'Transporter',        width: 130, render: (lr) => lr.transporterName ?? '—' },
  { label: 'Driver',             width: 110, render: (lr) => lr.driverName ?? '—' },
  { label: 'Driver Bill No',     width: 110, render: (lr) => lr.driverBillNo ?? '—' },
  { label: 'Bill Date',          width: 100, render: (lr) => lr.billDate ?? '—' },
  { label: 'Bill No',            width: 100, render: (lr) => lr.billNo ?? '—' },
  { label: 'Bill Amount ₹',     width: 110, render: (lr) => lr.billAmount ?? '—' },
];

const VISIBLE_COUNT = 15; // first N columns always shown

// ── Tiny SVG Pie Chart ────────────────────────────────────────────────────────

function polarToXY(cx: number, cy: number, r: number, fraction: number) {
  const angle = fraction * 2 * Math.PI - Math.PI / 2;
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function arcPath(cx: number, cy: number, r: number, startFrac: number, endFrac: number, fill: string) {
  const frac = endFrac - startFrac;
  if (frac >= 1) return <circle cx={cx} cy={cy} r={r} fill={fill} />;
  const s = polarToXY(cx, cy, r, startFrac);
  const e = polarToXY(cx, cy, r, endFrac);
  const large = frac > 0.5 ? 1 : 0;
  return (
    <path
      d={`M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`}
      fill={fill}
    />
  );
}

function PieChart({ lrCount, invoiceCount }: { lrCount: number; invoiceCount: number }) {
  const total = lrCount + invoiceCount;
  if (total === 0) {
    return <div style={pie.empty}>No data yet</div>;
  }

  const lrFrac = lrCount / total;
  const cx = 80, cy = 80, r = 70;

  return (
    <div style={pie.wrapper}>
      <svg width={160} height={160} viewBox="0 0 160 160">
        {arcPath(cx, cy, r, 0, lrFrac, '#4361ee')}
        {arcPath(cx, cy, r, lrFrac, 1, '#06b6d4')}
        <circle cx={cx} cy={cy} r={30} fill="#fff" />
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize={12} fontWeight={700} fill="#333">
          {total}
        </text>
      </svg>
      <div style={pie.legend}>
        <div style={pie.legendItem}>
          <span style={{ ...pie.dot, background: '#4361ee' }} />
          LR Records&nbsp;<strong>({lrCount})</strong>
        </div>
        <div style={pie.legendItem}>
          <span style={{ ...pie.dot, background: '#06b6d4' }} />
          Invoices&nbsp;<strong>({invoiceCount})</strong>
        </div>
      </div>
    </div>
  );
}

const pie: Record<string, React.CSSProperties> = {
  wrapper: { display: 'flex', alignItems: 'center', gap: 24 },
  empty: { color: '#888', fontStyle: 'italic', padding: 16 },
  legend: { display: 'flex', flexDirection: 'column', gap: 10 },
  legendItem: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 },
  dot: { width: 14, height: 14, borderRadius: '50%', display: 'inline-block', flexShrink: 0 },
};

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function LrDashboard() {
  const [lrs, setLrs] = useState<Lr[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<LrSummary | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [editingLr, setEditingLr] = useState<Lr | null>(null);
  const [driverUploads, setDriverUploads] = useState<DriverUploadDoc[]>([]);
  const [driverUploadsTotal, setDriverUploadsTotal] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ created: number; linked: number } | null>(null);

  const LIMIT = 20;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const offset = (page - 1) * LIMIT;

      const [lrResult, summaryResult, driverResult] = await Promise.allSettled([
        lrApi.list({ limit: LIMIT, offset }),
        lrApi.summary(),
        adminDriverAccessApi.listAllUploads({ limit: 10 }),
      ]);

      if (lrResult.status === 'fulfilled') {
        setLrs(lrResult.value.data);
        setTotal(lrResult.value.total);
      } else {
        setError('Failed to load LR records');
      }

      if (summaryResult.status === 'fulfilled') {
        setSummary(summaryResult.value);
      }

      if (driverResult.status === 'fulfilled') {
        setDriverUploads(driverResult.value.uploads);
        setDriverUploadsTotal(driverResult.value.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const handleSync = async () => {
    try {
      setSyncing(true);
      setSyncResult(null);
      const result = await lrApi.syncFromDocuments();
      setSyncResult({ created: result.created, linked: result.linked });
      void fetchData();
    } catch {
      setSyncResult(null);
    } finally {
      setSyncing(false);
    }
  };

  const visibleCols = expanded ? ALL_COLUMNS : ALL_COLUMNS.slice(0, VISIBLE_COUNT);
  // +60px for the Edit action column
  const gridTemplate = visibleCols.map((c) => `${c.width}px`).join(' ') + (expanded ? ' 60px' : ' 40px 60px');
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div style={s.container}>
      <h2 style={s.heading}>📊 LR Dashboard</h2>

      {/* ── Pie chart card ─────────────────────────────────────────── */}
      <div style={s.card}>
        <div style={s.tableHeader}>
          <h3 style={{ ...s.cardTitle, margin: 0 }}>Invoices vs LR Records</h3>
          <button
            style={syncing ? s.btnSyncDisabled : s.btnSync}
            onClick={() => void handleSync()}
            disabled={syncing}
            title="Scan all uploaded LR documents and auto-create LR records from them"
          >
            {syncing ? '⏳ Syncing…' : '🔄 Sync LR Records from Uploads'}
          </button>
        </div>
        {syncResult !== null && (
          <p style={s.syncInfo}>
            {syncResult.created === 0
              ? '✅ All LR records are already up to date.'
              : `✅ Created ${syncResult.created} new LR record${syncResult.created !== 1 ? 's' : ''} and linked ${syncResult.linked} document${syncResult.linked !== 1 ? 's' : ''}.`}
          </p>
        )}
        {summary
          ? <PieChart lrCount={summary.lrCount} invoiceCount={summary.invoiceCount} />
          : <p style={{ color: '#888' }}>Loading…</p>}
      </div>

      {/* ── LR table ───────────────────────────────────────────────── */}
      <div style={s.card}>
        <div style={s.tableHeader}>
          <span style={s.cardTitle}>LR Records ({total})</span>
          <button style={s.btnRefresh} onClick={() => void fetchData()} disabled={loading}>
            🔄 Refresh
          </button>
        </div>

        {error && <p style={s.error}>{error}</p>}
        {loading && <p style={s.loading}>Loading…</p>}

        {!loading && lrs.length === 0 && (
          <p style={s.empty}>No LR records found.</p>
        )}

        {lrs.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            {/* Header row */}
            <div style={{ ...s.row, ...s.headRow, gridTemplateColumns: gridTemplate }}>
              {visibleCols.map((col) => (
                <span key={col.label} style={s.th}>{col.label}</span>
              ))}
              {!expanded && (
                <span style={s.th}>
                  <button
                    style={s.expandBtn}
                    onClick={() => setExpanded(true)}
                    title="Show all columns"
                  >
                    ▶
                  </button>
                </span>
              )}
              <span style={s.th}>Edit</span>
            </div>

            {/* Data rows */}
            {lrs.map((lr) => (
              <div key={lr.id} style={{ ...s.row, ...s.dataRow, gridTemplateColumns: gridTemplate }}>
                {visibleCols.map((col) => (
                  <span key={col.label} style={s.cell}>
                    {col.render(lr)}
                  </span>
                ))}
                {!expanded && (
                  <span style={s.cell}>
                    <button
                      style={s.expandBtn}
                      onClick={() => setExpanded(true)}
                      title="Show all columns"
                    >
                      ▶
                    </button>
                  </span>
                )}
                <span style={s.cell}>
                  <button
                    style={s.editBtn}
                    onClick={() => setEditingLr(lr)}
                    title="Edit this LR record"
                  >
                    ✏️
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        {expanded && (
          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <button style={s.collapseBtn} onClick={() => setExpanded(false)}>
              ◀ Collapse columns
            </button>
          </div>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div style={s.pagination}>
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} style={s.pageBtn}>
              ← Prev
            </button>
            <span style={s.pageInfo}>Page {page} / {pages}</span>
            <button disabled={page === pages} onClick={() => setPage((p) => p + 1)} style={s.pageBtn}>
              Next →
            </button>
          </div>
        )}
      </div>

      {/* ── Driver Uploads card ────────────────────────────────────── */}      <div style={s.card}>
        <div style={s.tableHeader}>
          <span style={s.cardTitle}>🚛 Driver Uploads ({driverUploadsTotal})</span>
          <button style={s.btnRefresh} onClick={() => void fetchData()} disabled={loading}>
            🔄 Refresh
          </button>
        </div>

        {driverUploads.length === 0 && (
          <p style={s.empty}>No driver uploads yet.</p>
        )}

        {driverUploads.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ ...s.row, ...s.headRow, gridTemplateColumns: duGrid }}>
              {duCols.map((c) => <span key={c} style={s.th}>{c}</span>)}
            </div>
            {driverUploads.map((u) => (
              <div key={u.id} style={{ ...s.row, ...s.dataRow, gridTemplateColumns: duGrid }}>
                <span style={s.cell}>{docTypeLabel(u.docType)}</span>
                <span style={s.cell}>{u.vehicleNumber ?? '—'}</span>
                <span style={s.cell}>{u.documentDate ?? '—'}</span>
                <span style={s.cell}>
                  <span style={statusStyle(u.status)}>{statusLabel(u.status)}</span>
                </span>
                <span style={s.cell}>{u.driverPhone ?? '—'}</span>
                <span style={s.cell}>{new Date(u.uploadedAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── LR Edit Modal ───────────────────────────────────────────── */}
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

// ── Driver Uploads helpers ────────────────────────────────────────────────────

const duCols = ['Doc Type', 'Vehicle No', 'Date', 'Status', 'Driver Phone', 'Uploaded At'];
const duGrid = '120px 120px 100px 100px 130px 160px';

function docTypeLabel(t: string): string {
  if (t === 'LR') return '📄 LR';
  if (t === 'TOLL') return '🛣️ Toll';
  if (t === 'WEIGHMENT_SLIP') return '⚖️ Weighment';
  return t;
}

function statusLabel(st: string): string {
  if (st === 'PROCESSED') return 'Linked';
  if (st === 'UNLINKED')  return 'Unlinked';
  return 'Processing…';
}

function statusStyle(status: string): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700,
  };
  if (status === 'PROCESSED') return { ...base, background: '#d1fae5', color: '#065f46' };
  if (status === 'UNLINKED')  return { ...base, background: '#fee2e2', color: '#991b1b' };
  return { ...base, background: '#fef9c3', color: '#854d0e' };
}

const s: Record<string, React.CSSProperties> = {
  container: { padding: '0 24px 32px' },
  heading: { fontSize: 22, fontWeight: 800, color: '#1a1a2e', marginBottom: 20 },
  card: {
    background: '#fff',
    borderRadius: 10,
    border: '1px solid #e0e0f0',
    padding: '20px 20px 16px',
    marginBottom: 24,
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  cardTitle: { fontSize: 16, fontWeight: 700, color: '#333', margin: '0 0 14px' },
  tableHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  btnRefresh: {
    padding: '6px 14px', background: '#f0f0f0', border: 'none',
    borderRadius: 6, cursor: 'pointer', fontSize: 13,
  },
  error: { color: '#e53e3e', fontSize: 13 },
  loading: { color: '#888', fontSize: 14, fontStyle: 'italic' },
  empty: { color: '#888', textAlign: 'center', padding: '24px 0' },
  row: { display: 'grid', gap: 0 },
  headRow: {
    background: '#f5f6ff',
    borderRadius: '6px 6px 0 0',
    border: '1px solid #e0e0f0',
  },
  dataRow: {
    borderLeft: '1px solid #e0e0f0',
    borderRight: '1px solid #e0e0f0',
    borderBottom: '1px solid #f0f0f8',
    background: '#fff',
    transition: 'background 0.1s',
  },
  th: {
    padding: '9px 10px',
    fontSize: 11,
    fontWeight: 700,
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  cell: {
    padding: '8px 10px',
    fontSize: 12,
    color: '#333',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  expandBtn: {
    background: '#4361ee', color: '#fff', border: 'none',
    borderRadius: 4, cursor: 'pointer', fontSize: 11,
    padding: '3px 7px', fontWeight: 700,
  },
  editBtn: {
    background: 'none', border: '1px solid #d0d0e0', borderRadius: 4,
    cursor: 'pointer', fontSize: 14, padding: '2px 6px',
    lineHeight: 1,
  },
  collapseBtn: {
    padding: '6px 16px', background: '#eee', border: 'none',
    borderRadius: 6, cursor: 'pointer', fontSize: 13, marginTop: 4,
  },
  pagination: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, justifyContent: 'center' },
  pageBtn: {
    padding: '6px 14px', background: '#eee', border: 'none',
    borderRadius: 6, cursor: 'pointer', fontSize: 13,
  },
  pageInfo: { fontSize: 13, color: '#555' },
  btnSync: {
    padding: '7px 14px', background: '#4361ee', color: '#fff', border: 'none',
    borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
  },
  btnSyncDisabled: {
    padding: '7px 14px', background: '#a0aec0', color: '#fff', border: 'none',
    borderRadius: 6, cursor: 'not-allowed', fontSize: 13, fontWeight: 600,
  },
  syncInfo: { fontSize: 13, color: '#065f46', background: '#d1fae5', borderRadius: 6, padding: '8px 12px', marginBottom: 12 },
};
