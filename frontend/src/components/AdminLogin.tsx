import { useState, type FormEvent } from 'react';
import axios from 'axios';
import { authApi } from '../services/api';
import { authService } from '../services/authService';

interface Props { onLogin: () => void; }

export function AdminLogin({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      const result = await authApi.login(email.trim(), password);
      authService.setToken(result.token);
      authService.setUser(result.user);
      onLogin();
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Login failed. Please check your credentials.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.page}>
      {/* Decorative circles */}
      <div style={{ ...s.blob, top: -80, left: -80, width: 300, height: 300, opacity: 0.18 }} />
      <div style={{ ...s.blob, bottom: -60, right: -60, width: 240, height: 240, opacity: 0.14 }} />

      <div style={s.card}>
        {/* Logo */}
        <div style={s.logoWrap}>
          <div style={s.logoCircle}>🚛</div>
        </div>

        <h1 style={s.title}>Logistics DMS</h1>
        <p style={s.subtitle}>Sign in to your admin account</p>

        <form onSubmit={(e) => { void handleSubmit(e); }} style={s.form}>
          <div style={s.fieldGroup}>
            <label style={s.label}>Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={s.input}
              placeholder="admin@example.com"
              autoComplete="email"
              required
            />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Password</label>
            <div style={s.pwdWrap}>
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ ...s.input, paddingRight: 42 }}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                style={s.eyeBtn}
                onClick={() => setShowPwd(!showPwd)}
                tabIndex={-1}
                title={showPwd ? 'Hide password' : 'Show password'}
              >
                {showPwd ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {error && (
            <div style={s.errorBox}>
              <span>⚠️</span> {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{ ...s.btn, ...(loading ? s.btnLoading : {}) }}
            onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = '#3651d4'; }}
            onMouseLeave={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = '#4361ee'; }}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                <span style={s.spinner} />
                Signing in…
              </span>
            ) : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%)',
    padding: 16,
    position: 'relative',
    overflow: 'hidden',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  blob: {
    position: 'absolute',
    borderRadius: '50%',
    background: 'radial-gradient(circle, #4361ee, transparent)',
    pointerEvents: 'none',
  },
  card: {
    background: '#fff',
    borderRadius: 18,
    padding: '40px 36px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    width: '100%',
    maxWidth: 400,
    position: 'relative',
    zIndex: 1,
  },
  logoWrap: { display: 'flex', justifyContent: 'center', marginBottom: 16 },
  logoCircle: {
    width: 64, height: 64, borderRadius: '50%',
    background: 'linear-gradient(135deg, #4361ee, #3651d4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 28, boxShadow: '0 4px 16px rgba(67,97,238,0.4)',
  },
  title: { textAlign: 'center', fontSize: 22, fontWeight: 800, color: '#1a1a2e', margin: '0 0 4px' },
  subtitle: { textAlign: 'center', fontSize: 13, color: '#6b7280', margin: '0 0 28px' },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, fontWeight: 600, color: '#374151', letterSpacing: '0.02em' },
  input: {
    padding: '11px 13px',
    border: '1.5px solid #d1d5db',
    borderRadius: 9,
    fontSize: 14,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
    transition: 'border-color 0.15s, box-shadow 0.15s',
    fontFamily: 'inherit',
    color: '#1a1a2e',
  },
  pwdWrap: { position: 'relative' },
  eyeBtn: {
    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
    background: 'none', border: 'none', cursor: 'pointer', fontSize: 16,
    padding: '2px 4px', lineHeight: 1,
  },
  errorBox: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#fef2f2', border: '1px solid #fca5a5',
    borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#b91c1c',
  },
  btn: {
    padding: '12px',
    background: '#4361ee',
    color: '#fff',
    border: 'none',
    borderRadius: 9,
    fontWeight: 700,
    fontSize: 15,
    cursor: 'pointer',
    width: '100%',
    marginTop: 4,
    transition: 'background 0.15s, box-shadow 0.15s, transform 0.1s',
    boxShadow: '0 4px 12px rgba(67,97,238,0.3)',
    fontFamily: 'inherit',
  },
  btnLoading: {
    background: '#9ca3af',
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  spinner: {
    width: 14, height: 14, borderRadius: '50%',
    border: '2px solid rgba(255,255,255,0.4)',
    borderTopColor: '#fff',
    display: 'inline-block',
    animation: 'spin 0.7s linear infinite',
  },
};
