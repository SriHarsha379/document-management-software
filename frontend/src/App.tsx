import { useState, useEffect } from 'react';
import { DocumentUpload } from './components/DocumentUpload';
import { OCRReview } from './components/OCRReview';
import { DocumentList } from './components/DocumentList';
import { DocumentBundler } from './components/DocumentBundler';
import { SmartSearch } from './components/SmartSearch';
import { DispatchModal } from './components/DispatchModal';
import { DispatchHistory } from './components/DispatchHistory';
import { AdminDriverAccess } from './components/AdminDriverAccess';
import { AdminCustomerPortalAccess } from './components/AdminCustomerPortalAccess';
import { MasterParties } from './components/MasterParties';
import { DriverPortal } from './components/DriverPortal';
import { CustomerPortal } from './components/CustomerPortal';
import { LrDashboard } from './components/LrDashboard';
import { AdminLogin } from './components/AdminLogin';
import { authService } from './services/authService';
import { UserProvider, useCurrentUser, PERM } from './contexts/UserContext';
import type { Document, Bundle } from './types';

type View = 'dashboard' | 'list' | 'upload' | 'review' | 'bundle' | 'search' | 'dispatch' | 'drivers' | 'customers' | 'master';

// ── URL-hash routing helpers ──────────────────────────────────────────────────
// Views that should be persisted in the URL hash.  'review' is intentionally
// excluded because it depends on a selected-document state that cannot be
// serialised into the URL; refreshing from that state falls back to 'list'.
const HASH_VIEWS: View[] = ['dashboard', 'list', 'upload', 'bundle', 'search', 'dispatch', 'drivers', 'customers', 'master'];

function viewFromHash(): View {
  const raw = window.location.hash.replace('#', '') as View;
  return HASH_VIEWS.includes(raw) ? raw : 'dashboard';
}

function App() {
  const [isDriverPortal, setIsDriverPortal] = useState(false);
  const [isCustomerPortal, setIsCustomerPortal] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => authService.isAuthenticated());

  // Route /driver path to the driver portal, /customer-portal to the customer portal
  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith('/driver')) {
      setIsDriverPortal(true);
    } else if (path.startsWith('/customer-portal')) {
      setIsCustomerPortal(true);
    }
  }, []);

  if (isDriverPortal) {
    return <DriverPortal />;
  }

  if (isCustomerPortal) {
    return <CustomerPortal />;
  }

  if (!isAuthenticated) {
    return <AdminLogin onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <UserProvider>
      <AdminApp onLogout={() => { authService.clearToken(); setIsAuthenticated(false); }} />
    </UserProvider>
  );
}

