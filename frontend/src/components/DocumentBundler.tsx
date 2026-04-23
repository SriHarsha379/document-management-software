import React, { useState, useEffect, useCallback } from 'react';
import type {
  DocumentGroup, DocumentType, RecipientType, BundlePreview,
  BundleDocumentItem, Bundle,
} from '../types';
import { documentsApi, bundlesApi } from '../services/api';

interface Props {
  onBundleSaved?: (bundle: Bundle) => void;
}

const RECIPIENT_TYPES: RecipientType[] = ['ACCOUNTS', 'PARTY', 'TRANSPORTER'];

const RECIPIENT_LABELS: Record<RecipientType, string> = {
  ACCOUNTS: '📊 Accounts',
  PARTY: '🤝 Party',
  TRANSPORTER: '🚛 Transporter',
};

const RECIPIENT_DESCRIPTIONS: Record<RecipientType, string> = {
  ACCOUNTS: 'Invoice, E-Way Bill, LR, Weighment, Toll, Receiving — up to 9 docs',
  PARTY: 'Invoice, LR, Receiving Copy, Weighment — 4 docs',
  TRANSPORTER: 'LR, Invoice, Weighment, Toll Copies — 5 docs',
};

const TYPE_LABELS: Record<DocumentType, string> = {
  LR: 'Lorry Receipt',
  INVOICE: 'Invoice',
  TOLL: 'Toll Receipt',
  WEIGHMENT: 'Weighment Slip',
  EWAYBILL: 'E-Way Bill',
  RECEIVING: 'Receiving Copy',
  UNKNOWN: 'Unknown',
};

const TYPE_COLORS: Record<DocumentType, string> = {
  LR: '#4361ee',
  INVOICE: '#06b6d4',
  TOLL: '#f59e0b',
  WEIGHMENT: '#8b5cf6',
  EWAYBILL: '#10b981',
  RECEIVING: '#ec4899',
  UNKNOWN: '#9ca3af',
};

