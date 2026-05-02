import { useState, useEffect, useCallback } from 'react';
import { masterApi } from '../services/api';
import type { Party, PartyCreateInput } from '../services/api';

// ─────────────────────────────────────────────────────────────────────────────
// Empty form state
// ─────────────────────────────────────────────────────────────────────────────
const EMPTY_FORM: PartyCreateInput = {
  code: '',
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  gstNo: '',
  address: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// Create / Edit form
// ─────────────────────────────────────────────────────────────────────────────
function PartyForm({
  initial,
  onSave,
  onCancel,
  saving,
  error,
}: {
  initial: PartyCreateInput;
  onSave: (data: PartyCreateInput) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState<PartyCreateInput>(initial);

  const set = (field: keyof PartyCreateInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <form onSubmit={handleSubmit} style={formStyle}>
      <div style={formGrid}>
        <div style={fieldGroup}>
          <label style={label}>Code *</label>
          <input style={input} value={form.code} onChange={set('code')} placeholder="e.g. ACME001" required />
          <span style={hint}>1–30 alphanumeric chars, hyphens, underscores</span>
        </div>
        <div style={fieldGroup}>
          <label style={label}>Name *</label>
          <input style={input} value={form.name} onChange={set('name')} placeholder="Party display name" required />
        </div>
        <div style={fieldGroup}>
          <label style={label}>Contact Person</label>
          <input style={input} value={form.contactPerson ?? ''} onChange={set('contactPerson')} placeholder="Contact name" />
        </div>
        <div style={fieldGroup}>
          <label style={label}>Phone</label>
          <input style={input} value={form.phone ?? ''} onChange={set('phone')} placeholder="+91 9876543210" />
        </div>
        <div style={fieldGroup}>
          <label style={label}>Email</label>
          <input style={input} type="email" value={form.email ?? ''} onChange={set('email')} placeholder="party@example.com" />
        </div>
        <div style={fieldGroup}>
          <label style={label}>GST No.</label>
          <input style={input} value={form.gstNo ?? ''} onChange={set('gstNo')} placeholder="22AAAAA0000A1Z5" />
        </div>
        <div style={{ ...fieldGroup, gridColumn: '1 / -1' }}>
          <label style={label}>Address</label>
          <textarea style={{ ...input, resize: 'vertical', minHeight: 60 }} value={form.address ?? ''} onChange={set('address')} placeholder="Full address" />
        </div>
      </div>
      {error && <div style={errorBanner}>⚠️ {error}</div>}
      <div style={formActions}>
        <button style={{ ...btn, ...(saving ? btnDisabled : {}) }} type="submit" disabled={saving}>
          {saving ? 'Saving…' : '💾 Save Party'}
        </button>
        <button style={btnSecondary} type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export function MasterParties({ canManage = false }: { canManage?: boolean }) {
  const [parties, setParties] = useState<Party[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const LIMIT = 20;

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);

  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 when search / filter changes
  useEffect(() => { setPage(1); }, [debouncedSearch, includeInactive]);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const data = await masterApi.listParties({
        page,
        limit: LIMIT,
        search: debouncedSearch || undefined,
        includeInactive: includeInactive || undefined,
      });
      setParties(data.items);
      setTotal(data.pagination.total);
      setPages(data.pagination.pages);
    } catch {
      setListError('Failed to load parties. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, includeInactive]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (data: PartyCreateInput) => {
    setSaving(true);
    setCreateError(null);
    try {
      await masterApi.createParty(data);
      setShowCreate(false);
      setPage(1);
      await load();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setCreateError(axiosErr?.response?.data?.error ?? 'Failed to create party');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: string, data: PartyCreateInput) => {
    setEditSaving(true);
    setEditError(null);
    try {
      await masterApi.updateParty(id, data);
      setEditId(null);
      await load();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setEditError(axiosErr?.response?.data?.error ?? 'Failed to update party');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeactivate = async (id: string, name: string) => {
    if (!confirm(`Deactivate party "${name}"? It will be hidden from dropdowns but its records are preserved.`)) return;
    try {
      await masterApi.deleteParty(id);
      await load();
    } catch {
      alert('Failed to deactivate party');
    }
  };

  const handleReactivate = async (id: string) => {
    try {
      await masterApi.updateParty(id, { isActive: true });
      await load();
    } catch {
      alert('Failed to reactivate party');
    }
  };

  return (
    <div style={container}>
      <h2 style={title}>🏷️ Party Master Data</h2>
      <p style={subtitle}>
        Manage parties (customers / consignees). Parties added here appear in the Customer Portal Access dropdown.
      </p>

      {/* Toolbar */}
      <div style={toolbar}>
        <input
          style={{ ...input, flex: 1, maxWidth: 340 }}
          placeholder="Search by name or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label style={checkLabel}>
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Show inactive
        </label>
        {canManage && (
          <button
            style={btn}
            onClick={() => {
              setShowCreate(true);
              setCreateError(null);
            }}
          >
            ➕ Add Party
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={card}>
          <h3 style={sectionTitle}>New Party</h3>
          <PartyForm
            initial={EMPTY_FORM}
            onSave={handleCreate}
            onCancel={() => { setShowCreate(false); setCreateError(null); }}
            saving={saving}
            error={createError}
          />
        </div>
      )}

      {/* List */}
      <div style={card}>
        {loading && <div style={hintText}>Loading…</div>}
        {listError && <div style={errorBanner}>⚠️ {listError}</div>}

        {!loading && parties.length === 0 && (
          <div style={hintText}>
            {debouncedSearch
              ? `No parties match "${debouncedSearch}".`
              : 'No parties yet. Click ➕ Add Party to create the first one.'}
          </div>
        )}

        {parties.map((p) => (
          <div key={p.id}>
            {editId === p.id ? (
              <div style={editRow}>
                <PartyForm
                  initial={{
                    code: p.code,
                    name: p.name,
                    contactPerson: p.contactPerson ?? '',
                    phone: p.phone ?? '',
                    email: p.email ?? '',
                    gstNo: p.gstNo ?? '',
                    address: p.address ?? '',
                  }}
                  onSave={(data) => handleUpdate(p.id, data)}
                  onCancel={() => { setEditId(null); setEditError(null); }}
                  saving={editSaving}
                  error={editError}
                />
              </div>
            ) : (
              <div style={{ ...partyRow, opacity: p.isActive ? 1 : 0.5 }}>
                <div style={partyMain}>
                  <div style={partyName}>
                    {p.name}
                    <span style={codeChip}>{p.code}</span>
                    {!p.isActive && <span style={inactiveBadge}>Inactive</span>}
                  </div>
                  <div style={partyMeta}>
                    {[p.contactPerson, p.phone, p.email].filter(Boolean).join(' · ') || 'No contact info'}
                  </div>
                  {p.gstNo && <div style={partyMeta}>GST: {p.gstNo}</div>}
                  {p.address && <div style={partyMeta}>{p.address}</div>}
                </div>
                <div style={partyActions}>
                  {canManage && (
                    <button style={btnSmall} onClick={() => { setEditId(p.id); setEditError(null); }}>
                      ✏️ Edit
                    </button>
                  )}
                  {canManage && (p.isActive ? (
                    <button style={btnSmallOrange} onClick={() => handleDeactivate(p.id, p.name)}>
                      Deactivate
                    </button>
                  ) : (
                    <button style={btnSmallGreen} onClick={() => handleReactivate(p.id)}>
                      Reactivate
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Pagination */}
        {!loading && total > 0 && (
          <div style={paginationRow}>
            <span style={paginationInfo}>{total} {total !== 1 ? 'parties' : 'party'}</span>
            <div style={paginationBtns}>
              <button style={pgBtn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
              <span style={paginationInfo}>Page {page} / {pages}</span>
              <button style={pgBtn} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const container: React.CSSProperties = { padding: '0 16px' };
const title: React.CSSProperties = { fontSize: 22, fontWeight: 700, color: '#1a1a2e', margin: '0 0 6px' };
const subtitle: React.CSSProperties = { fontSize: 14, color: '#666', margin: '0 0 20px' };
const card: React.CSSProperties = {
  background: '#fff', borderRadius: 12, padding: '20px 24px',
  marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
};
const sectionTitle: React.CSSProperties = { fontSize: 16, fontWeight: 700, margin: '0 0 14px', color: '#1a1a2e' };
const toolbar: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' };
const checkLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#555', cursor: 'pointer' };
const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 2 };
const hint: React.CSSProperties = { fontSize: 11, color: '#a0aec0', marginTop: 2 };
const hintText: React.CSSProperties = { color: '#a0aec0', fontSize: 14, textAlign: 'center', padding: '16px 0' };
const input: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 8, border: '1.5px solid #ddd',
  fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box',
};
const btn: React.CSSProperties = {
  padding: '9px 18px', background: '#4361ee', color: '#fff',
  border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
};
const btnDisabled: React.CSSProperties = { background: '#aaa', cursor: 'not-allowed' };
const btnSecondary: React.CSSProperties = {
  padding: '9px 18px', background: '#edf2f7', color: '#4a5568',
  border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const btnSmall: React.CSSProperties = {
  padding: '4px 12px', background: '#ebf4ff', color: '#2b6cb0',
  border: '1px solid #bee3f8', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600,
};
const btnSmallOrange: React.CSSProperties = {
  padding: '4px 12px', background: '#fff3cd', color: '#856404',
  border: '1px solid #ffc107', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600,
};
const btnSmallGreen: React.CSSProperties = {
  padding: '4px 12px', background: '#c6f6d5', color: '#276749',
  border: '1px solid #68d391', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600,
};
const errorBanner: React.CSSProperties = {
  background: '#fff5f5', border: '1px solid #fc8181',
  borderRadius: 8, padding: '10px 14px', color: '#c53030', fontSize: 13, marginBottom: 12,
};
const partyRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  padding: '14px 0', borderBottom: '1px solid #f0f0f0', gap: 12,
};
const editRow: React.CSSProperties = {
  padding: '14px 0', borderBottom: '1px solid #f0f0f0',
};
const partyMain: React.CSSProperties = { flex: 1, minWidth: 0 };
const partyName: React.CSSProperties = { fontWeight: 600, fontSize: 15, color: '#1a1a2e', marginBottom: 3, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 };
const partyMeta: React.CSSProperties = { fontSize: 12, color: '#718096', marginTop: 2 };
const partyActions: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 };
const codeChip: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: '2px 7px',
  background: '#ebf4ff', color: '#2b6cb0', borderRadius: 999,
};
const inactiveBadge: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: '2px 7px',
  background: '#e2e8f0', color: '#4a5568', borderRadius: 999,
};
const formStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 };
const fieldGroup: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3 };
const formActions: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 4 };
const paginationRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginTop: 16, paddingTop: 12, borderTop: '1px solid #f0f0f0',
};
const paginationBtns: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' };
const paginationInfo: React.CSSProperties = { fontSize: 13, color: '#718096' };
const pgBtn: React.CSSProperties = {
  padding: '5px 12px', background: '#edf2f7', color: '#4a5568',
  border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600,
};
