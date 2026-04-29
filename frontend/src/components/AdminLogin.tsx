import { useState, type FormEvent } from 'react';
import axios from 'axios';
import { authApi } from '../services/api';
import { authService } from '../services/authService';

interface Props {
  onLogin: () => void;
}

export function AdminLogin({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <div style={s.overlay}>
      <div style={s.card}>
        <div style={s.logo}>🚛 Logistics DMS</div>
        <h2 style={s.title}>Admin Login</h2>
        <form onSubmit={(e) => { void handleSubmit(e); }} style={s.form}>
          <label style={s.label}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={s.input}
            placeholder="admin@example.com"
            autoComplete="email"
            required
          />
          <label style={s.label}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={s.input}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
          {error && <p style={s.error}>{error}</p>}
          <button type="submit" disabled={loading} style={s.btn}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f4f5ff',
  },
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: '40px 36px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
    width: '100%',
    maxWidth: 380,
  },
  logo: {
    fontWeight: 800,
    fontSize: 20,
    color: '#1a1a2e',
    marginBottom: 8,
    textAlign: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: '#333',
    marginBottom: 24,
    textAlign: 'center',
  },
  form: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 2, marginTop: 10 },
  input: {
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: 6,
    fontSize: 14,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  error: { color: '#e53e3e', fontSize: 13, margin: '8px 0 0' },
  btn: {
    marginTop: 20,
    padding: '11px',
    background: '#4361ee',
    color: '#fff',
    border: 'none',
    borderRadius: 7,
    fontWeight: 700,
    fontSize: 15,
    cursor: 'pointer',
    width: '100%',
  },
};
