import { useEffect, useState } from 'react';
import type { LrSummary } from '../types';
import { lrApi } from '../services/api';
import { LrRecordsDetails } from './LrRecordsDetails';

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

// ── Summary Card ──────────────────────────────────────────────────────────────
interface SummaryCardProps {
  title: string;
  count: number | null;
  icon: string;
  color: string;
  bgColor: string;
  subtitle: string;
}

function SummaryCard({ title, count, icon, color, bgColor, subtitle }: SummaryCardProps) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 12,
      border: '1px solid #e0e0f0',
      padding: '20px 24px',
      flex: '1 1 200px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      display: 'flex',
      alignItems: 'center',
      gap: 18,
      minWidth: 200,
    }}>
      <div style={{
        width: 52, height: 52, borderRadius: 12,
        background: bgColor,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 24, flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
          {title}
        </div>
        {count === null ? (
          <Skeleton width={60} height={28} />
        ) : (
          <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>
            {count.toLocaleString()}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>{subtitle}</div>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export function LrDashboard() {
  const [summary, setSummary] = useState<LrSummary | null>(null);
  const [tableRefreshKey] = useState(0);

  useEffect(() => {
    lrApi.summary().then(setSummary).catch(() => {});
  }, []);

  return (
    <div style={{ paddingBottom: 32 }}>
      {/* ── Summary Cards ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <SummaryCard
          title="Generated LR"
          count={summary?.generatedLrCount ?? null}
          icon="🚛"
          color="#2563eb"
          bgColor="#dbeafe"
          subtitle="Generated LR records available in DMS"
        />
        <SummaryCard
          title="Generated Invoices"
          count={summary?.generatedInvoiceCount ?? null}
          icon="🧾"
          color="#0f766e"
          bgColor="#ccfbf1"
          subtitle="Generated invoice records available in DMS"
        />
        <SummaryCard
          title="Acknowledged LR"
          count={summary?.acknowledgedLrCount ?? null}
          icon="📋"
          color="#4361ee"
          bgColor="#eef0ff"
          subtitle="LR documents with stamp + signature"
        />
        <SummaryCard
          title="Acknowledged Invoices"
          count={summary?.acknowledgedInvoiceCount ?? null}
          icon="🧾"
          color="#059669"
          bgColor="#d1fae5"
          subtitle="Invoice documents with stamp + signature"
        />
        <SummaryCard
          title="Total Uploaded Documents"
          count={summary?.totalUploadedDocuments ?? null}
          icon="📂"
          color="#7c3aed"
          bgColor="#ede9fe"
          subtitle="All uploaded documents"
        />
      </div>

      {/* ── LR Records Details ───────────────────────────────────────── */}
      <LrRecordsDetails refreshTrigger={tableRefreshKey} />
    </div>
  );
}
