import React, { useState } from 'react';
import type { Lr } from '../types';
import { lrApi } from '../services/api';

interface Props {
  lr: Lr;
  onSaved: (updated: Lr) => void;
  onCancel: () => void;
}

type FormData = {
  lrNo: string;
  lrDate: string;
  loadingSlipNo: string;
  principalCompany: string;
  companyInvoiceDate: string;
  companyInvoiceNo: string;
  companyEwayBillNo: string;
  billToParty: string;
  shipToParty: string;
  deliveryDestination: string;
  tpt: string;
  orderType: string;
  productName: string;
  vehicleNo: string;
  quantityInBags: string;
  quantityInMt: string;
  tollCharges: string;
  weighmentCharges: string;
  unloadingAtSite: string;
  driverBhatta: string;
  dayOpeningKm: string;
  dayClosingKm: string;
  totalRunningKm: string;
  fuelPerKm: string;
  fuelAmount: string;
  grandTotal: string;
  tptCode: string;
  transporterName: string;
  driverName: string;
  driverBillNo: string;
  billDate: string;
  billNo: string;
  billAmount: string;
};

function toStr(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

export function LrEditModal({ lr, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<FormData>({
    lrNo:               toStr(lr.lrNo),
    lrDate:             toStr(lr.lrDate),
    loadingSlipNo:      toStr(lr.loadingSlipNo),
    principalCompany:   toStr(lr.principalCompany),
    companyInvoiceDate: toStr(lr.companyInvoiceDate),
    companyInvoiceNo:   toStr(lr.companyInvoiceNo),
    companyEwayBillNo:  toStr(lr.companyEwayBillNo),
    billToParty:        toStr(lr.billToParty),
    shipToParty:        toStr(lr.shipToParty),
    deliveryDestination: toStr(lr.deliveryDestination),
    tpt:                toStr(lr.tpt),
    orderType:          toStr(lr.orderType),
    productName:        toStr(lr.productName),
    vehicleNo:          toStr(lr.vehicleNo),
    quantityInBags:     toStr(lr.quantityInBags),
    quantityInMt:       toStr(lr.quantityInMt),
    tollCharges:        toStr(lr.tollCharges),
    weighmentCharges:   toStr(lr.weighmentCharges),
    unloadingAtSite:    toStr(lr.unloadingAtSite),
    driverBhatta:       toStr(lr.driverBhatta),
    dayOpeningKm:       toStr(lr.dayOpeningKm),
    dayClosingKm:       toStr(lr.dayClosingKm),
    totalRunningKm:     toStr(lr.totalRunningKm),
    fuelPerKm:          toStr(lr.fuelPerKm),
    fuelAmount:         toStr(lr.fuelAmount),
    grandTotal:         toStr(lr.grandTotal),
    tptCode:            toStr(lr.tptCode),
    transporterName:    toStr(lr.transporterName),
    driverName:         toStr(lr.driverName),
    driverBillNo:       toStr(lr.driverBillNo),
    billDate:           toStr(lr.billDate),
    billNo:             toStr(lr.billNo),
    billAmount:         toStr(lr.billAmount),
  });

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const set = (field: keyof FormData, value: string) =>
    setForm((prev: FormData) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      const updated = await lrApi.update(lr.id, {
        lrNo:               form.lrNo.trim() || undefined,
        lrDate:             form.lrDate.trim() || undefined,
        loadingSlipNo:      form.loadingSlipNo.trim() || undefined,
        principalCompany:   form.principalCompany.trim() || undefined,
        companyInvoiceDate: form.companyInvoiceDate.trim() || undefined,
        companyInvoiceNo:   form.companyInvoiceNo.trim() || undefined,
        companyEwayBillNo:  form.companyEwayBillNo.trim() || undefined,
        billToParty:        form.billToParty.trim() || undefined,
        shipToParty:        form.shipToParty.trim() || undefined,
        deliveryDestination: form.deliveryDestination.trim() || undefined,
        tpt:                form.tpt.trim() || undefined,
        orderType:          form.orderType.trim() || undefined,
        productName:        form.productName.trim() || undefined,
        vehicleNo:          form.vehicleNo.trim() || undefined,
        quantityInBags:     form.quantityInBags !== '' ? (Number(form.quantityInBags) as never) : undefined,
        quantityInMt:       form.quantityInMt !== ''   ? (Number(form.quantityInMt) as never)   : undefined,
        tollCharges:        form.tollCharges !== ''    ? (Number(form.tollCharges) as never)    : undefined,
        weighmentCharges:   form.weighmentCharges !== '' ? (Number(form.weighmentCharges) as never) : undefined,
        unloadingAtSite:    form.unloadingAtSite !== '' ? (Number(form.unloadingAtSite) as never) : undefined,
        driverBhatta:       form.driverBhatta !== ''   ? (Number(form.driverBhatta) as never)   : undefined,
        dayOpeningKm:       form.dayOpeningKm !== ''   ? (Number(form.dayOpeningKm) as never)   : undefined,
        dayClosingKm:       form.dayClosingKm !== ''   ? (Number(form.dayClosingKm) as never)   : undefined,
        totalRunningKm:     form.totalRunningKm !== '' ? (Number(form.totalRunningKm) as never) : undefined,
        fuelPerKm:          form.fuelPerKm !== ''      ? (Number(form.fuelPerKm) as never)      : undefined,
        fuelAmount:         form.fuelAmount !== ''     ? (Number(form.fuelAmount) as never)     : undefined,
        grandTotal:         form.grandTotal !== ''     ? (Number(form.grandTotal) as never)     : undefined,
        tptCode:            form.tptCode.trim() || undefined,
        transporterName:    form.transporterName.trim() || undefined,
        driverName:         form.driverName.trim() || undefined,
        driverBillNo:       form.driverBillNo.trim() || undefined,
        billDate:           form.billDate.trim() || undefined,
        billNo:             form.billNo.trim() || undefined,
        billAmount:         form.billAmount !== ''     ? (Number(form.billAmount) as never)     : undefined,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={m.overlay} onClick={(e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={m.modal}>
        <div style={m.header}>
          <h3 style={m.title}>✏️ Edit LR Record</h3>
          <button style={m.closeBtn} onClick={onCancel} title="Close">✕</button>
        </div>

        <div style={m.body}>
          <Section title="Basic Info">
            <Row>
              <Field label="LR No ✱"      value={form.lrNo}    onChange={(v) => set('lrNo', v)} />
              <Field label="LR Date"       value={form.lrDate}  onChange={(v) => set('lrDate', v)}  placeholder="YYYY-MM-DD" />
            </Row>
            <Row>
              <Field label="Principal Company" value={form.principalCompany} onChange={(v) => set('principalCompany', v)} />
              <Field label="Loading Slip No"   value={form.loadingSlipNo}    onChange={(v) => set('loadingSlipNo', v)} />
            </Row>
          </Section>

          <Section title="Invoice / E-Way Bill">
            <Row>
              <Field label="Invoice Date" value={form.companyInvoiceDate} onChange={(v) => set('companyInvoiceDate', v)} placeholder="YYYY-MM-DD" />
              <Field label="Invoice No"   value={form.companyInvoiceNo}   onChange={(v) => set('companyInvoiceNo', v)} />
            </Row>
            <Row>
              <Field label="E-Way Bill No" value={form.companyEwayBillNo} onChange={(v) => set('companyEwayBillNo', v)} />
            </Row>
          </Section>

          <Section title="Parties &amp; Destination">
            <Row>
              <Field label="Bill To Party"  value={form.billToParty}  onChange={(v) => set('billToParty', v)} />
              <Field label="Ship To Party"  value={form.shipToParty}  onChange={(v) => set('shipToParty', v)} />
            </Row>
            <Row>
              <Field label="Delivery Destination" value={form.deliveryDestination} onChange={(v) => set('deliveryDestination', v)} />
              <Field label="Order Type"            value={form.orderType}           onChange={(v) => set('orderType', v)} />
            </Row>
          </Section>

          <Section title="Transport">
            <Row>
              <Field label="TPT"             value={form.tpt}             onChange={(v) => set('tpt', v)} />
              <Field label="TPT Code"        value={form.tptCode}         onChange={(v) => set('tptCode', v)} />
            </Row>
            <Row>
              <Field label="Transporter"     value={form.transporterName} onChange={(v) => set('transporterName', v)} />
              <Field label="Vehicle No"      value={form.vehicleNo}       onChange={(v) => set('vehicleNo', v)} />
            </Row>
          </Section>

          <Section title="Product &amp; Quantity">
            <Row>
              <Field label="Product Name"  value={form.productName}    onChange={(v) => set('productName', v)} />
              <Field label="Qty (Bags)"    value={form.quantityInBags} onChange={(v) => set('quantityInBags', v)} type="number" />
            </Row>
            <Row>
              <Field label="Qty (MT)"      value={form.quantityInMt}   onChange={(v) => set('quantityInMt', v)} type="number" />
            </Row>
          </Section>

          <Section title="Charges (₹)">
            <Row>
              <Field label="Toll"          value={form.tollCharges}      onChange={(v) => set('tollCharges', v)}      type="number" />
              <Field label="Weighment"     value={form.weighmentCharges} onChange={(v) => set('weighmentCharges', v)} type="number" />
            </Row>
            <Row>
              <Field label="Unloading"     value={form.unloadingAtSite}  onChange={(v) => set('unloadingAtSite', v)}  type="number" />
              <Field label="Driver Bhatta" value={form.driverBhatta}     onChange={(v) => set('driverBhatta', v)}     type="number" />
            </Row>
            <Row>
              <Field label="Fuel/KM"       value={form.fuelPerKm}        onChange={(v) => set('fuelPerKm', v)}        type="number" />
              <Field label="Fuel Amount"   value={form.fuelAmount}       onChange={(v) => set('fuelAmount', v)}       type="number" />
            </Row>
            <Row>
              <Field label="Grand Total"   value={form.grandTotal}       onChange={(v) => set('grandTotal', v)}       type="number" />
            </Row>
          </Section>

          <Section title="KM Readings">
            <Row>
              <Field label="Open KM"   value={form.dayOpeningKm}   onChange={(v) => set('dayOpeningKm', v)}   type="number" />
              <Field label="Close KM"  value={form.dayClosingKm}   onChange={(v) => set('dayClosingKm', v)}   type="number" />
            </Row>
            <Row>
              <Field label="Total KM"  value={form.totalRunningKm} onChange={(v) => set('totalRunningKm', v)} type="number" />
            </Row>
          </Section>

          <Section title="Driver &amp; Bill">
            <Row>
              <Field label="Driver Name"    value={form.driverName}   onChange={(v) => set('driverName', v)} />
              <Field label="Driver Bill No" value={form.driverBillNo} onChange={(v) => set('driverBillNo', v)} />
            </Row>
            <Row>
              <Field label="Bill Date"   value={form.billDate}   onChange={(v) => set('billDate', v)}   placeholder="YYYY-MM-DD" />
              <Field label="Bill No"     value={form.billNo}     onChange={(v) => set('billNo', v)} />
            </Row>
            <Row>
              <Field label="Bill Amount" value={form.billAmount} onChange={(v) => set('billAmount', v)} type="number" />
            </Row>
          </Section>
        </div>

        {error && <p style={m.error}>{error}</p>}

        <div style={m.footer}>
          <button style={m.btnSecondary} onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button style={saving ? m.btnPrimaryDisabled : m.btnPrimary} onClick={() => void handleSave()} disabled={saving}>
            {saving ? '💾 Saving…' : '✅ Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={m.section}>
      <div style={m.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={m.row}>{children}</div>;
}

function Field({
  label, value, onChange, placeholder, type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div style={m.fieldGroup}>
      <label style={m.label}>{label}</label>
      <input
        style={m.input}
        type={type ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? ''}
      />
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const m: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#fff', borderRadius: 10, width: '90%', maxWidth: 780,
    maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px', borderBottom: '1px solid #e0e0f0',
  },
  title: { margin: 0, fontSize: 17, fontWeight: 700, color: '#1a1a2e' },
  closeBtn: {
    background: 'none', border: 'none', fontSize: 18, cursor: 'pointer',
    color: '#888', lineHeight: 1, padding: '2px 6px',
  },
  body: { padding: '16px 20px', overflowY: 'auto', flex: 1 },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 11, fontWeight: 700, color: '#4361ee',
    textTransform: 'uppercase', letterSpacing: '0.06em',
    marginBottom: 8, borderBottom: '1px solid #e8eaff', paddingBottom: 4,
  },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' },
  fieldGroup: { marginBottom: 10 },
  label: {
    display: 'block', fontSize: 11, fontWeight: 600, color: '#555',
    marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em',
  },
  input: {
    width: '100%', padding: '7px 10px', border: '1px solid #d0d0e0',
    borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
  },
  error: { color: '#e53e3e', fontSize: 13, margin: '0 20px 8px' },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 10,
    padding: '12px 20px', borderTop: '1px solid #e0e0f0',
  },
  btnPrimary: {
    padding: '9px 20px', background: '#4361ee', color: '#fff', border: 'none',
    borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14,
  },
  btnPrimaryDisabled: {
    padding: '9px 20px', background: '#a0aec0', color: '#fff', border: 'none',
    borderRadius: 6, cursor: 'not-allowed', fontWeight: 600, fontSize: 14,
  },
  btnSecondary: {
    padding: '9px 16px', background: '#eee', color: '#444', border: 'none',
    borderRadius: 6, cursor: 'pointer', fontSize: 14,
  },
};
