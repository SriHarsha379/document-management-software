import { useState, useRef, useEffect } from 'react';
import { driverPortalApi } from '../services/api';
import type { DriverDocType, DriverUploadDoc, DriverStatusResponse } from '../services/api';

const DOC_TYPES: { value: DriverDocType; label: string }[] = [
  { value: 'LR', label: '📄 LR (Lorry Receipt)' },
  { value: 'TOLL', label: '🛣️ Toll Receipt' },
  { value: 'WEIGHMENT_SLIP', label: '⚖️ Weighment Slip' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Login screen
// ─────────────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (token: string, phone: string, expiresAt: string) => void }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const resp = await driverPortalApi.login(phone.trim(), password);
      onLogin(resp.token, resp.phone, resp.expiresAt);
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
        <div style={s.logo}>🚛</div>
        <h1 style={s.title}>Driver Portal</h1>
        <p style={s.subtitle}>Logistics DMS – Document Upload</p>

        {error && (
          <div style={error === 'Access Expired' ? s.expiredBanner : s.errorBanner}>
            {error === 'Access Expired' ? '🔒 Access Expired' : `⚠️ ${error}`}
          </div>
        )}

        <form onSubmit={handleSubmit} style={s.form}>
          <label style={s.label}>Phone Number</label>
          <input
            style={s.input}
            type="tel"
            placeholder="+91 XXXXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            autoComplete="tel"
            inputMode="tel"
          />

          <label style={s.label}>Password</label>
          <input
            style={s.input}
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
// Upload screen
// ─────────────────────────────────────────────────────────────────────────────
function UploadScreen({
  token,
  phone,
  expiresAt,
  onLogout,
}: {
  token: string;
  phone: string;
  expiresAt: string;
  onLogout: () => void;
}) {
  const [status, setStatus] = useState<DriverStatusResponse | null>(null);
  const [docType, setDocType] = useState<DriverDocType>('LR');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<DriverUploadDoc[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Check expiry
  useEffect(() => {
    if (new Date(expiresAt) < new Date()) {
      setExpired(true);
    }
  }, [expiresAt]);

  // Fetch status & history on mount
  useEffect(() => {
    void (async () => {
      try {
        const s = await driverPortalApi.status(token);
        setStatus(s);
      } catch {
        setExpired(true);
      }
      setLoadingHistory(true);
      try {
        const history = await driverPortalApi.listUploads(token);
        setUploads(history);
      } catch {
        // ignore
      } finally {
        setLoadingHistory(false);
      }
    })();
  }, [token]);

  const handleFileChange = (f: File | null) => {
    setFile(f);
    if (f && f.type.startsWith('image/')) {
      setPreview(URL.createObjectURL(f));
    } else {
      setPreview(null);
    }
    setUploadError(null);
    setSuccessMsg(null);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setSuccessMsg(null);
    try {
      const doc = await driverPortalApi.upload(token, file, docType);
      setSuccessMsg(`✅ Uploaded successfully! ${doc.vehicleNumber ? `Vehicle: ${doc.vehicleNumber}` : ''} ${doc.linkedGroupId ? '| Linked to transaction' : '| Stored (unlinked – no matching transaction yet)'}`);
      setFile(null);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      // Refresh history
      const history = await driverPortalApi.listUploads(token);
      setUploads(history);
      if (status) setStatus({ ...status, uploadCount: status.uploadCount + 1 });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string; code?: string } } };
      const code = axiosErr?.response?.data?.code;
      if (code === 'ACCESS_EXPIRED') {
        setExpired(true);
      } else {
        setUploadError(axiosErr?.response?.data?.error ?? 'Upload failed');
      }
    } finally {
      setUploading(false);
    }
  };

  if (expired) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.logo}>🔒</div>
          <h1 style={s.title}>Access Expired</h1>
          <p style={{ ...s.subtitle, color: '#e53e3e' }}>
            Your temporary access has expired. Please contact your administrator to renew access.
          </p>
          <button style={s.btn} onClick={onLogout}>Back to Login</button>
        </div>
      </div>
    );
  }

  const expiryDate = new Date(expiresAt);
  const daysLeft = Math.max(0, Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.logo}>🚛</span>
          <div>
            <div style={s.headerPhone}>{phone}</div>
            <div style={s.headerExpiry}>
              {daysLeft > 0 ? `Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}` : 'Expires today'}
            </div>
          </div>
        </div>
        <button style={s.logoutBtn} onClick={onLogout}>Logout</button>
      </div>

      <div style={s.content}>
        {/* Upload card */}
        <div style={s.card}>
          <h2 style={s.sectionTitle}>Upload Document</h2>

          {/* Doc type selector */}
          <label style={s.label}>Document Type *</label>
          <div style={s.docTypeGrid}>
            {DOC_TYPES.map((dt) => (
              <button
                key={dt.value}
                style={{ ...s.docTypeBtn, ...(docType === dt.value ? s.docTypeBtnActive : {}) }}
                onClick={() => setDocType(dt.value)}
                type="button"
              >
                {dt.label}
              </button>
            ))}
          </div>

          {/* File / Camera */}
          <label style={s.label}>Select File</label>
          <div style={s.fileRow}>
            <button
              style={s.fileBtn}
              type="button"
              onClick={() => cameraInputRef.current?.click()}
            >
              📷 Camera
            </button>
            <button
              style={s.fileBtn}
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              📁 Browse
            </button>
          </div>

          {/* Hidden camera input (capture) */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
          />
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
          />

          {/* Preview */}
          {preview && (
            <img src={preview} alt="Preview" style={s.preview} />
          )}
          {file && !preview && (
            <div style={s.fileChip}>📎 {file.name} ({(file.size / 1024).toFixed(1)} KB)</div>
          )}

          {uploadError && <div style={s.errorBanner}>⚠️ {uploadError}</div>}
          {successMsg && <div style={s.successBanner}>{successMsg}</div>}

          <button
            style={{ ...s.btn, ...((!file || uploading) ? s.btnDisabled : {}) }}
            onClick={handleUpload}
            disabled={!file || uploading}
            type="button"
          >
            {uploading ? 'Uploading…' : '⬆️ Upload Document'}
          </button>
        </div>

        {/* Upload history */}
        <div style={s.card}>
          <h2 style={s.sectionTitle}>
            My Uploads {status ? `(${status.uploadCount})` : ''}
          </h2>

          {loadingHistory && <div style={s.hint}>Loading…</div>}

          {!loadingHistory && uploads.length === 0 && (
            <div style={s.hint}>No documents uploaded yet.</div>
          )}

          {uploads.map((u) => (
            <div key={u.id} style={s.uploadItem}>
              <div style={s.uploadItemTitle}>
                {DOC_TYPES.find((d) => d.value === u.docType)?.label ?? u.docType}
                <span style={{ ...s.statusBadge, ...(u.status === 'PROCESSED' ? s.statusGreen : u.status === 'UNLINKED' ? s.statusOrange : s.statusGray) }}>
                  {u.status === 'PROCESSED' ? 'Linked' : u.status === 'UNLINKED' ? 'Unlinked' : 'Processing'}
                </span>
              </div>
              <div style={s.uploadItemMeta}>
                {u.originalFilename} · {new Date(u.uploadedAt).toLocaleString()}
              </div>
              {u.vehicleNumber && (
                <div style={s.uploadItemMeta}>🚛 {u.vehicleNumber} {u.documentDate ? `· 📅 ${u.documentDate}` : ''}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root DriverPortal
// ─────────────────────────────────────────────────────────────────────────────
export function DriverPortal() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('driverToken'));
  const [phone, setPhone] = useState<string>(() => localStorage.getItem('driverPhone') ?? '');
  const [expiresAt, setExpiresAt] = useState<string>(() => localStorage.getItem('driverExpiresAt') ?? '');

  const handleLogin = (newToken: string, newPhone: string, newExpiresAt: string) => {
    localStorage.setItem('driverToken', newToken);
    localStorage.setItem('driverPhone', newPhone);
    localStorage.setItem('driverExpiresAt', newExpiresAt);
    setToken(newToken);
    setPhone(newPhone);
    setExpiresAt(newExpiresAt);
  };

  const handleLogout = () => {
    localStorage.removeItem('driverToken');
    localStorage.removeItem('driverPhone');
    localStorage.removeItem('driverExpiresAt');
    setToken(null);
    setPhone('');
    setExpiresAt('');
  };

  if (!token || !phone || !expiresAt) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <UploadScreen
      token={token}
      phone={phone}
      expiresAt={expiresAt}
      onLogout={handleLogout}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles (inline, mobile-first)
// ─────────────────────────────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
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
    maxWidth: 480,
    marginBottom: 16,
    boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
  },
  logo: { fontSize: 48, textAlign: 'center', display: 'block', marginBottom: 8 },
  title: { textAlign: 'center', margin: '0 0 4px', fontSize: 24, fontWeight: 700, color: '#1a1a2e' },
  subtitle: { textAlign: 'center', margin: '0 0 20px', color: '#666', fontSize: 14 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  label: { fontSize: 13, fontWeight: 600, color: '#444', marginBottom: 2 },
  input: {
    padding: '12px 14px',
    borderRadius: 10,
    border: '1.5px solid #ddd',
    fontSize: 16,
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  btn: {
    padding: '14px',
    background: '#4361ee',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 4,
    transition: 'background 0.15s',
  },
  btnDisabled: { background: '#aaa', cursor: 'not-allowed' },
  errorBanner: {
    background: '#fff5f5',
    border: '1px solid #fc8181',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#c53030',
    fontSize: 14,
  },
  expiredBanner: {
    background: '#fff5f5',
    border: '2px solid #fc8181',
    borderRadius: 8,
    padding: '14px',
    color: '#c53030',
    fontSize: 16,
    fontWeight: 600,
    textAlign: 'center',
  },
  successBanner: {
    background: '#f0fff4',
    border: '1px solid #68d391',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#276749',
    fontSize: 13,
  },
  header: {
    width: '100%',
    maxWidth: 480,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    color: '#fff',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  headerPhone: { fontWeight: 700, fontSize: 15 },
  headerExpiry: { fontSize: 12, color: '#a0aec0' },
  logoutBtn: {
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    color: '#fff',
    padding: '6px 14px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
  },
  content: { width: '100%', maxWidth: 480 },
  sectionTitle: { margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: '#1a1a2e' },
  docTypeGrid: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  docTypeBtn: {
    padding: '12px 14px',
    borderRadius: 10,
    border: '2px solid #e2e8f0',
    background: '#f7fafc',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'all 0.15s',
    color: '#2d3748',
  },
  docTypeBtnActive: {
    border: '2px solid #4361ee',
    background: '#ebf4ff',
    color: '#1a1a2e',
    fontWeight: 700,
  },
  fileRow: { display: 'flex', gap: 10, marginBottom: 12 },
  fileBtn: {
    flex: 1,
    padding: '14px',
    background: '#f7fafc',
    border: '2px dashed #cbd5e0',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    color: '#4a5568',
    transition: 'background 0.15s',
  },
  preview: {
    width: '100%',
    borderRadius: 10,
    marginBottom: 12,
    maxHeight: 200,
    objectFit: 'cover',
    border: '1px solid #e2e8f0',
  },
  fileChip: {
    background: '#ebf4ff',
    border: '1px solid #bee3f8',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 13,
    color: '#2b6cb0',
    marginBottom: 12,
  },
  hint: { color: '#a0aec0', fontSize: 14, textAlign: 'center', padding: '16px 0' },
  uploadItem: {
    padding: '12px 0',
    borderBottom: '1px solid #f0f0f0',
  },
  uploadItemTitle: {
    fontWeight: 600,
    fontSize: 14,
    color: '#2d3748',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  uploadItemMeta: { fontSize: 12, color: '#718096', marginTop: 3 },
  statusBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 999,
  },
  statusGreen: { background: '#c6f6d5', color: '#276749' },
  statusOrange: { background: '#feebc8', color: '#744210' },
  statusGray: { background: '#e2e8f0', color: '#4a5568' },
};
