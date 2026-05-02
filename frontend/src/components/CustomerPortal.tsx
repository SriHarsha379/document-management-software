import { useState, useEffect } from 'react';
import { customerPortalApi } from '../services/api';
import type { CustomerShipment, CustomerShipmentDetail, CustomerMeResponse } from '../services/api';

// ─────────────────────────────────────────────────────────────────────────────
// Login Screen
// ─────────────────────────────────────────────────────────────────────────────
function LoginScreen({
  onLogin,
}: {
  onLogin: (token: string, partyName: string, loginEmail: string, expiresAt: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const resp = await customerPortalApi.login(email.trim(), token.trim());
      onLogin(resp.token, resp.partyName, resp.loginEmail, resp.expiresAt);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string; code?: string } } };
      const code = axiosErr?.response?.data?.code;
      const msg = axiosErr?.response?.data?.error ?? 'Login failed';
      setError(code === 'ACCESS_EXPIRED' ? 'Access Expired' : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logo}>📦</div>
        <h1 style={s.title}>Customer Portal</h1>
        <p style={s.subtitle}>View your shipment documents securely</p>

        {error && (
          <div style={error === 'Access Expired' ? s.expiredBanner : s.errorBanner}>
            {error === 'Access Expired' ? '🔒 Access Expired — contact your logistics partner' : `⚠️ ${error}`}
          </div>
        )}

        <form onSubmit={handleSubmit} style={s.form}>
          <label style={s.label}>Email Address</label>
          <input
            style={s.input}
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            inputMode="email"
          />

          <label style={s.label}>Access Token</label>
          <input
            style={s.input}
            type="password"
            placeholder="Token provided by your logistics partner"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            autoComplete="current-password"
          />

          <button style={{ ...s.btn, ...(loading ? s.btnDisabled : {}) }} type="submit" disabled={loading}>
            {loading ? 'Logging in…' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shipment List Screen
// ─────────────────────────────────────────────────────────────────────────────
function ShipmentListScreen({
  jwtToken,
  partyName,
  onSelectShipment,
  onLogout,
}: {
  jwtToken: string;
  partyName: string;
  onSelectShipment: (id: string) => void;
  onLogout: () => void;
}) {
  const [shipments, setShipments] = useState<CustomerShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [me, setMe] = useState<CustomerMeResponse | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [meData, shipmentsData] = await Promise.all([
          customerPortalApi.me(jwtToken),
          customerPortalApi.listShipments(jwtToken),
        ]);
        setMe(meData);
        setShipments(shipmentsData);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { code?: string } } };
        if (axiosErr?.response?.data?.code === 'ACCESS_EXPIRED') {
          setExpired(true);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [jwtToken]);

  if (expired) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.logo}>🔒</div>
          <h1 style={s.title}>Access Expired</h1>
          <p style={{ ...s.subtitle, color: '#e53e3e' }}>
            Your access has expired. Please contact your logistics partner to renew.
          </p>
          <button style={s.btn} onClick={onLogout}>Back to Login</button>
        </div>
      </div>
    );
  }

  const expiresAt = me?.expiresAt ? new Date(me.expiresAt) : null;
  const daysLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : null;

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={{ fontSize: 28 }}>📦</span>
          <div>
            <div style={s.headerPhone}>{partyName}</div>
            {daysLeft !== null && (
              <div style={s.headerExpiry}>
                {daysLeft > 0 ? `Access expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}` : 'Access expires today'}
              </div>
            )}
          </div>
        </div>
        <button style={s.logoutBtn} onClick={onLogout}>Logout</button>
      </div>

      <div style={s.content}>
        <div style={s.card}>
          <h2 style={s.sectionTitle}>My Shipments</h2>

          {loading && <div style={s.hint}>Loading shipments…</div>}

          {!loading && shipments.length === 0 && (
            <div style={s.hint}>
              No shipments available yet. Documents will appear here after your logistics partner dispatches them.
            </div>
          )}

          {shipments.map((shipment) => (
            <button
              key={shipment.id}
              style={s.shipmentRow}
              onClick={() => onSelectShipment(shipment.id)}
              type="button"
            >
              <div style={s.shipmentMain}>
                <div style={s.shipmentTitle}>
                  🚛 {shipment.vehicleNo}
                  <span style={{ ...s.statusBadge, ...(shipment.status === 'SENT' ? s.statusGreen : s.statusBlue) }}>
                    {shipment.status}
                  </span>
                </div>
                <div style={s.shipmentMeta}>
                  📅 {shipment.date} · 📄 {shipment.documentCount} document{shipment.documentCount !== 1 ? 's' : ''}
                </div>
                {shipment.lastDispatch && (
                  <div style={s.shipmentMeta}>
                    Last sent: {new Date(shipment.lastDispatch.sentAt).toLocaleString()} via {shipment.lastDispatch.channel}
                  </div>
                )}
              </div>
              <span style={s.chevron}>›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shipment Detail Screen
// ─────────────────────────────────────────────────────────────────────────────
function ShipmentDetailScreen({
  jwtToken,
  bundleId,
  onBack,
  onLogout,
}: {
  jwtToken: string;
  bundleId: string;
  onBack: () => void;
  onLogout: () => void;
}) {
  const [shipment, setShipment] = useState<CustomerShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await customerPortalApi.getShipment(jwtToken, bundleId);
        setShipment(data);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { code?: string; error?: string } } };
        if (axiosErr?.response?.data?.code === 'ACCESS_EXPIRED') {
          setExpired(true);
        } else {
          setError(axiosErr?.response?.data?.error ?? 'Failed to load shipment');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [jwtToken, bundleId]);

  const handleDownload = async (documentId: string, filename: string) => {
    setDownloading(documentId);
    try {
      const url = customerPortalApi.downloadUrl(documentId);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${jwtToken}` } });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      alert('Download failed — please try again');
    } finally {
      setDownloading(null);
    }
  };

  if (expired) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.logo}>🔒</div>
          <h1 style={s.title}>Access Expired</h1>
          <p style={{ ...s.subtitle, color: '#e53e3e' }}>Your access has expired. Please contact your logistics partner.</p>
          <button style={s.btn} onClick={onLogout}>Back to Login</button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.headerLeft}>
          <button style={s.backBtn} onClick={onBack}>← Back</button>
          <span style={s.headerPhone}>Shipment Details</span>
        </div>
        <button style={s.logoutBtn} onClick={onLogout}>Logout</button>
      </div>

      <div style={s.content}>
        {loading && (
          <div style={s.card}><div style={s.hint}>Loading…</div></div>
        )}

        {error && (
          <div style={s.card}><div style={s.errorBanner}>⚠️ {error}</div></div>
        )}

        {shipment && (
          <>
            {/* Shipment summary */}
            <div style={s.card}>
              <h2 style={s.sectionTitle}>🚛 {shipment.vehicleNo}</h2>
              <div style={s.detailGrid}>
                <div style={s.detailItem}><span style={s.detailLabel}>Date</span><span style={s.detailValue}>{shipment.date}</span></div>
                <div style={s.detailItem}><span style={s.detailLabel}>Status</span><span style={s.detailValue}>{shipment.status}</span></div>
                {shipment.notes && (
                  <div style={{ ...s.detailItem, gridColumn: '1 / -1' }}>
                    <span style={s.detailLabel}>Notes</span>
                    <span style={s.detailValue}>{shipment.notes}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Documents */}
            <div style={s.card}>
              <h2 style={s.sectionTitle}>
                📄 Documents ({shipment.documents.length})
              </h2>

              {shipment.documents.map((doc) => (
                <div key={doc.id} style={s.docRow}>
                  <div style={s.docMain}>
                    <div style={s.docTitle}>
                      {getDocIcon(doc.type)} {doc.type}
                      <span style={s.docFilename}>{doc.originalFilename}</span>
                    </div>
                    <div style={s.docMeta}>
                      Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
                      {doc.extractedData?.lrNo && ` · LR: ${doc.extractedData.lrNo}`}
                      {doc.extractedData?.invoiceNo && ` · Invoice: ${doc.extractedData.invoiceNo}`}
                    </div>
                  </div>
                  <button
                    style={{ ...s.downloadBtn, ...(downloading === doc.id ? s.btnDisabled : {}) }}
                    onClick={() => handleDownload(doc.id, doc.originalFilename)}
                    disabled={downloading === doc.id}
                    type="button"
                  >
                    {downloading === doc.id ? '⏳' : '⬇️'} Download
                  </button>
                </div>
              ))}

              {shipment.documents.length === 0 && (
                <div style={s.hint}>No documents in this bundle.</div>
              )}
            </div>

            {/* Dispatch history */}
            {shipment.dispatchLogs.length > 0 && (
              <div style={s.card}>
                <h2 style={s.sectionTitle}>📤 Dispatch History</h2>
                {shipment.dispatchLogs.map((log, i) => (
                  <div key={i} style={s.logRow}>
                    <span>{log.channel === 'EMAIL' ? '📧' : '📱'} {log.recipient}</span>
                    <span style={{ fontSize: 12, color: '#718096' }}>
                      {new Date(log.sentAt).toLocaleString()} · {log.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function getDocIcon(type: string): string {
  const icons: Record<string, string> = {
    LR: '📋', INVOICE: '🧾', TOLL: '🛣️', WEIGHMENT: '⚖️',
    EWAYBILL: '📝', RECEIVING: '📥', UNKNOWN: '📄',
  };
  return icons[type] ?? '📄';
}

// ─────────────────────────────────────────────────────────────────────────────
// Root CustomerPortal
// ─────────────────────────────────────────────────────────────────────────────
type PortalScreen = 'login' | 'shipments' | 'detail';

export function CustomerPortal() {
  const [screen, setScreen] = useState<PortalScreen>('login');
  const [jwtToken, setJwtToken] = useState<string | null>(() => localStorage.getItem('customerToken'));
  const [partyName, setPartyName] = useState<string>(() => localStorage.getItem('customerPartyName') ?? '');
  const [loginEmail, setLoginEmail] = useState<string>(() => localStorage.getItem('customerLoginEmail') ?? '');
  const [expiresAt, setExpiresAt] = useState<string>(() => localStorage.getItem('customerExpiresAt') ?? '');
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);

  // Auto-navigate to shipments if already logged in
  useEffect(() => {
    if (jwtToken && expiresAt && new Date(expiresAt) > new Date()) {
      setScreen('shipments');
    }
  }, [jwtToken, expiresAt]);

  const handleLogin = (token: string, name: string, email: string, expires: string) => {
    localStorage.setItem('customerToken', token);
    localStorage.setItem('customerPartyName', name);
    localStorage.setItem('customerLoginEmail', email);
    localStorage.setItem('customerExpiresAt', expires);
    setJwtToken(token);
    setPartyName(name);
    setLoginEmail(email);
    setExpiresAt(expires);
    setScreen('shipments');
  };

  const handleLogout = () => {
    localStorage.removeItem('customerToken');
    localStorage.removeItem('customerPartyName');
    localStorage.removeItem('customerLoginEmail');
    localStorage.removeItem('customerExpiresAt');
    setJwtToken(null);
    setPartyName('');
    setLoginEmail('');
    setExpiresAt('');
    setSelectedBundleId(null);
    setScreen('login');
  };

  if (screen === 'login' || !jwtToken) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (screen === 'detail' && selectedBundleId) {
    return (
      <ShipmentDetailScreen
        jwtToken={jwtToken}
        bundleId={selectedBundleId}
        onBack={() => setScreen('shipments')}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <ShipmentListScreen
      jwtToken={jwtToken}
      partyName={partyName || loginEmail}
      onSelectShipment={(id) => {
        setSelectedBundleId(id);
        setScreen('detail');
      }}
      onLogout={handleLogout}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles (inline, mobile-first — mirrors DriverPortal style guide)
// ─────────────────────────────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: '16px',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '24px 20px',
    width: '100%',
    maxWidth: 520,
    marginBottom: 16,
    boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
  },
  logo: { fontSize: 52, textAlign: 'center', display: 'block', marginBottom: 8 },
  title: { textAlign: 'center', margin: '0 0 4px', fontSize: 26, fontWeight: 700, color: '#1a1a2e' },
  subtitle: { textAlign: 'center', margin: '0 0 20px', color: '#666', fontSize: 14 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  label: { fontSize: 13, fontWeight: 600, color: '#444', marginBottom: 2 },
  input: {
    padding: '12px 14px', borderRadius: 10, border: '1.5px solid #ddd',
    fontSize: 16, outline: 'none', transition: 'border-color 0.15s',
  },
  btn: {
    padding: '14px', background: '#2c5364', color: '#fff',
    border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 600,
    cursor: 'pointer', marginTop: 4, transition: 'background 0.15s',
  },
  btnDisabled: { background: '#aaa', cursor: 'not-allowed' },
  errorBanner: {
    background: '#fff5f5', border: '1px solid #fc8181',
    borderRadius: 8, padding: '10px 14px', color: '#c53030', fontSize: 14,
  },
  expiredBanner: {
    background: '#fff5f5', border: '2px solid #fc8181', borderRadius: 8,
    padding: '14px', color: '#c53030', fontSize: 15, fontWeight: 600, textAlign: 'center',
  },
  header: {
    width: '100%', maxWidth: 520,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12, padding: '12px 16px',
    background: 'rgba(255,255,255,0.08)', borderRadius: 12, color: '#fff',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  headerPhone: { fontWeight: 700, fontSize: 15 },
  headerExpiry: { fontSize: 12, color: '#a0aec0' },
  logoutBtn: {
    background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
    padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
  },
  backBtn: {
    background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
    padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, marginRight: 8,
  },
  content: { width: '100%', maxWidth: 520 },
  sectionTitle: { margin: '0 0 14px', fontSize: 18, fontWeight: 700, color: '#1a1a2e' },
  hint: { color: '#a0aec0', fontSize: 14, textAlign: 'center', padding: '16px 0' },

  // Shipment list
  shipmentRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 0', borderBottom: '1px solid #f0f0f0',
    background: 'none',
    width: '100%', cursor: 'pointer', textAlign: 'left',
  },
  shipmentMain: { flex: 1 },
  shipmentTitle: {
    fontWeight: 600, fontSize: 15, color: '#2d3748',
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
  },
  shipmentMeta: { fontSize: 12, color: '#718096', marginTop: 2 },
  chevron: { fontSize: 22, color: '#a0aec0', marginLeft: 8 },
  statusBadge: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999 },
  statusGreen: { background: '#c6f6d5', color: '#276749' },
  statusBlue: { background: '#bee3f8', color: '#2a4365' },

  // Detail
  detailGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  detailItem: { display: 'flex', flexDirection: 'column', gap: 2 },
  detailLabel: { fontSize: 11, fontWeight: 600, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em' },
  detailValue: { fontSize: 15, fontWeight: 600, color: '#1a1a2e' },

  // Document rows
  docRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 0', borderBottom: '1px solid #f5f5f5', gap: 10,
  },
  docMain: { flex: 1, minWidth: 0 },
  docTitle: {
    fontWeight: 600, fontSize: 14, color: '#2d3748',
    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
  },
  docFilename: { fontSize: 12, fontWeight: 400, color: '#718096' },
  docMeta: { fontSize: 12, color: '#a0aec0', marginTop: 2 },
  downloadBtn: {
    padding: '8px 14px', background: '#2c5364', color: '#fff',
    border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap' as const,
  },

  // Dispatch log
  logRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 0', borderBottom: '1px solid #f5f5f5', fontSize: 13,
  },
};
