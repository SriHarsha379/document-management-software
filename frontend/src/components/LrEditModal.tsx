import React, { useState, useEffect } from 'react';
import type { Lr, Document } from '../types';
import { lrApi } from '../services/api';

interface Props {
  lr: Lr;
  onSaved: (updated: Lr) => void;
  onCancel: () => void;
  /** Optional OCR source document. When provided, extracted fields are used to
   *  auto-populate the form. Source and Branch are determined automatically when
   *  confidence meets the threshold; otherwise they fall back to dropdown selection. */
  ocrDocument?: Document;
}

type FormData = {
  branchId: string;
  source: string;
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
};

function toStr(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function toNum(v: string): number | undefined {
  if (v === '') return undefined;
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}

const ALLOWED_SOURCES = ['INTERNAL', 'PORTAL', 'API', 'EMAIL_IMPORT'] as const;

/** Minimum confidence score required to auto-fill Source or Branch without user input. */
const OCR_CONFIDENCE_THRESHOLD = 0.75;

/**
 * Determines whether a raw OCR string matches one of the allowed LR source values.
 * Returns the matched source value and a confidence score (0–1).
 */
function computeSourceConfidence(
  raw: string | null | undefined,
): { value: string; confidence: number } {
  if (!raw) return { value: '', confidence: 0 };
  const norm = raw.trim().toUpperCase();
  if ((ALLOWED_SOURCES as readonly string[]).includes(norm)) {
    return { value: norm, confidence: 1.0 };
  }
  // Partial match: the OCR value must contain the allowed source string (not the reverse),
  // and must be at least 3 characters to avoid trivially short false-positive matches.
  if (norm.length >= 3) {
    const partial = ALLOWED_SOURCES.find((s) => norm.includes(s));
    if (partial) return { value: partial, confidence: 0.7 };
  }
  return { value: '', confidence: 0 };
}

/**
 * Matches a branch name string extracted by OCR against the loaded branch list.
 * Returns the best-matching branch id and a confidence score (0–1).
 */
function computeBranchConfidence(
  raw: string | null | undefined,
  branches: { id: string; name: string }[],
): { id: string; confidence: number } {
  if (!raw || !branches.length) return { id: '', confidence: 0 };
  const norm = raw.trim().toLowerCase();
  const exact = branches.find((b) => b.name.toLowerCase() === norm);
  if (exact) return { id: exact.id, confidence: 1.0 };
  // Substring match: require the shorter string to be at least 4 characters so that
  // very short OCR tokens do not accidentally match unrelated branch names.
  if (norm.length >= 4) {
    const contains = branches.find((b) => {
      const bNorm = b.name.toLowerCase();
      return bNorm.includes(norm) || norm.includes(bNorm);
    });
    if (contains) return { id: contains.id, confidence: 0.7 };
  }
  return { id: '', confidence: 0 };
}

export function LrEditModal({ lr, onSaved, onCancel, ocrDocument }: Props) {
  const [form, setForm] = useState<FormData>({
    branchId:           toStr(lr.branchId),
    source:             toStr(lr.source),
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
  });

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);

  // ── OCR auto-population state ─────────────────────────────────────────────
  /** Fields that could not be confidently extracted from OCR and need user review. */
  const [lowConfidenceFields, setLowConfidenceFields] = useState<Set<keyof FormData>>(new Set());
  /** Confidence score (0–1) for the auto-detected Source value. */
  const [sourceConfidence, setSourceConfidence] = useState<number>(ocrDocument ? 0 : 1);
  /** Confidence score (0–1) for the auto-detected Branch value. */
  const [branchConfidence, setBranchConfidence] = useState<number>(ocrDocument ? 0 : 1);
  /** When true the user has chosen to manually pick Source via dropdown. */
  const [manualSourceEdit, setManualSourceEdit] = useState(false);
  /** When true the user has chosen to manually pick Branch via dropdown. */
  const [manualBranchEdit, setManualBranchEdit] = useState(false);
  /** Becomes true once OCR extraction has been applied (prevents double-application). */
  const [ocrApplied, setOcrApplied] = useState(false);

  useEffect(() => {
    lrApi.branches()
      .then(setBranches)
      .catch(() => setError('Unable to load branches. Please close and reopen the form.'));
  }, []);

  // Apply OCR-extracted data once branches are available.
  useEffect(() => {
    if (!ocrDocument?.extractedData || !branches.length || ocrApplied) return;

    const ed = ocrDocument.extractedData;

    // ── Source confidence ─────────────────────────────────────────────────
    const srcResult = computeSourceConfidence(ed.source);
    setSourceConfidence(srcResult.confidence);

    // ── Branch confidence ─────────────────────────────────────────────────
    const branchResult = computeBranchConfidence(ed.branchName, branches);
    setBranchConfidence(branchResult.confidence);

    // ── Build extracted values for each form field ────────────────────────
    const extracted: Partial<Record<keyof FormData, string>> = {};

    if (ed.lrNo)              extracted.lrNo               = ed.lrNo;
    if (ed.date)              extracted.lrDate              = ed.date;
    if (ed.invoiceNo)         extracted.companyInvoiceNo    = ed.invoiceNo;
    if (ed.vehicleNo)         extracted.vehicleNo           = ed.vehicleNo;
    if (ed.principalCompany)  extracted.principalCompany    = ed.principalCompany;
    if (ed.orderType)         extracted.orderType           = ed.orderType;
    if (ed.tptCode)           extracted.tptCode             = ed.tptCode;
    if (ed.driverName)        extracted.driverName          = ed.driverName;
    if (ed.quantityInMt != null && isFinite(ed.quantityInMt))   extracted.quantityInMt   = String(ed.quantityInMt);
    if (ed.quantityInBags != null && isFinite(ed.quantityInBags)) extracted.quantityInBags = String(ed.quantityInBags);
    if (ed.partyNames?.[0])   extracted.billToParty         = ed.partyNames[0];
    if (ed.partyNames?.[1])   extracted.shipToParty         = ed.partyNames[1];

    // Toll amount: strip non-numeric prefix (e.g. "₹ 200" → "200")
    if (ed.tollAmount) {
      const parsed = parseFloat(ed.tollAmount.replace(/[^0-9.]/g, ''));
      if (!isNaN(parsed)) extracted.tollCharges = String(parsed);
    }

    // Auto-fill high-confidence Source / Branch
    if (srcResult.confidence >= OCR_CONFIDENCE_THRESHOLD && srcResult.value) {
      extracted.source   = srcResult.value;
    }
    if (branchResult.confidence >= OCR_CONFIDENCE_THRESHOLD && branchResult.id) {
      extracted.branchId = branchResult.id;
    }

    // Only fill fields that are currently empty so manual edits are preserved.
    setForm((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(extracted) as (keyof FormData)[]) {
        if (!prev[key] && extracted[key]) {
          (next as Record<string, string>)[key] = extracted[key]!;
        }
      }
      return next;
    });

    // ── Track fields that are missing after OCR extraction ───────────────────
    // A field is marked low-confidence only when no value could be extracted,
    // regardless of overall document confidence. This avoids falsely highlighting
    // fields that were successfully extracted but belong to a lower-quality scan.
    const ocrCandidates: (keyof FormData)[] = [
      'lrNo', 'lrDate', 'companyInvoiceNo', 'vehicleNo',
      'principalCompany', 'orderType', 'tptCode', 'driverName',
      'quantityInMt', 'quantityInBags', 'billToParty', 'shipToParty',
      'tollCharges',
    ];
    const lowFields = new Set<keyof FormData>();
    for (const field of ocrCandidates) {
      if (!extracted[field]) lowFields.add(field);
    }
    // Also highlight Source/Branch if their confidence fell below the threshold.
    if (srcResult.confidence < OCR_CONFIDENCE_THRESHOLD) lowFields.add('source');
    if (branchResult.confidence < OCR_CONFIDENCE_THRESHOLD) lowFields.add('branchId');
    setLowConfidenceFields(lowFields);
    setOcrApplied(true);
  }, [ocrDocument, branches, ocrApplied]);

  const set = (field: keyof FormData, value: string) =>
    setForm((prev: FormData) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      if (!form.branchId) {
        setError('Branch is required');
        return;
      }
      if (!form.source) {
        setError('Source is required');
        return;
      }
      const currentBranchId = toStr(lr.branchId).trim();
      const branchIdForUpdate =
        form.branchId !== currentBranchId ? form.branchId : undefined;
      const updated = await lrApi.update(lr.id, {
        branchId:           branchIdForUpdate,
        lrNo:               form.lrNo.trim() || undefined,
        source:             form.source,
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
        quantityInBags:     toNum(form.quantityInBags),
        quantityInMt:       toNum(form.quantityInMt),
        tollCharges:        toNum(form.tollCharges),
        weighmentCharges:   toNum(form.weighmentCharges),
        unloadingAtSite:    toNum(form.unloadingAtSite),
        driverBhatta:       toNum(form.driverBhatta),
        dayOpeningKm:       toNum(form.dayOpeningKm),
        dayClosingKm:       toNum(form.dayClosingKm),
        totalRunningKm:     toNum(form.totalRunningKm),
        fuelPerKm:          toNum(form.fuelPerKm),
        fuelAmount:         toNum(form.fuelAmount),
        grandTotal:         toNum(form.grandTotal),
        tptCode:            form.tptCode.trim() || undefined,
        transporterName:    form.transporterName.trim() || undefined,
        driverName:         form.driverName.trim() || undefined,
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
          {/* OCR info banner */}
          {ocrDocument && ocrApplied && (
            <div style={m.ocrBanner}>
              🤖 <strong>OCR auto-populated</strong> — Fields highlighted in{' '}
              <span style={{ color: '#d97706', fontWeight: 700 }}>amber</span> could not be
              confidently extracted and require your review.
            </div>
          )}

          <Section title="Basic Info">
            <Row>
              <Field label="LR No ✱"      value={form.lrNo}    onChange={(v) => set('lrNo', v)}  highlight={lowConfidenceFields.has('lrNo')} />
              <Field label="LR Date"       value={form.lrDate}  onChange={(v) => set('lrDate', v)} placeholder="YYYY-MM-DD" highlight={lowConfidenceFields.has('lrDate')} />
            </Row>
            <Row>
              {/* Branch — auto-detected when confidence is high; dropdown otherwise */}
              {ocrDocument && branchConfidence >= OCR_CONFIDENCE_THRESHOLD && !manualBranchEdit ? (
                <AutoDetectedField
                  label="Branch"
                  value={branches.find((b) => b.id === form.branchId)?.name ?? form.branchId}
                  confidence={branchConfidence}
                  onEdit={() => setManualBranchEdit(true)}
                />
              ) : (
                <SelectField
                  label="Branch"
                  value={form.branchId}
                  onChange={(v) => set('branchId', v)}
                  options={branches.map((b) => ({ value: b.id, label: b.name }))}
                  placeholder="— select branch —"
                  highlight={lowConfidenceFields.has('branchId')}
                />
              )}

              {/* Source — auto-detected when confidence is high; dropdown otherwise */}
              {ocrDocument && sourceConfidence >= OCR_CONFIDENCE_THRESHOLD && !manualSourceEdit ? (
                <AutoDetectedField
                  label="Source"
                  value={form.source}
                  confidence={sourceConfidence}
                  onEdit={() => setManualSourceEdit(true)}
                />
              ) : (
                <SelectField
                  label="Source"
                  value={form.source}
                  onChange={(v) => set('source', v)}
                  options={ALLOWED_SOURCES.map((s) => ({ value: s, label: s }))}
                  placeholder="— select source —"
                  highlight={lowConfidenceFields.has('source')}
                />
              )}
            </Row>
            <Row>
              <Field label="Principal Company" value={form.principalCompany} onChange={(v) => set('principalCompany', v)} highlight={lowConfidenceFields.has('principalCompany')} />
              <Field label="Loading Slip No"   value={form.loadingSlipNo}    onChange={(v) => set('loadingSlipNo', v)} />
            </Row>
          </Section>

          <Section title="Invoice / E-Way Bill">
            <Row>
              <Field label="Invoice Date" value={form.companyInvoiceDate} onChange={(v) => set('companyInvoiceDate', v)} placeholder="YYYY-MM-DD" />
              <Field label="Invoice No"   value={form.companyInvoiceNo}   onChange={(v) => set('companyInvoiceNo', v)} highlight={lowConfidenceFields.has('companyInvoiceNo')} />
            </Row>
            <Row>
              <Field label="E-Way Bill No" value={form.companyEwayBillNo} onChange={(v) => set('companyEwayBillNo', v)} />
            </Row>
          </Section>

          <Section title="Parties &amp; Destination">
            <Row>
              <Field label="Bill To Party"  value={form.billToParty}  onChange={(v) => set('billToParty', v)}  highlight={lowConfidenceFields.has('billToParty')} />
              <Field label="Ship To Party"  value={form.shipToParty}  onChange={(v) => set('shipToParty', v)}  highlight={lowConfidenceFields.has('shipToParty')} />
            </Row>
            <Row>
              <Field label="Delivery Destination" value={form.deliveryDestination} onChange={(v) => set('deliveryDestination', v)} />
              <Field label="Order Type"            value={form.orderType}           onChange={(v) => set('orderType', v)} highlight={lowConfidenceFields.has('orderType')} />
            </Row>
          </Section>

          <Section title="Transport">
            <Row>
              <Field label="TPT"             value={form.tpt}             onChange={(v) => set('tpt', v)} />
              <Field label="TPT Code"        value={form.tptCode}         onChange={(v) => set('tptCode', v)} highlight={lowConfidenceFields.has('tptCode')} />
            </Row>
            <Row>
              <Field label="Transporter"     value={form.transporterName} onChange={(v) => set('transporterName', v)} />
              <Field label="Vehicle No"      value={form.vehicleNo}       onChange={(v) => set('vehicleNo', v)} highlight={lowConfidenceFields.has('vehicleNo')} />
            </Row>
          </Section>

          <Section title="Product &amp; Quantity">
            <Row>
              <Field label="Product Name"  value={form.productName}    onChange={(v) => set('productName', v)} />
              <Field label="Qty (Bags)"    value={form.quantityInBags} onChange={(v) => set('quantityInBags', v)} type="number" highlight={lowConfidenceFields.has('quantityInBags')} />
            </Row>
            <Row>
              <Field label="Qty (MT)"      value={form.quantityInMt}   onChange={(v) => set('quantityInMt', v)} type="number" highlight={lowConfidenceFields.has('quantityInMt')} />
            </Row>
          </Section>

          <Section title="Charges (₹)">
            <Row>
              <Field label="Toll"          value={form.tollCharges}      onChange={(v) => set('tollCharges', v)}      type="number" highlight={lowConfidenceFields.has('tollCharges')} />
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

          <Section title="Driver">
            <Row>
              <Field label="Driver Name" value={form.driverName} onChange={(v) => set('driverName', v)} highlight={lowConfidenceFields.has('driverName')} />
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
  label, value, onChange, placeholder, type, readOnly, highlight,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  type?: string;
  readOnly?: boolean;
  /** When true, the field is tinted amber to indicate it needs user review. */
  highlight?: boolean;
}) {
  return (
    <div style={m.fieldGroup}>
      <label style={highlight ? m.labelHighlight : m.label}>{label}</label>
      <input
        style={highlight ? m.inputHighlight : m.input}
        type={type ?? 'text'}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder ?? ''}
        readOnly={readOnly}
      />
    </div>
  );
}

