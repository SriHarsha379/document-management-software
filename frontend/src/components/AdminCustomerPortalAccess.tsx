import { useState, useEffect } from 'react';
import { adminCustomerPortalApi, masterApi } from '../services/api';
import type { CustomerPortalAccess, PartyDropdownItem } from '../services/api';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function StatusBadge({ access }: { access: CustomerPortalAccess }) {
  if (access.isRevoked) return <span style={{ ...badge, ...badgeRed }}>Revoked</span>;
  if (access.isExpired) return <span style={{ ...badge, ...badgeGray }}>Expired</span>;
  return <span style={{ ...badge, ...badgeGreen }}>Active</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Credential card shown after successful creation
// ─────────────────────────────────────────────────────────────────────────────
function CredentialCard({
  access,
  token,
  onDismiss,
}: {
  access: CustomerPortalAccess;
  token: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyAll = () => {
    const text = `Customer Portal Access\nParty: ${access.partyName} (${access.partyCode})\nLogin Email: ${access.loginEmail}\nAccess Token: ${token}\nExpires: ${new Date(access.expiresAt).toLocaleDateString()}\n\nLogin at: ${window.location.origin}/customer-portal`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={credCard}>
      <div style={credHeader}>
        <span>🔑 Customer Portal Credentials</span>
        <span style={credOnce}>⚠️ Token shown only once — copy now!</span>
      </div>
      <div style={credRow}><span style={credLabel}>Party</span><span style={credValue}>{access.partyName} ({access.partyCode})</span></div>
      <div style={credRow}><span style={credLabel}>Login Email</span><span style={credValue}>{access.loginEmail}</span></div>
      <div style={credRow}>
        <span style={credLabel}>Access Token</span>
        <span style={{ ...credValue, ...tokenDisplay }}>{token}</span>
      </div>
      <div style={credRow}><span style={credLabel}>Expires</span><span style={credValue}>{new Date(access.expiresAt).toLocaleDateString()}</span></div>
      <div style={credRow}><span style={credLabel}>Portal URL</span><span style={credValue}>{window.location.origin}/customer-portal</span></div>
      <div style={credActions}>
        <button style={btnCopy} onClick={copyAll}>{copied ? '✅ Copied!' : '📋 Copy All'}</button>
        <button style={btnDismiss} onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export function AdminCustomerPortalAccess() {
  const [accesses, setAccesses] = useState<CustomerPortalAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Party dropdown state
  const [parties, setParties] = useState<PartyDropdownItem[]>([]);
  const [partiesLoading, setPartiesLoading] = useState(true);
  const [partySearch, setPartySearch] = useState('');

  // Create form state
  const [partyId, setPartyId] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [daysValid, setDaysValid] = useState('30');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newAccess, setNewAccess] = useState<{ access: CustomerPortalAccess; token: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminCustomerPortalApi.list();
      setAccesses(data);
    } catch {
      setError('Failed to load customer portal accesses');
    } finally {
      setLoading(false);
    }
  };

  const loadParties = async () => {
    setPartiesLoading(true);
    try {
      const data = await masterApi.partiesDropdown();
      setParties(data);
    } catch {
      // Non-fatal: user can still type a party ID manually if dropdown fails
      setParties([]);
    } finally {
      setPartiesLoading(false);
    }
  };

  useEffect(() => { void load(); void loadParties(); }, []);

  const filteredParties = partySearch.trim()
    ? parties.filter((p) =>
        p.label.toLowerCase().includes(partySearch.toLowerCase())
      )
    : parties;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setNewAccess(null);
    try {
      const result = await adminCustomerPortalApi.create(
        partyId.trim(),
        loginEmail.trim() || undefined,
        parseInt(daysValid, 10) || 30
      );
      setNewAccess({ access: result.access, token: result.generatedToken });
      setPartyId('');
      setPartySearch('');
      setLoginEmail('');
      setDaysValid('30');
      await load();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setCreateError(axiosErr?.response?.data?.error ?? 'Failed to create access');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke this customer portal access?')) return;
    try {
      await adminCustomerPortalApi.revoke(id);
      await load();
    } catch {
      alert('Failed to revoke access');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Permanently delete this customer portal access?')) return;
    try {
      await adminCustomerPortalApi.delete(id);
      await load();
    } catch {
      alert('Failed to delete access');
    }
  };

  return (
    <div style={container}>
      <h2 style={title}>🏢 Customer Portal Access</h2>
      <p style={subtitle}>
        Create temporary access tokens for external customers (parties) to view their shipment documents.
        Customers log in at <code style={codeStyle}>/customer-portal</code> with their email + token.
      </p>

      {/* Create form */}
      <div style={card}>
        <h3 style={sectionTitle}>Create / Renew Access</h3>
        <form onSubmit={handleCreate} style={form}>
          <div style={fieldRow}>
            <div style={fieldGroup}>
              <label style={label}>Party *</label>
              {partiesLoading ? (
                <div style={hint}>Loading parties…</div>
              ) : parties.length > 0 ? (
                <>
                  <input
                    style={input}
                    placeholder="Search party by name or code…"
                    value={partySearch}
                    onChange={(e) => {
                      const search = e.target.value;
                      setPartySearch(search);
                      // Clear selection only if the current party is no longer
                      // visible in the filtered results
                      if (partyId) {
                        const stillVisible = parties.some(
                          (p) =>
                            p.id === partyId &&
                            p.label.toLowerCase().includes(search.toLowerCase())
                        );
                        if (!stillVisible) setPartyId('');
                      }
                    }}
                  />
                  <select
                    style={{ ...input, marginTop: 4 }}
                    value={partyId}
                    onChange={(e) => setPartyId(e.target.value)}
                    required
                  >
                    <option value="">— Select a party —</option>
                    {filteredParties.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </>
              ) : (
                <input
                  style={input}
                  placeholder="Party UUID from master data"
                  value={partyId}
                  onChange={(e) => setPartyId(e.target.value)}
                  required
                />
              )}
            </div>
            <div style={fieldGroup}>
              <label style={label}>Login Email (optional — defaults to Party email)</label>
              <input
                style={input}
                type="email"
                placeholder="customer@example.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
              />
            </div>
            <div style={{ ...fieldGroup, flex: '0 0 120px' }}>
              <label style={label}>Valid (days)</label>
              <input
                style={input}
                type="number"
                min={1}
                max={365}
                value={daysValid}
                onChange={(e) => setDaysValid(e.target.value)}
              />
            </div>
          </div>
          {createError && <div style={errorBanner}>⚠️ {createError}</div>}
          <button style={{ ...btn, ...(creating ? btnDisabled : {}) }} type="submit" disabled={creating}>
            {creating ? 'Creating…' : '➕ Create Access'}
          </button>
        </form>
      </div>

      {/* Credential card */}
      {newAccess && (
        <CredentialCard
          access={newAccess.access}
          token={newAccess.token}
          onDismiss={() => setNewAccess(null)}
        />
      )}

      {/* Accesses table */}
      <div style={card}>
        <h3 style={sectionTitle}>Active Accesses</h3>

        {loading && <div style={hint}>Loading…</div>}
        {error && <div style={errorBanner}>⚠️ {error}</div>}

        {!loading && accesses.length === 0 && (
          <div style={hint}>No customer portal accesses created yet.</div>
        )}

        {accesses.map((a) => (
          <div key={a.id} style={accessRow}>
            <div style={accessMain}>
              <div style={accessName}>{a.partyName} <span style={codeChip}>{a.partyCode}</span></div>
              <div style={accessMeta}>{a.loginEmail}</div>
              <div style={accessMeta}>
                Expires: {new Date(a.expiresAt).toLocaleDateString()}
                {a.lastLoginAt && ` · Last login: ${new Date(a.lastLoginAt).toLocaleString()}`}
              </div>
            </div>
            <div style={accessRight}>
              <StatusBadge access={a} />
              <div style={accessActions}>
                {!a.isRevoked && !a.isExpired && (
                  <button style={btnSmallOrange} onClick={() => handleRevoke(a.id)}>Revoke</button>
                )}
                <button style={btnSmallRed} onClick={() => handleDelete(a.id)}>Delete</button>
              </div>
            </div>
          </div>
        ))}
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
const form: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const fieldRow: React.CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap' };
const fieldGroup: React.CSSProperties = { flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 4 };
const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#555' };
const input: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 8, border: '1.5px solid #ddd',
  fontSize: 14, outline: 'none',
};
const btn: React.CSSProperties = {
  padding: '10px 20px', background: '#4361ee', color: '#fff',
  border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
  cursor: 'pointer', alignSelf: 'flex-start',
};
const btnDisabled: React.CSSProperties = { background: '#aaa', cursor: 'not-allowed' };
const errorBanner: React.CSSProperties = {
  background: '#fff5f5', border: '1px solid #fc8181',
  borderRadius: 8, padding: '10px 14px', color: '#c53030', fontSize: 13,
};
const hint: React.CSSProperties = { color: '#a0aec0', fontSize: 14, textAlign: 'center', padding: '12px 0' };
const accessRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  padding: '14px 0', borderBottom: '1px solid #f0f0f0', gap: 12,
};
const accessMain: React.CSSProperties = { flex: 1, minWidth: 0 };
const accessName: React.CSSProperties = { fontWeight: 600, fontSize: 15, color: '#1a1a2e', marginBottom: 3 };
const accessMeta: React.CSSProperties = { fontSize: 12, color: '#718096', marginTop: 2 };
const accessRight: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 };
const accessActions: React.CSSProperties = { display: 'flex', gap: 6 };
const badge: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999 };
const badgeGreen: React.CSSProperties = { background: '#c6f6d5', color: '#276749' };
const badgeRed: React.CSSProperties = { background: '#fed7d7', color: '#c53030' };
const badgeGray: React.CSSProperties = { background: '#e2e8f0', color: '#4a5568' };
const codeChip: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: '2px 7px',
  background: '#ebf4ff', color: '#2b6cb0', borderRadius: 999, marginLeft: 6,
};
const codeStyle: React.CSSProperties = { background: '#f0f0f0', padding: '2px 6px', borderRadius: 4, fontSize: 13 };
const btnSmallOrange: React.CSSProperties = {
  padding: '4px 10px', background: '#fff3cd', color: '#856404',
  border: '1px solid #ffc107', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600,
};
const btnSmallRed: React.CSSProperties = {
  padding: '4px 10px', background: '#fff5f5', color: '#c53030',
  border: '1px solid #fc8181', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600,
};

// Credential card styles
const credCard: React.CSSProperties = {
  background: '#f0fff4', border: '2px solid #68d391',
  borderRadius: 12, padding: '20px 24px', marginBottom: 20,
};
const credHeader: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 14, fontSize: 15, fontWeight: 700, color: '#276749',
};
const credOnce: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#c53030' };
const credRow: React.CSSProperties = {
  display: 'flex', gap: 12, marginBottom: 8, alignItems: 'flex-start',
};
const credLabel: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#555', minWidth: 120 };
const credValue: React.CSSProperties = { fontSize: 13, color: '#1a1a2e' };
const tokenDisplay: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 18, fontWeight: 700,
  letterSpacing: '0.15em', color: '#276749', background: '#c6f6d5',
  padding: '4px 12px', borderRadius: 6,
};
const credActions: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 14 };
const btnCopy: React.CSSProperties = {
  padding: '9px 18px', background: '#4361ee', color: '#fff',
  border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const btnDismiss: React.CSSProperties = {
  padding: '9px 18px', background: '#edf2f7', color: '#4a5568',
  border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
