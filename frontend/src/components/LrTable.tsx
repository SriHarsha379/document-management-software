import React, { useState } from 'react';
import type { Lr } from '../types';
import { LrEditModal } from './LrEditModal';
import { useCurrentUser, PERM } from '../contexts/UserContext';

// ── Column definitions ────────────────────────────────────────────────────────

interface Col {
  label: string;
  render: (lr: Lr) => React.ReactNode;
  width: number;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
  return value;
}

export const LR_COLUMNS: Col[] = [
  { label: 'S.No',            width: 60,  render: (lr) => lr.serialNo ?? '—' },
  { label: 'Principal Co.',   width: 130, render: (lr) => lr.principalCompany ?? '—' },
  { label: 'Branch',          width: 110, render: (lr) => lr.branch?.name ?? '—' },
  { label: 'Source',          width: 90,  render: (lr) => lr.source },
  { label: 'LR Date',         width: 100, render: (lr) => formatDate(lr.lrDate ?? lr.date) },
  { label: 'LR No',           width: 100, render: (lr) => lr.lrNo },
  { label: 'Loading Slip No', width: 120, render: (lr) => lr.loadingSlipNo ?? '—' },
  { label: 'Inv. Date',       width: 100, render: (lr) => lr.companyInvoiceDate ?? '—' },
  { label: 'Inv. No',         width: 110, render: (lr) => lr.companyInvoiceNo ?? '—' },
  { label: 'E-Way Bill No',   width: 120, render: (lr) => lr.companyEwayBillNo ?? '—' },
  { label: 'Bill To Party',   width: 130, render: (lr) => lr.billToParty ?? '—' },
  { label: 'Ship To Party',   width: 130, render: (lr) => lr.shipToParty ?? '—' },
  { label: 'Delivery Dest.',  width: 130, render: (lr) => lr.deliveryDestination ?? '—' },
  { label: 'TPT',             width: 90,  render: (lr) => lr.tpt ?? '—' },
  { label: 'Order Type',      width: 100, render: (lr) => lr.orderType ?? '—' },
  { label: 'Product',         width: 120, render: (lr) => lr.productName ?? '—' },
  { label: 'Vehicle No',      width: 110, render: (lr) => lr.vehicleNo ?? '—' },
  { label: 'Qty (Bags)',      width: 90,  render: (lr) => lr.quantityInBags ?? '—' },
  { label: 'Qty (MT)',        width: 80,  render: (lr) => lr.quantityInMt ?? '—' },
  { label: 'TPT Code',        width: 90,  render: (lr) => lr.tptCode ?? '—' },
  { label: 'Transporter',     width: 130, render: (lr) => lr.transporterName ?? '—' },
  { label: 'Driver',          width: 110, render: (lr) => lr.driverName ?? '—' },
  { label: 'Driver Bill No',  width: 110, render: (lr) => lr.driverBillNo ?? '—' },
  { label: 'Bill Date',       width: 100, render: (lr) => lr.billDate ?? '—' },
  { label: 'Bill No',         width: 100, render: (lr) => lr.billNo ?? '—' },
  { label: 'Bill Amount ₹',  width: 110, render: (lr) => lr.billAmount ?? '—' },
];

const VISIBLE_COUNT = 15;

// ── Component ─────────────────────────────────────────────────────────────────

interface LrTableProps {
  lrs: Lr[];
  onLrUpdated?: (updated: Lr) => void;
}

export function LrTable({ lrs, onLrUpdated }: LrTableProps) {
  const { hasPermission } = useCurrentUser();
  const canUpdate = hasPermission(PERM.LR_UPDATE);
  const [expanded, setExpanded] = useState(false);
  const [editingLr, setEditingLr] = useState<Lr | null>(null);

  const visibleCols = expanded ? LR_COLUMNS : LR_COLUMNS.slice(0, VISIBLE_COUNT);
  const editColSuffix = canUpdate ? ' 60px' : '';
  const gridTemplate =
    visibleCols.map((c) => `${c.width}px`).join(' ') +
    (expanded ? editColSuffix : ` 40px${editColSuffix}`);

  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 'max-content' }}>
          <div style={{ ...gridRow, ...headRow, gridTemplateColumns: gridTemplate }}>
            {visibleCols.map((col) => (
              <span key={col.label} style={th}>{col.label}</span>
            ))}
            {!expanded && (
              <span style={th}>
                <button style={expandBtn} onClick={() => setExpanded(true)} title="Show all">▶</button>
              </span>
            )}
            {canUpdate && <span style={th}>Edit</span>}
          </div>

          {lrs.map((lr) => (
            <div
              key={lr.id}
              style={{ ...gridRow, ...dataRow, gridTemplateColumns: gridTemplate }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#fafafe'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#fff'; }}
            >
              {visibleCols.map((col) => (
                <span key={col.label} style={cell}>{col.render(lr)}</span>
              ))}
              {!expanded && (
                <span style={cell}>
                  <button style={expandBtn} onClick={() => setExpanded(true)}>▶</button>
                </span>
              )}
              {canUpdate && (
                <span style={cell}>
                  <button style={editBtn} onClick={() => setEditingLr(lr)} title="Edit">✏️</button>
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {expanded && (
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <button style={collapseBtn} onClick={() => setExpanded(false)}>◀ Collapse columns</button>
        </div>
      )}

      {editingLr && (
        <LrEditModal
          lr={editingLr}
          onSaved={(updated) => {
            onLrUpdated?.(updated);
            setEditingLr(null);
          }}
          onCancel={() => setEditingLr(null)}
        />
      )}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const gridRow: React.CSSProperties = { display: 'grid', gap: 0 };
const headRow: React.CSSProperties = {
  background: '#f5f6ff', borderRadius: '6px 6px 0 0', border: '1px solid #e0e0f0',
};
const dataRow: React.CSSProperties = {
  borderLeft: '1px solid #e0e0f0', borderRight: '1px solid #e0e0f0',
  borderBottom: '1px solid #f0f0f8', background: '#fff', transition: 'background 0.1s',
};
const th: React.CSSProperties = {
  padding: '9px 10px', fontSize: 11, fontWeight: 700, color: '#555',
  textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
  overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left',
};
const cell: React.CSSProperties = {
  padding: '8px 10px', fontSize: 12, color: '#333',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
const expandBtn: React.CSSProperties = {
  background: '#4361ee', color: '#fff', border: 'none',
  borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '3px 7px', fontWeight: 700,
};
const editBtn: React.CSSProperties = {
  background: 'none', border: '1px solid #d0d0e0', borderRadius: 4,
  cursor: 'pointer', fontSize: 14, padding: '2px 6px', lineHeight: 1,
};
const collapseBtn: React.CSSProperties = {
  padding: '6px 16px', background: '#f0f0f8', border: 'none',
  borderRadius: 6, cursor: 'pointer', fontSize: 13, marginTop: 4, color: '#4361ee',
};
