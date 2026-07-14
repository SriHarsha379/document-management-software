import React, { useEffect, useState, useCallback } from 'react';
import type { Lr, LrSummary } from '../types';
import { lrApi } from '../services/api';
import { useCurrentUser, PERM } from '../contexts/UserContext';
import { LrTable } from './LrTable';

// ── Skeleton ──────────────────────────────────────────────────────────────────
function Skeleton({ width, height = 14 }: { width?: string | number; height?: number }) {
  return (
    <div style={{
      width: width ?? '100%', height,
      borderRadius: 6,
      background: 'linear-gradient(90deg, #e0e0f0 25%, #eef0ff 50%, #e0e0f0 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }} />
  );
}

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
  return <path d={`M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`} fill={fill} />;
}

function PieChart({ lrCount, invoiceCount }: { lrCount: number; invoiceCount: number }) {
  const total = lrCount + invoiceCount;
  if (total === 0) return <div style={{ color: '#888', fontStyle: 'italic', padding: 16 }}>No data yet</div>;
  const lrFrac = lrCount / total;
  const cx = 80, cy = 80, r = 70;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
      <svg width={160} height={160} viewBox="0 0 160 160">
        {arcPath(cx, cy, r, 0, lrFrac, '#4361ee')}
        {arcPath(cx, cy, r, lrFrac, 1, '#06b6d4')}
        <circle cx={cx} cy={cy} r={30} fill="#fff" />
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize={12} fontWeight={700} fill="#333">{total}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#4361ee', display: 'inline-block', flexShrink: 0 }} />
          LR Records <strong>({lrCount})</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#06b6d4', display: 'inline-block', flexShrink: 0 }} />
          Invoices <strong>({invoiceCount})</strong>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export function LrDashboard() {
  const { hasPermission } = useCurrentUser();
  const canCreate = hasPermission(PERM.LR_CREATE);

  const [lrs, setLrs] = useState<Lr[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<LrSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ created: number; linked: number } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const LIMIT = 20;

  // Fetches fresh data from the DB and updates all state.
  const fetchData = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const offset = (page - 1) * LIMIT;
      const [lrResult, summaryResult] = await Promise.allSettled([
        lrApi.list({ limit: LIMIT, offset }),
        lrApi.summary(),
      ]);
      if (lrResult.status === 'fulfilled') { setLrs(lrResult.value.data); setTotal(lrResult.value.total); }
      else setError('Failed to load LR records');
      if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally { setLoading(false); }
  }, [page]);

  // On mount (and page change): sync first so any pending OCR LRs are created,
  // then fetch so the table always reflects the true DB state immediately.
  useEffect(() => {
    const syncThenFetch = async () => {
      if (canCreate) {
        try {
          setSyncing(true);
          const result = await lrApi.syncFromDocuments();
          // Only surface the banner when something was actually created/linked.
          if (result.created > 0 || result.linked > 0) {
            setSyncResult({ created: result.created, linked: result.linked });
          }
        } catch {
          // Silent — don't block the dashboard if sync fails on load.
        } finally {
          setSyncing(false);
        }
      }
      await fetchData();
    };
    void syncThenFetch();
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  // ↑ intentionally omit fetchData/canCreate from deps to avoid double-fire on first render.

  useEffect(() => {
    if (syncResult === null) return;
    const t = setTimeout(() => setSyncResult(null), 7000);
    return () => clearTimeout(t);
  }, [syncResult]);

  useEffect(() => {
    if (syncError === null) return;
    const t = setTimeout(() => setSyncError(null), 7000);
    return () => clearTimeout(t);
  }, [syncError]);

  // Manual sync button — same logic but shows feedback regardless of created count.
  const handleSync = async () => {
    try {
      setSyncing(true); setSyncResult(null); setSyncError(null);
      const result = await lrApi.syncFromDocuments();
      setSyncResult({ created: result.created, linked: result.linked });
      await fetchData();
    } catch { setSyncError('Sync failed. Check that a Company and Branch are configured in the admin panel.'); }
    finally { setSyncing(false); }
  };

  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div style={{ paddingBottom: 32 }}>
      {/* ── Pie chart card ───────────────────────────────────────── */}
      <div style={card}>
        <div style={tableHeader}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>Invoices vs LR Records</h3>
          {canCreate && (
            <button
              style={syncing ? btnSyncOff : btnSync}
              onClick={() => void handleSync()}
              disabled={syncing}
            >
              {syncing ? '⏳ Syncing…' : '🔄 Sync from Uploads'}
            </button>
          )}
        </div>
        {syncResult !== null && (
          <div style={syncInfo}>
            {syncResult.created === 0 && syncResult.linked === 0
              ? '✅ All LR records are already up to date.'
              : `✅ Created ${syncResult.created} new LR record${syncResult.created !== 1 ? 's' : ''} and linked ${syncResult.linked} document${syncResult.linked !== 1 ? 's' : ''}.`}
          </div>
        )}
        {syncError !== null && (
          <div style={{ ...errorBox, marginBottom: 12 }}>⚠️ {syncError}</div>
        )}
        {summary ? <PieChart lrCount={summary.lrCount} invoiceCount={summary.invoiceCount} /> : <Skeleton width={260} height={160} />}
      </div>

      {/* ── LR table ─────────────────────────────────────────────── */}
      <div style={card}>
        <div style={tableHeader}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>LR Records ({total})</span>
          <button style={btnRefresh} onClick={() => void fetchData()} disabled={loading}>
            🔄 Refresh
          </button>
        </div>

        {error && <div style={errorBox}>⚠️ {error}</div>}

        {(loading || syncing) && lrs.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
            {[1,2,3,4].map((i) => <Skeleton key={i} height={36} />)}
          </div>
        )}

        {!loading && !syncing && lrs.length === 0 && !error && (
          <div style={emptyState}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📭</div>
            <p style={{ margin: 0, color: '#6b7280' }}>No LR records found.</p>
          </div>
        )}

        {lrs.length > 0 && (
          <LrTable
            lrs={lrs}
            onLrUpdated={(updated) => setLrs((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))}
          />
        )}

        {pages > 1 && (
          <div style={pagination}>
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} style={pageBtn}>← Prev</button>
            <span style={{ fontSize: 13, color: '#555' }}>Page {page} / {pages}</span>
            <button disabled={page === pages} onClick={() => setPage((p) => p + 1)} style={pageBtn}>Next →</button>
          </div>
        )}
      </div>

    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: '#fff', borderRadius: 12, border: '1px solid #e0e0f0',
  padding: '20px', marginBottom: 20,
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
};
const tableHeader: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14,
};
const btnRefresh: React.CSSProperties = {
  padding: '6px 14px', background: '#f0f0f8', border: '1px solid #e0e0f0',
  borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#4361ee',
};
const errorBox: React.CSSProperties = {
  background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
  padding: '10px 14px', color: '#b91c1c', fontSize: 13, marginBottom: 12,
};
const emptyState: React.CSSProperties = { textAlign: 'center', padding: '32px 0', color: '#888' };
const pagination: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, justifyContent: 'center',
};
const pageBtn: React.CSSProperties = {
  padding: '6px 14px', background: '#eef0ff', border: '1px solid #c0c8ff',
  borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#4361ee', fontWeight: 500,
};
const btnSync: React.CSSProperties = {
  padding: '7px 14px', background: '#4361ee', color: '#fff', border: 'none',
  borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600,
  boxShadow: '0 2px 8px rgba(67,97,238,0.25)',
};
const btnSyncOff: React.CSSProperties = {
  ...btnSync, background: '#a0aec0', cursor: 'not-allowed', boxShadow: 'none',
};
const syncInfo: React.CSSProperties = {
  fontSize: 13, color: '#065f46', background: '#d1fae5',
  borderRadius: 7, padding: '8px 12px', marginBottom: 12,
};
