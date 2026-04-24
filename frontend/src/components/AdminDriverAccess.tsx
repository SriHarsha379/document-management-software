import { useState, useEffect } from 'react';
import { adminDriverAccessApi } from '../services/api';
import type { DriverAccess } from '../services/api';

export function AdminDriverAccess() {
  const [accesses, setAccesses] = useState<DriverAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{ password: string; phone: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const loadAccesses = async () => {
    setLoading(true);
    try {
      const list = await adminDriverAccessApi.list();
      setAccesses(list);
    } catch {
      setError('Failed to load driver accesses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAccesses();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setCreating(true);
    setError(null);
    setCreateResult(null);
    try {
      const res = await adminDriverAccessApi.create(phone.trim());
      setCreateResult({ password: res.generatedPassword, phone: res.driverAccess.phone });
      setPhone('');
      await loadAccesses();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr?.response?.data?.error ?? 'Failed to create driver access');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevoking(id);
    try {
      await adminDriverAccessApi.revoke(id);
      await loadAccesses();
    } catch {
      setError('Failed to revoke access');
    } finally {
      setRevoking(null);
    }
  };

  const portalUrl = `${window.location.origin}/driver`;

  return (
    <div style={s.container}>
      <h2 style={s.pageTitle}>🚛 Temporary Driver Access</h2>
      <p style={s.pageSubtitle}>
        Create time-limited access for drivers to upload documents.
        Access expires automatically after <strong>7 days</strong>.
      </p>

      {/* Driver Portal URL */}
      <div style={s.infoBox}>
        <strong>Driver Portal URL:</strong>{' '}
        <a href={portalUrl} target="_blank" rel="noopener noreferrer" style={s.link}>
          {portalUrl}
        </a>
        <span style={s.hint}> — share this with drivers</span>
      </div>

      {/* Create form */}
      <div style={s.card}>
        <h3 style={s.cardTitle}>Create / Renew Driver Access</h3>
        <form onSubmit={handleCreate} style={s.form}>
          <input
            style={s.input}
            type="tel"
            placeholder="Driver phone number (e.g. +91 9876543210)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          <button style={s.btn} type="submit" disabled={creating}>
            {creating ? 'Creating…' : '➕ Create Access'}
          </button>
        </form>

        {error && <div style={s.errorBanner}>⚠️ {error}</div>}

        {createResult && (
          <div style={s.successBox}>
            <strong>✅ Access created for {createResult.phone}</strong>
            <div style={s.passwordRow}>
              <span>Generated Password: </span>
              <code style={s.passwordCode}>{createResult.password}</code>
            </div>
            <p style={s.warningText}>
              ⚠️ Copy this password now — it will not be shown again.
              Share it with the driver along with the portal URL above.
            </p>
          </div>
        )}
      </div>

      {/* Access list */}
      <div style={s.card}>
        <h3 style={s.cardTitle}>Active Driver Accesses</h3>

        {loading && <div style={s.hint}>Loading…</div>}

        {!loading && accesses.length === 0 && (
          <div style={s.hint}>No driver accesses created yet.</div>
        )}

        {accesses.map((a) => {
          const expired = a.isExpired || a.isRevoked;
          return (
            <div key={a.id} style={{ ...s.accessRow, ...(expired ? s.accessRowExpired : {}) }}>
              <div style={s.accessMain}>
                <div style={s.accessPhone}>{a.phone}</div>
                <div style={s.accessMeta}>
                  Created: {new Date(a.createdAt).toLocaleDateString()}
                  {' · '}
                  Expires: {new Date(a.expiresAt).toLocaleDateString()}
                  {a.lastLoginAt && ` · Last login: ${new Date(a.lastLoginAt).toLocaleDateString()}`}
                </div>
                <div style={s.accessMeta}>
                  Uploads: {a.uploadCount}
                </div>
              </div>
              <div style={s.accessRight}>
                <span
                  style={{
                    ...s.badge,
                    ...(a.isRevoked ? s.badgeRevoked : a.isExpired ? s.badgeExpired : s.badgeActive),
                  }}
                >
                  {a.isRevoked ? 'Revoked' : a.isExpired ? 'Expired' : 'Active'}
                </span>
                {!a.isRevoked && !a.isExpired && (
                  <button
                    style={s.revokeBtn}
                    onClick={() => handleRevoke(a.id)}
                    disabled={revoking === a.id}
                  >
                    {revoking === a.id ? '…' : 'Revoke'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { maxWidth: 800, margin: '0 auto', padding: '0 16px' },
  pageTitle: { margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#1a1a2e' },
  pageSubtitle: { margin: '0 0 16px', color: '#555', fontSize: 14 },
  infoBox: {
    background: '#ebf4ff',
    border: '1px solid #bee3f8',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    marginBottom: 16,
    color: '#2b6cb0',
  },
  link: { color: '#4361ee', fontWeight: 600 },
  hint: { color: '#a0aec0', fontSize: 13 },
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: '20px',
    marginBottom: 16,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    border: '1px solid #e2e8f0',
  },
  cardTitle: { margin: '0 0 14px', fontSize: 16, fontWeight: 700, color: '#2d3748' },
  form: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  input: {
    flex: 1,
    minWidth: 220,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1.5px solid #ddd',
    fontSize: 14,
    outline: 'none',
  },
  btn: {
    padding: '10px 20px',
    background: '#4361ee',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  errorBanner: {
    marginTop: 12,
    background: '#fff5f5',
    border: '1px solid #fc8181',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#c53030',
    fontSize: 13,
  },
  successBox: {
    marginTop: 14,
    background: '#f0fff4',
    border: '1.5px solid #68d391',
    borderRadius: 10,
    padding: '14px',
    fontSize: 13,
    color: '#276749',
  },
  passwordRow: {
    margin: '10px 0 6px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 15,
  },
  passwordCode: {
    background: '#e6ffed',
    border: '1px solid #9ae6b4',
    borderRadius: 6,
    padding: '4px 10px',
    fontFamily: 'monospace',
    fontSize: 18,
    letterSpacing: 2,
    color: '#22543d',
    fontWeight: 700,
  },
  warningText: { margin: '4px 0 0', fontSize: 12, color: '#c05621' },
  accessRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '12px 0',
    borderBottom: '1px solid #f0f0f0',
    gap: 12,
  },
  accessRowExpired: { opacity: 0.6 },
  accessMain: { flex: 1 },
  accessPhone: { fontWeight: 600, fontSize: 15, color: '#2d3748' },
  accessMeta: { fontSize: 12, color: '#718096', marginTop: 3 },
  accessRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 },
  badge: {
    fontSize: 11,
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: 999,
    whiteSpace: 'nowrap',
  },
  badgeActive: { background: '#c6f6d5', color: '#276749' },
  badgeExpired: { background: '#feebc8', color: '#744210' },
  badgeRevoked: { background: '#fed7d7', color: '#742a2a' },
  revokeBtn: {
    padding: '4px 12px',
    background: '#fff5f5',
    border: '1px solid #fc8181',
    borderRadius: 6,
    color: '#c53030',
    fontSize: 12,
    cursor: 'pointer',
  },
};
