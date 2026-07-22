import { useCallback, useEffect, useState } from 'react';
import { ACCOUNTANT_ROLE, masterApi } from '../services/api';
import { getOfficerRoleLabel } from '../utils/masterData';

type MasterContact = {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  contactPerson: string | null;
  roles: string[];
};

type CreateForm = {
  name: string;
  email: string;
  contactPerson: string;
  phone: string;
  isAccountant: boolean;
  isParty: boolean;
  isBillToParty: boolean;
  isShipToParty: boolean;
  isTransporter: boolean;
};

const EMPTY_FORM: CreateForm = {
  name: '',
  email: '',
  contactPerson: '',
  phone: '',
  isAccountant: false,
  isParty: false,
  isBillToParty: true,
  isShipToParty: true,
  isTransporter: false,
};

const LIMIT = 200;

function generateCode(prefix: string, name: string): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || prefix;
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `${prefix}-${slug}-${suffix}`;
}

export function MasterParties({ canManage = false }: { canManage?: boolean }) {
  const [contacts, setContacts] = useState<MasterContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [parties, officers, transporters] = await Promise.all([
        masterApi.listParties({ page: 1, limit: LIMIT, search: debouncedSearch || undefined }),
        masterApi.listOfficers({ page: 1, limit: LIMIT, search: debouncedSearch || undefined }),
        masterApi.listTransporters({ page: 1, limit: LIMIT, search: debouncedSearch || undefined }),
      ]);

      const rows: MasterContact[] = [
        ...parties.items.map((p) => ({
          key: `party:${p.id}`,
          name: p.name,
          email: p.email,
          phone: p.phone,
          contactPerson: p.contactPerson,
          roles: [
            p.isBillToParty ? 'Party (Bill To)' : null,
            p.isShipToParty ? 'Party (Ship To)' : null,
          ].filter(Boolean) as string[],
        })),
        ...officers.items.map((o) => ({
          key: `officer:${o.id}`,
          name: o.name,
          email: o.email,
          phone: o.phone,
          contactPerson: null,
          roles: [getOfficerRoleLabel(o.role)],
        })),
        ...transporters.items.map((t) => ({
          key: `transporter:${t.id}`,
          name: t.name,
          email: t.email,
          phone: t.phone,
          contactPerson: t.contactName,
          roles: ['Transporter'],
        })),
      ].sort((a, b) => a.name.localeCompare(b.name));

      setContacts(rows);
    } catch {
      setError('Failed to load master data.');
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async () => {
    const hasRole = form.isAccountant || form.isParty || form.isTransporter;
    if (!form.name.trim()) {
      setSaveError('Name is required.');
      return;
    }
    if (!hasRole) {
      setSaveError('Select at least one role.');
      return;
    }
    if (form.isParty && !form.isBillToParty && !form.isShipToParty) {
      setSaveError('Select Bill To or Ship To when Party is enabled.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const tasks: Array<Promise<unknown>> = [];

      if (form.isAccountant) {
        tasks.push(masterApi.createOfficer({
          name: form.name.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          role: ACCOUNTANT_ROLE,
        }));
      }

      if (form.isParty) {
        tasks.push(masterApi.createParty({
          code: generateCode('PTY', form.name),
          name: form.name.trim(),
          contactPerson: form.contactPerson.trim() || undefined,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          isBillToParty: form.isBillToParty,
          isShipToParty: form.isShipToParty,
        }));
      }

      if (form.isTransporter) {
        tasks.push(masterApi.createTransporter({
          code: generateCode('TRN', form.name),
          name: form.name.trim(),
          contactName: form.contactPerson.trim() || undefined,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
        }));
      }

      await Promise.all(tasks);
      setForm(EMPTY_FORM);
      setShowCreate(false);
      await load();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setSaveError(axiosErr?.response?.data?.error ?? 'Failed to create master data record.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (key: string) => {
    if (!window.confirm('Are you sure you want to delete this record?')) return;
    setDeletingKey(key);
    try {
      const [type, id] = key.split(':');
      if (type === 'party') await masterApi.deleteParty(id);
      else if (type === 'officer') await masterApi.deleteOfficer(id);
      else if (type === 'transporter') await masterApi.deleteTransporter(id);
      else throw new Error(`Unknown record type: ${type}`);
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete record.';
      setError(msg);
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <div style={container}>
      <h2 style={title}>🗂️ Master Data</h2>
      <p style={subtitle}>
        Create contact records for accountant, party (bill-to / ship-to), and transporter roles.
      </p>

      <div style={toolbar}>
        <input
          style={input}
          placeholder="Search by name, email, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canManage && (
          <button style={btnPrimary} onClick={() => { setShowCreate((v) => !v); setSaveError(null); }}>
            {showCreate ? 'Close Create' : '➕ Create'}
          </button>
        )}
      </div>

      {showCreate && canManage && (
        <div style={card}>
          <div style={grid}>
            <label style={field}>
              <span style={label}>Name *</span>
              <input style={input} value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} />
            </label>
            <label style={field}>
              <span style={label}>Email</span>
              <input style={input} type="email" value={form.email} onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))} />
            </label>
            <label style={field}>
              <span style={label}>Contact Person</span>
              <input style={input} value={form.contactPerson} onChange={(e) => setForm((v) => ({ ...v, contactPerson: e.target.value }))} />
            </label>
            <label style={field}>
              <span style={label}>Phone</span>
              <input style={input} value={form.phone} onChange={(e) => setForm((v) => ({ ...v, phone: e.target.value }))} />
            </label>
          </div>

          <div style={rolesBox}>
            <label style={check}><input type="checkbox" checked={form.isAccountant} onChange={(e) => setForm((v) => ({ ...v, isAccountant: e.target.checked }))} /> Accountant</label>
            <label style={check}><input type="checkbox" checked={form.isParty} onChange={(e) => setForm((v) => ({ ...v, isParty: e.target.checked }))} /> Party</label>
            {form.isParty && (
              <div style={{ display: 'flex', gap: 14, marginLeft: 26 }}>
                <label style={check}><input type="checkbox" checked={form.isBillToParty} onChange={(e) => setForm((v) => ({ ...v, isBillToParty: e.target.checked }))} /> Bill To</label>
                <label style={check}><input type="checkbox" checked={form.isShipToParty} onChange={(e) => setForm((v) => ({ ...v, isShipToParty: e.target.checked }))} /> Ship To</label>
              </div>
            )}
            <label style={check}><input type="checkbox" checked={form.isTransporter} onChange={(e) => setForm((v) => ({ ...v, isTransporter: e.target.checked }))} /> Transporter</label>
          </div>

          {saveError && <div style={errorBanner}>⚠️ {saveError}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }} onClick={() => { void handleCreate(); }} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div style={card}>
        {loading && <p style={muted}>Loading…</p>}
        {error && <div style={errorBanner}>⚠️ {error}</div>}
        {!loading && !error && contacts.length === 0 && <p style={muted}>No records found.</p>}

        {!loading && !error && contacts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {contacts.map((c) => (
              <div key={c.key} style={row}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: '#1a1a2e' }}>{c.name}</div>
                  <div style={meta}>{[c.contactPerson, c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details'}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {c.roles.map((role) => <span key={role} style={chip}>{role}</span>)}
                  {canManage && (
                    <button
                      style={btnDelete}
                      title="Delete"
                      disabled={deletingKey === c.key}
                      onClick={() => { void handleDelete(c.key); }}
                    >
                      {deletingKey === c.key ? '…' : '🗑️'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const container: React.CSSProperties = { padding: '0 16px' };
const title: React.CSSProperties = { fontSize: 22, fontWeight: 700, color: '#1a1a2e', margin: '0 0 6px' };
const subtitle: React.CSSProperties = { fontSize: 14, color: '#666', margin: '0 0 18px' };
const toolbar: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 };
const card: React.CSSProperties = {
  background: '#fff', borderRadius: 12, padding: 18, marginBottom: 18,
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #e0e0f0',
};
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8,
  border: '1.5px solid #ddd', fontSize: 14, outline: 'none',
};
const btnPrimary: React.CSSProperties = {
  padding: '9px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
  background: '#4361ee', color: '#fff', fontWeight: 700, fontSize: 14,
};
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 };
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const label: React.CSSProperties = { fontSize: 12, color: '#555', fontWeight: 600 };
const rolesBox: React.CSSProperties = { margin: '14px 0', display: 'flex', flexDirection: 'column', gap: 8 };
const check: React.CSSProperties = { fontSize: 13, color: '#333', display: 'flex', alignItems: 'center', gap: 8 };
const errorBanner: React.CSSProperties = {
  background: '#fff5f5', border: '1px solid #fc8181', borderRadius: 8,
  padding: '8px 12px', color: '#c53030', fontSize: 13, marginBottom: 10,
};
const muted: React.CSSProperties = { color: '#9ca3af', fontSize: 14, margin: 0 };
const row: React.CSSProperties = {
  padding: '10px 0', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 8,
};
const meta: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginTop: 2 };
const chip: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, background: '#ebf4ff', color: '#2b6cb0',
  borderRadius: 999, padding: '3px 8px',
};
const btnDelete: React.CSSProperties = {
  padding: '3px 8px', borderRadius: 6, border: '1px solid #fc8181', cursor: 'pointer',
  background: '#fff5f5', color: '#c53030', fontSize: 13, lineHeight: 1,
};