function AdminApp({ onLogout }: { onLogout: () => void }) {
  const { user, hasPermission } = useCurrentUser();
  const [view, setViewState] = useState<View>(viewFromHash);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Permission flags for nav / actions ──────────────────────────────────
  const canUpload   = hasPermission(PERM.DOCUMENT_UPLOAD);
  const canBundle   = hasPermission(PERM.COMMUNICATION_SEND);
  const canDispatch = hasPermission(PERM.COMMUNICATION_READ);
  const canManageUsers  = hasPermission(PERM.USER_MANAGE);
  const canManageMaster = hasPermission(PERM.MASTER_MANAGE);
  const canReadMaster   = hasPermission(PERM.MASTER_READ);

  // If the initial hash points to a tab the user cannot access, fall back to dashboard.
  // Intentionally run only on mount — we only want to correct the initial URL-hash view,
  // not redirect on every permission re-check.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const inaccessible =
      (view === 'upload'    && !canUpload) ||
      (view === 'bundle'    && !canBundle) ||
      (view === 'dispatch'  && !canDispatch) ||
      (view === 'drivers'   && !canManageUsers) ||
      (view === 'customers' && !canManageUsers) ||
      (view === 'master'    && !canReadMaster);
    if (inaccessible) setViewState('dashboard');
  }, []); // only runs on mount to correct stale URL-hash navigation

  // Keep the URL hash in sync when the view changes programmatically.
  const setView = (v: View) => {
    if (HASH_VIEWS.includes(v)) {
      window.location.hash = v;
    }
    setViewState(v);
  };

  // Sync view ← hash when the user navigates with browser back/forward.
  useEffect(() => {
    const onHashChange = () => setViewState(viewFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleDocumentReady = (doc: Document) => {
    setSelectedDoc(doc);
    setView('review');
  };

  const handleSaved = (_doc: Document) => {
    setRefreshKey((k) => k + 1);
    setView('list');
    setSelectedDoc(null);
  };

  const handleSelectFromList = (doc: Document) => {
    setSelectedDoc(doc);
    setView('review');
  };

  const [dispatchBundle, setDispatchBundle] = useState<Bundle | null>(null);

  const handleBundleSaved = (bundle: Bundle) => {
    // Offer to dispatch the newly created bundle immediately
    setDispatchBundle(bundle);
  };

  return (
    <div style={styles.app}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.logo}>🚛 Logistics DMS</div>
        <nav style={styles.nav}>
          <button
            style={{ ...styles.navBtn, ...(view === 'dashboard' ? styles.navBtnActive : {}) }}
            onClick={() => setView('dashboard')}
          >
            📊 Dashboard
          </button>
          <button
            style={{ ...styles.navBtn, ...(view === 'list' ? styles.navBtnActive : {}) }}
            onClick={() => setView('list')}
          >
            📋 Documents
          </button>
          {canUpload && (
            <button
              style={{ ...styles.navBtn, ...(view === 'upload' ? styles.navBtnActive : {}) }}
              onClick={() => setView('upload')}
            >
              ➕ Upload
            </button>
          )}
          {canBundle && (
            <button
              style={{ ...styles.navBtn, ...(view === 'bundle' ? styles.navBtnActive : {}) }}
              onClick={() => setView('bundle')}
            >
              📦 Bundle
            </button>
          )}
          <button
            style={{ ...styles.navBtn, ...(view === 'search' ? styles.navBtnActive : {}) }}
            onClick={() => setView('search')}
          >
            🔍 Search
          </button>
          {canDispatch && (
            <button
              style={{ ...styles.navBtn, ...(view === 'dispatch' ? styles.navBtnActive : {}) }}
              onClick={() => setView('dispatch')}
            >
              📤 Dispatch
            </button>
          )}
          {canManageUsers && (
            <button
              style={{ ...styles.navBtn, ...(view === 'drivers' ? styles.navBtnActive : {}) }}
              onClick={() => setView('drivers')}
            >
              🚛 Drivers
            </button>
          )}
          {canManageUsers && (
            <button
              style={{ ...styles.navBtn, ...(view === 'customers' ? styles.navBtnActive : {}) }}
              onClick={() => setView('customers')}
            >
              🏢 Customers
            </button>
          )}
          {canReadMaster && (
            <button
              style={{ ...styles.navBtn, ...(view === 'master' ? styles.navBtnActive : {}) }}
              onClick={() => setView('master')}
            >
              🗂️ Master Data
            </button>
          )}
        </nav>
        <div style={styles.headerRight}>
          {user?.isSuperAdmin && (
            <span style={styles.superAdminBadge} title="You have cross-company super-admin access">
              🌐 Super Admin
            </span>
          )}
          <button style={styles.logoutBtn} onClick={onLogout}>
            Sign Out
          </button>
        </div>
      </header>

      {/* Main content */}
      <main style={styles.main}>
        {view === 'dashboard' && (
          <LrDashboard />
        )}

        {view === 'list' && (
          <DocumentList onSelect={handleSelectFromList} refreshTrigger={refreshKey} />
        )}

        {view === 'upload' && canUpload && (
          <DocumentUpload onDocumentReady={handleDocumentReady} />
        )}

        {view === 'review' && selectedDoc && (
          <OCRReview
            document={selectedDoc}
            onSaved={handleSaved}
            onCancel={() => {
              setRefreshKey((k) => k + 1);
              setView('list');
              setSelectedDoc(null);
            }}
          />
        )}

        {view === 'bundle' && canBundle && (
          <DocumentBundler onBundleSaved={handleBundleSaved} />
        )}

        {view === 'search' && (
          <SmartSearch />
        )}

        {view === 'dispatch' && canDispatch && (
          <DispatchHistory />
        )}

        {view === 'drivers' && canManageUsers && (
          <AdminDriverAccess />
        )}

        {view === 'customers' && canManageUsers && (
          <AdminCustomerPortalAccess />
        )}

        {view === 'master' && canReadMaster && (
          <MasterParties canManage={canManageMaster} />
        )}

        {/* Dispatch modal — rendered on top of any view */}
        {dispatchBundle && (
          <DispatchModal
            bundle={dispatchBundle}
            onClose={() => setDispatchBundle(null)}
            onSent={() => { /* log recorded on backend */ }}
          />
        )}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: { fontFamily: "'Segoe UI', system-ui, sans-serif", minHeight: '100vh', background: '#f4f5ff' },
  header: {
    background: '#1a1a2e',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 24px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
  },
  logo: { fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em' },
  nav: { display: 'flex', gap: 8 },
  navBtn: {
    padding: '8px 16px', border: 'none', borderRadius: 6,
    cursor: 'pointer', fontSize: 14, fontWeight: 500,
    background: 'rgba(255,255,255,0.1)', color: '#fff',
    transition: 'background 0.15s',
  },
  navBtnActive: { background: '#4361ee' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 10 },
  superAdminBadge: {
    padding: '5px 10px',
    background: 'rgba(99,102,241,0.35)',
    border: '1px solid rgba(165,180,252,0.5)',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 700,
    color: '#c7d2fe',
    letterSpacing: '0.02em',
  },
  logoutBtn: {
    padding: '7px 14px',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    background: 'transparent',
    color: '#fff',
  },
  main: { maxWidth: 1100, margin: '0 auto', padding: '24px 0' },
};

export default App;