export function DocumentBundler({ onBundleSaved }: Props) {
  // ── Step state ───────────────────────────────────────────────────────────────
  const [step, setStep] = useState<'group' | 'recipient' | 'review'>('group');

  // ── Group selection ──────────────────────────────────────────────────────────
  const [groups, setGroups] = useState<DocumentGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState('');

  // ── Recipient selection ──────────────────────────────────────────────────────
  const [recipientType, setRecipientType] = useState<RecipientType | ''>('');

  // ── Preview / selection state ────────────────────────────────────────────────
  const [preview, setPreview] = useState<BundlePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── All docs in the group (for manual add) ───────────────────────────────────
  const [groupDocs, setGroupDocs] = useState<BundleDocumentItem[]>([]);

  // ── Notes & save ────────────────────────────────────────────────────────────
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedBundle, setSavedBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Load groups on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    setGroupsLoading(true);
    documentsApi.listGroups()
      .then((g) => setGroups(g))
      .catch(() => setGroups([]))
      .finally(() => setGroupsLoading(false));
  }, []);

  // ── Fetch preview when both group and recipient are chosen ───────────────────
  const loadPreview = useCallback(async (groupId: string, recipient: RecipientType) => {
    setPreviewLoading(true);
    setError(null);
    try {
      const p = await bundlesApi.preview(groupId, recipient);
      setPreview(p);
      // Auto-select all documents returned by the preview
      setSelectedIds(new Set(p.autoSelectedDocuments.map((d) => d.documentId)));

      // Also load all docs in the group for the "add more" section
      const group = await documentsApi.getGroup(groupId);
      const allDocs: BundleDocumentItem[] = (group.documents ?? []).map((doc) => ({
        documentId: doc.id,
        type: doc.type,
        originalFilename: doc.originalFilename,
        status: doc.status,
        isOverride: false,
      }));
      setGroupDocs(allDocs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preview');
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // ── Navigation ───────────────────────────────────────────────────────────────
  const goToRecipient = () => {
    if (!selectedGroupId) return;
    setStep('recipient');
  };

  const goToReview = async () => {
    if (!selectedGroupId || !recipientType) return;
    await loadPreview(selectedGroupId, recipientType);
    setStep('review');
  };

  const toggleDoc = (docId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedGroupId || !recipientType) return;
    setSaving(true);
    setError(null);
    try {
      const bundle = await bundlesApi.create({
        groupId: selectedGroupId,
        recipientType,
        documentIds: Array.from(selectedIds),
        notes: notes.trim() || undefined,
      });
      setSavedBundle(bundle);
      onBundleSaved?.(bundle);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save bundle');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setStep('group');
    setSelectedGroupId('');
    setRecipientType('');
    setPreview(null);
    setSelectedIds(new Set());
    setGroupDocs([]);
    setNotes('');
    setSavedBundle(null);
    setError(null);
  };

  // ── Render saved state ───────────────────────────────────────────────────────
  if (savedBundle) {
    return (
      <div style={styles.container}>
        <div style={styles.successBox}>
          <div style={styles.successIcon}>✅</div>
          <h2 style={styles.successTitle}>Bundle Saved</h2>
          <p style={styles.successSub}>
            <strong>{savedBundle.recipientType}</strong> bundle created with{' '}
            <strong>{savedBundle.items.length}</strong> document(s)
          </p>
          <p style={styles.successId}>Bundle ID: {savedBundle.id}</p>
          <button style={styles.btnPrimary} onClick={reset}>
            ➕ Create Another Bundle
          </button>
        </div>
      </div>
    );
  }

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);

  return (
    <div style={styles.container}>
      {/* Step indicator */}
      <div style={styles.stepper}>
        {(['group', 'recipient', 'review'] as const).map((s, i) => (
          <React.Fragment key={s}>
            <div style={{ ...styles.stepDot, ...(step === s ? styles.stepDotActive : (i < ['group', 'recipient', 'review'].indexOf(step) ? styles.stepDotDone : {})) }}>
              {i + 1}
            </div>
            {i < 2 && <div style={styles.stepLine} />}
          </React.Fragment>
        ))}
      </div>
      <div style={styles.stepLabels}>
        <span style={step === 'group' ? styles.stepLabelActive : styles.stepLabel}>Select Group</span>
        <span style={step === 'recipient' ? styles.stepLabelActive : styles.stepLabel}>Recipient</span>
        <span style={step === 'review' ? styles.stepLabelActive : styles.stepLabel}>Review & Save</span>
      </div>

      <h2 style={styles.title}>Create Document Bundle</h2>
      {error && <p style={styles.error}>{error}</p>}

      {/* ── Step 1: Group ──────────────────────────────────────────────────────── */}
      {step === 'group' && (
        <div style={styles.stepPanel}>
          <p style={styles.stepDesc}>
            Select the vehicle trip (Document Group) to bundle documents from.
          </p>
          {groupsLoading && <p style={styles.loading}>Loading groups…</p>}
          {!groupsLoading && groups.length === 0 && (
            <p style={styles.empty}>No document groups found. Upload and link some documents first.</p>
          )}
          <div style={styles.groupGrid}>
            {groups.map((g) => (
              <div
                key={g.id}
                style={{ ...styles.groupCard, ...(selectedGroupId === g.id ? styles.groupCardSelected : {}) }}
                onClick={() => setSelectedGroupId(g.id)}
              >
                <div style={styles.groupVehicle}>🚛 {g.vehicleNo}</div>
                <div style={styles.groupDate}>📅 {g.date}</div>
                <div style={styles.groupDocCount}>
                  {g.documents ? `${g.documents.length} doc(s)` : ''}
                </div>
              </div>
            ))}
          </div>
          <div style={styles.actions}>
            <button
              style={{ ...styles.btnPrimary, ...(!selectedGroupId ? styles.btnDisabled : {}) }}
              onClick={goToRecipient}
              disabled={!selectedGroupId}
            >
              Next: Choose Recipient →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Recipient ──────────────────────────────────────────────────── */}
      {step === 'recipient' && (
        <div style={styles.stepPanel}>
          <p style={styles.stepDesc}>
            Choose who will receive this bundle. Each recipient type automatically selects the required documents.
          </p>
          <div style={styles.recipientGrid}>
            {RECIPIENT_TYPES.map((rt) => (
              <div
                key={rt}
                style={{ ...styles.recipientCard, ...(recipientType === rt ? styles.recipientCardSelected : {}) }}
                onClick={() => setRecipientType(rt)}
              >
                <div style={styles.recipientLabel}>{RECIPIENT_LABELS[rt]}</div>
                <div style={styles.recipientDesc}>{RECIPIENT_DESCRIPTIONS[rt]}</div>
              </div>
            ))}
          </div>
          <div style={styles.actions}>
            <button style={styles.btnSecondary} onClick={() => setStep('group')}>← Back</button>
            <button
              style={{ ...styles.btnPrimary, ...(!recipientType ? styles.btnDisabled : {}) }}
              onClick={() => void goToReview()}
              disabled={!recipientType}
            >
              Next: Review Documents →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Review ─────────────────────────────────────────────────────── */}
      {step === 'review' && (
        <div style={styles.stepPanel}>
          <div style={styles.reviewHeader}>
            <div>
              <strong>Group:</strong> {selectedGroup?.vehicleNo} · {selectedGroup?.date}
            </div>
            <div>
              <strong>Recipient:</strong> {recipientType && RECIPIENT_LABELS[recipientType as RecipientType]}
            </div>
          </div>

          {previewLoading && <p style={styles.loading}>🤖 Computing auto-selection…</p>}

          {!previewLoading && preview && (
            <>
              {/* Missing documents warning */}
              {preview.missingTypes.length > 0 && (
                <div style={styles.warningBox}>
                  <strong>⚠️ Missing required documents:</strong>
                  <ul style={styles.missingList}>
                    {preview.missingTypes.map((t) => (
                      <li key={t} style={styles.missingItem}>
                        <span style={{ ...styles.typeBadge, background: TYPE_COLORS[t] }}>{t}</span>
                        {' '}{TYPE_LABELS[t]}
                      </li>
                    ))}
                  </ul>
                  <p style={styles.warningNote}>
                    These document types are required for <strong>{recipientType}</strong> but are not available in this group.
                    Upload them first, or proceed with the available documents.
                  </p>
                </div>
              )}

              {/* Document selection */}
              <div style={styles.sectionTitle}>
                Auto-selected Documents
                <span style={styles.sectionCount}>{selectedIds.size} selected</span>
              </div>

              {groupDocs.length === 0 && (
                <p style={styles.empty}>No documents in this group.</p>
              )}

              <div style={styles.docList}>
                {groupDocs.map((doc) => {
                  const isRequired = preview.requiredTypes.includes(doc.type);
                  const isChecked = selectedIds.has(doc.documentId);
                  const isAutoSelected = preview.autoSelectedDocuments.some((d) => d.documentId === doc.documentId);
                  const isManualOverride = isChecked !== isAutoSelected;

                  return (
                    <label key={doc.documentId} style={{ ...styles.docRow, ...(isChecked ? styles.docRowChecked : {}) }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleDoc(doc.documentId)}
                        style={styles.checkbox}
                      />
                      <span style={{ ...styles.typeBadge, background: TYPE_COLORS[doc.type] }}>{doc.type}</span>
                      <span style={styles.docFilename}>{doc.originalFilename}</span>
                      <div style={styles.docMeta}>
                        {isRequired && <span style={styles.requiredTag}>required</span>}
                        {isManualOverride && <span style={styles.overrideTag}>manual override</span>}
                        {isAutoSelected && !isManualOverride && <span style={styles.autoTag}>auto</span>}
                      </div>
                    </label>
                  );
                })}
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Notes (optional)</label>
                <textarea
                  style={styles.textarea}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Any notes for this bundle…"
                />
              </div>

              <div style={styles.actions}>
                <button style={styles.btnSecondary} onClick={() => setStep('recipient')}>← Back</button>
                <button
                  style={{ ...styles.btnPrimary, ...(selectedIds.size === 0 || saving ? styles.btnDisabled : {}) }}
                  onClick={() => void handleSave()}
                  disabled={selectedIds.size === 0 || saving}
                >
                  {saving ? '💾 Saving…' : `✅ Save Bundle (${selectedIds.size} docs)`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 800, margin: '0 auto', padding: 24 },
  title: { fontSize: 22, fontWeight: 700, color: '#1a1a2e', marginBottom: 4, marginTop: 16 },
  error: { color: '#e53e3e', fontSize: 13, marginBottom: 8, padding: '8px 12px', background: '#fff5f5', borderRadius: 6 },
  loading: { color: '#888', fontStyle: 'italic', fontSize: 14 },
  empty: { color: '#888', fontSize: 14 },

  // Stepper
  stepper: { display: 'flex', alignItems: 'center', gap: 0, marginBottom: 4 },
  stepDot: {
    width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 13, fontWeight: 700, background: '#e0e0f0', color: '#888',
  },
  stepDotActive: { background: '#4361ee', color: '#fff' },
  stepDotDone: { background: '#22c55e', color: '#fff' },
  stepLine: { flex: 1, height: 2, background: '#e0e0f0' },
  stepLabels: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#888', marginBottom: 8 },
  stepLabel: { flex: 1, textAlign: 'center' },
  stepLabelActive: { flex: 1, textAlign: 'center', color: '#4361ee', fontWeight: 600 },

  stepPanel: { marginTop: 8 },
  stepDesc: { fontSize: 14, color: '#555', marginBottom: 16 },
  actions: { display: 'flex', gap: 8, marginTop: 20 },

  // Group grid
  groupGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 8 },
  groupCard: {
    border: '2px solid #e0e0f0', borderRadius: 8, padding: '12px 14px',
    cursor: 'pointer', background: '#fff', transition: 'all 0.15s',
  },
  groupCardSelected: { border: '2px solid #4361ee', background: '#eef0ff' },
  groupVehicle: { fontWeight: 700, fontSize: 14, color: '#1a1a2e', marginBottom: 2 },
  groupDate: { fontSize: 13, color: '#555' },
  groupDocCount: { fontSize: 12, color: '#888', marginTop: 4 },

  // Recipient grid
  recipientGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 8 },
  recipientCard: {
    border: '2px solid #e0e0f0', borderRadius: 8, padding: 16,
    cursor: 'pointer', background: '#fff', transition: 'all 0.15s', textAlign: 'center',
  },
  recipientCardSelected: { border: '2px solid #4361ee', background: '#eef0ff' },
  recipientLabel: { fontSize: 16, fontWeight: 700, marginBottom: 6 },
  recipientDesc: { fontSize: 12, color: '#666', lineHeight: 1.4 },

  // Review
  reviewHeader: {
    display: 'flex', gap: 24, fontSize: 14, background: '#f5f6ff',
    borderRadius: 8, padding: '10px 14px', marginBottom: 16,
  },
  warningBox: {
    background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8,
    padding: '12px 14px', marginBottom: 16, fontSize: 13,
  },
  missingList: { margin: '6px 0', paddingLeft: 20 },
  missingItem: { marginBottom: 4 },
  warningNote: { margin: '8px 0 0', color: '#555' },

  sectionTitle: {
    fontSize: 14, fontWeight: 700, color: '#333', marginBottom: 8,
    display: 'flex', alignItems: 'center', gap: 8,
  },
  sectionCount: {
    background: '#4361ee', color: '#fff', borderRadius: 10, padding: '1px 8px',
    fontSize: 12, fontWeight: 600,
  },

  docList: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 },
  docRow: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
    border: '1px solid #e0e0f0', borderRadius: 6, cursor: 'pointer',
    background: '#fff', fontSize: 13,
  },
  docRowChecked: { background: '#f0f3ff', borderColor: '#c0c8ff' },
  checkbox: { width: 16, height: 16, cursor: 'pointer', flexShrink: 0 },
  typeBadge: {
    color: '#fff', padding: '2px 7px', borderRadius: 10,
    fontSize: 11, fontWeight: 700, flexShrink: 0,
  },
  docFilename: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  docMeta: { display: 'flex', gap: 4, flexShrink: 0 },
  requiredTag: {
    fontSize: 10, padding: '1px 6px', borderRadius: 8,
    background: '#fef3c7', color: '#92400e', fontWeight: 600,
  },
  overrideTag: {
    fontSize: 10, padding: '1px 6px', borderRadius: 8,
    background: '#fce7f3', color: '#9d174d', fontWeight: 600,
  },
  autoTag: {
    fontSize: 10, padding: '1px 6px', borderRadius: 8,
    background: '#dcfce7', color: '#166534', fontWeight: 600,
  },

  fieldGroup: { marginBottom: 12 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' },
  textarea: { width: '100%', padding: '8px 10px', border: '1px solid #d0d0e0', borderRadius: 6, fontSize: 14, resize: 'vertical', boxSizing: 'border-box' },

  // Buttons
  btnPrimary: {
    padding: '10px 20px', background: '#4361ee', color: '#fff', border: 'none',
    borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14,
  },
  btnSecondary: {
    padding: '10px 16px', background: '#eee', color: '#444', border: 'none',
    borderRadius: 6, cursor: 'pointer', fontSize: 14,
  },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },

  // Success
  successBox: { textAlign: 'center', padding: 40 },
  successIcon: { fontSize: 48, marginBottom: 12 },
  successTitle: { fontSize: 22, fontWeight: 700, color: '#1a1a2e', marginBottom: 8 },
  successSub: { fontSize: 15, color: '#555', marginBottom: 4 },
  successId: { fontSize: 12, color: '#888', marginBottom: 20 },
};