function SelectField({
  label, value, onChange, options, placeholder, highlight,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  /** When true, the field is tinted amber to indicate it needs user attention. */
  highlight?: boolean;
}) {
  return (
    <div style={m.fieldGroup}>
      <label style={highlight ? m.labelHighlight : m.label}>{label}</label>
      <select style={highlight ? m.selectHighlight : m.select} value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

/**
 * Displays a field that was auto-populated from OCR with high confidence.
 * Shows the extracted value alongside a confidence badge and an "edit" button
 * so the user can override the detected value with a manual dropdown selection.
 */
function AutoDetectedField({
  label, value, confidence, onEdit,
}: {
  label: string;
  value: string;
  confidence: number;
  onEdit: () => void;
}) {
  return (
    <div style={m.fieldGroup}>
      <label style={m.label}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={m.autoDetectedValue}>{value || '—'}</div>
        <span style={m.autoDetectedBadge}>
          🤖 {Math.round(confidence * 100)}%
        </span>
        <button
          style={m.editAutoBtn}
          onClick={onEdit}
          type="button"
          title="Switch to manual selection"
        >
          ✎
        </button>
      </div>
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
    background: '#fff', borderRadius: 14, width: '90%', maxWidth: 780,
    maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
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
    width: '100%', padding: '7px 10px', border: '1.5px solid #d0d0e0',
    borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
  },
  select: {
    width: '100%', padding: '7px 10px', border: '1.5px solid #d0d0e0',
    borderRadius: 6, fontSize: 13, boxSizing: 'border-box', background: '#fff',
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

  // ── OCR-specific styles ───────────────────────────────────────────────────
  ocrBanner: {
    background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
    padding: '10px 14px', fontSize: 13, color: '#1d4ed8', marginBottom: 16, lineHeight: 1.5,
  },
  /** Label tint for amber-highlighted (low-confidence) fields. */
  labelHighlight: {
    display: 'block', fontSize: 11, fontWeight: 600, color: '#d97706',
    marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em',
  },
  /** Input border+background for amber-highlighted (low-confidence) fields. */
  inputHighlight: {
    width: '100%', padding: '7px 10px',
    border: '2px solid #f59e0b', background: '#fffbeb',
    borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
  },
  /** Select border+background for amber-highlighted (low-confidence) fields. */
  selectHighlight: {
    width: '100%', padding: '7px 10px',
    border: '2px solid #f59e0b', background: '#fffbeb',
    borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
  },
  /** Read-only display for an auto-detected value. */
  autoDetectedValue: {
    flex: 1, padding: '7px 10px',
    border: '1.5px solid #86efac', background: '#f0fdf4',
    borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
    color: '#166534', fontWeight: 600,
  },
  /** Confidence badge shown next to an auto-detected value. */
  autoDetectedBadge: {
    fontSize: 11, fontWeight: 700, color: '#16a34a',
    background: '#dcfce7', borderRadius: 10, padding: '2px 7px', whiteSpace: 'nowrap',
  },
  /** "✎" button to switch an auto-detected field back to manual dropdown. */
  editAutoBtn: {
    background: 'none', border: '1px solid #d0d0e0', borderRadius: 4,
    cursor: 'pointer', fontSize: 13, padding: '4px 7px', color: '#666', flexShrink: 0,
  },
};
