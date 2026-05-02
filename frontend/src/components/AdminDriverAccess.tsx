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
    try { const list = await adminDriverAccessApi.list(); setAccesses(list); }
    catch { setError('Failed to load driver accesses'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadAccesses(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setCreating(true); setError(null); setCreateResult(null);
    try {
      const res = await adminDriverAccessApi.create(phone.trim());
      setCreateResult({ password: res.generatedPassword, phone: res.driverAccess.phone });
      setPhone(''); await loadAccesses();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr?.response?.data?.error ?? 'Failed to create driver access');
    } finally { setCreating(false); }
  };

  const handleRevoke = async (id: string) => {
    setRevoking(id);
    try { await adminDriverAccessApi.revoke(id); await loadAccesses(); }
    catch { setError('Failed to revoke access'); }
    finally { setRevoking(null); }
  };

  const portalUrl = `${window.location.origin}/driver`;

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={pageHeader}>
        <div>
          <h2 style={pageTitle}>🚛 Temporary Driver Access</h2>
          <p style={pageSubtitle}>Create time-limited access for drivers to upload documents. Expires automatically after <strong>7 days</strong>.</p>
        </div>
      </div>

      <div style={infoBox}>
        <strong>Driver Portal URL:</strong>{' '}
        <a href={portalUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#4361ee', fontWeight: 600 }}>{portalUrl}</a>
        <span style={{ color: '#6b7280' }}> — share this with drivers</span>
      </div>

      {/* Create form */}
      <div style={card}>
        <h3 style={cardTitle}>Create / Renew Driver Access</h3>
        <form onSubmit={(e) => { void handleCreate(e); }} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
          <input
            style={inputStyle}
            type="tel"
            placeholder="Driver phone number (e.g. +91 9876543210)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          <button
            style={{ padding: '10px 18px', background: creating ? '#9ca3af' : '#4361ee', color: '#fff', border: 'none', borderRadius: 8, cursor: creating ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 14, boxShadow: creating ? 'none' : '0 2px 8px rgba(67,97,238,0.25)', transition: 'background 0.15s', whiteSpace: 'nowrap' as const }}
            type="submit"
            disabled={creating}
          >
            {creating ? 'Creating…' : '➕ Create Access'}
          </button>
        </form>

        {error && <div style={errorBox}>⚠️ {error}</div>}

        {createResult && (
          <div style={{ background: '#d1fae5', border: '1.5px solid #6ee7b7', borderRadius: 10, padding: '16px', marginTop: 14 }}>
            <strong style={{ color: '#065f46', fontSize: 14 }}>✅ Access created for {createResult.phone}</strong>
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#374151' }}>Generated Password:</span>
              <code style={{ background: '#fff', border: '1px solid #a7f3d0', borderRadius: 6, padding: '3px 10px', fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: '#1a1a2e', letterSpacing: '0.06em' }}>{createResult.password}</code>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 12, color: '#7c3aed' }}>⚠️ Copy this password now — it will not be shown again. Share it with the driver along with the portal URL above.</p>
          </div>
        )}
      </div>

      {/* Access list */}
      <div style={card}>
        <h3 style={cardTitle}>Active Driver Accesses</h3>
        {loading && <div style={{ color: '#9ca3af', fontSize: 13, padding: '8px 0' }}>Loading…</div>}
        {!loading && accesses.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13, padding: '8px 0' }}>No driver accesses created yet.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {accesses.map((a) => {
            const expired = a.isExpired || a.isRevoked;
            return (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: 9, border: '1px solid', borderColor: expired ? '#f0f0f0' : '#e0e0f0', background: expired ? '#fafafa' : '#fff', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: expired ? '#9ca3af' : '#1a1a2e' }}>{a.phone}</div>
                  <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                    Created: {new Date(a.createdAt).toLocaleDateString()} · Expires: {new Date(a.expiresAt).toLocaleDateString()}
                    {a.lastLoginAt && ` · Last login: ${new Date(a.lastLoginAt).toLocaleDateString()}`} · Uploads: {a.uploadCount}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: a.isRevoked ? '#fef2f2' : a.isExpired ? '#f9fafb' : '#d1fae5', color: a.isRevoked ? '#b91c1c' : a.isExpired ? '#9ca3af' : '#065f46', border: '1px solid', borderColor: a.isRevoked ? '#fca5a5' : a.isExpired ? '#e0e0e0' : '#6ee7b7' }}>
                    {a.isRevoked ? 'Revoked' : a.isExpired ? 'Expired' : 'Active'}
                  </span>
                  {!a.isRevoked && !a.isExpired && (
                    <button
                      style={{ padding: '5px 12px', background: '#fff', border: '1px solid #fca5a5', borderRadius: 7, cursor: revoking === a.id ? 'not-allowed' : 'pointer', fontSize: 13, color: '#b91c1c', fontWeight: 600 }}
                      onClick={() => { void handleRevoke(a.id); }}
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
    </div>
  );
}

const pageHeader: React.CSSProperties = { marginBottom: 16 };
const pageTitle: React.CSSProperties = { margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: '#1a1a2e' };
const pageSubtitle: React.CSSProperties = { margin: 0, color: '#6b7280', fontSize: 14 };
const infoBox: React.CSSProperties = { background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 9, padding: '10px 14px', fontSize: 13, marginBottom: 16, color: '#1e40af' };
const card: React.CSSProperties = { background: '#fff', borderRadius: 12, padding: '20px', marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #e0e0f0' };
const cardTitle: React.CSSProperties = { margin: '0 0 14px', fontSize: 15, fontWeight: 700, color: '#1a1a2e' };
const inputStyle: React.CSSProperties = { flex: 1, minWidth: 220, padding: '10px 12px', borderRadius: 8, border: '1.5px solid #d0d0e0', fontSize: 14, outline: 'none', color: '#1a1a2e', fontFamily: 'inherit' };
const errorBox: React.CSSProperties = { background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '8px 12px', color: '#b91c1c', fontSize: 13, marginTop: 10 };
