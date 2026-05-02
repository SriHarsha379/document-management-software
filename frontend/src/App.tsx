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

const HASH_VIEWS: View[] = ['dashboard', 'list', 'upload', 'bundle', 'search', 'dispatch', 'drivers', 'customers', 'master'];

function viewFromHash(): View {
  const raw = window.location.hash.replace('#', '') as View;
  return HASH_VIEWS.includes(raw) ? raw : 'dashboard';
}

function App() {
  const [isDriverPortal, setIsDriverPortal] = useState(false);
  const [isCustomerPortal, setIsCustomerPortal] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => authService.isAuthenticated());

  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith('/driver')) setIsDriverPortal(true);
    else if (path.startsWith('/customer-portal')) setIsCustomerPortal(true);
  }, []);

  if (isDriverPortal) return <DriverPortal />;
  if (isCustomerPortal) return <CustomerPortal />;
  if (!isAuthenticated) return <AdminLogin onLogin={() => setIsAuthenticated(true)} />;

  return (
    <UserProvider>
      <AdminApp onLogout={() => { authService.clearToken(); setIsAuthenticated(false); }} />
    </UserProvider>
  );
}

interface NavItem { view: View; icon: string; label: string; }

function AdminApp({ onLogout }: { onLogout: () => void }) {
  const { user, hasPermission } = useCurrentUser();
  const [view, setViewState] = useState<View>(viewFromHash);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dispatchBundle, setDispatchBundle] = useState<Bundle | null>(null);

  const canUpload       = hasPermission(PERM.DOCUMENT_UPLOAD);
  const canBundle       = hasPermission(PERM.COMMUNICATION_SEND);
  const canDispatch     = hasPermission(PERM.COMMUNICATION_READ);
  const canManageUsers  = hasPermission(PERM.USER_MANAGE);
  const canManageMaster = hasPermission(PERM.MASTER_MANAGE);
  const canReadMaster   = hasPermission(PERM.MASTER_READ);

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
  }, []);

  const setView = (v: View) => {
    if (HASH_VIEWS.includes(v)) window.location.hash = v;
    setViewState(v);
  };

  useEffect(() => {
    const onHashChange = () => setViewState(viewFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleDocumentReady = (doc: Document) => { setSelectedDoc(doc); setView('review'); };
  const handleSaved = (_doc: Document) => { setRefreshKey((k) => k + 1); setView('list'); setSelectedDoc(null); };
  const handleSelectFromList = (doc: Document) => { setSelectedDoc(doc); setView('review'); };
  const handleBundleSaved = (bundle: Bundle) => { setDispatchBundle(bundle); };

  const allNavItems: (NavItem & { permitted: boolean })[] = [
    { view: 'dashboard',  icon: '📊', label: 'Dashboard',   permitted: true },
    { view: 'list',       icon: '📋', label: 'Documents',   permitted: true },
    { view: 'upload',     icon: '➕', label: 'Upload',       permitted: canUpload },
    { view: 'bundle',     icon: '📦', label: 'Bundle',       permitted: canBundle },
    { view: 'search',     icon: '🔍', label: 'Search',       permitted: true },
    { view: 'dispatch',   icon: '📤', label: 'Dispatch',     permitted: canDispatch },
    { view: 'drivers',    icon: '🚛', label: 'Drivers',      permitted: canManageUsers },
    { view: 'customers',  icon: '🏢', label: 'Customers',    permitted: canManageUsers },
    { view: 'master',     icon: '🗂️', label: 'Master Data',  permitted: canReadMaster },
  ];
  const navItems: NavItem[] = allNavItems.filter((n) => n.permitted);
  const activeItem = navItems.find((n) => n.view === view);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif", background: '#f4f5ff' }}>

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside style={{
        width: sidebarOpen ? 220 : 64,
        background: '#1a1a2e',
        boxShadow: '2px 0 8px rgba(0,0,0,0.15)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        transition: 'width 0.2s ease', overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px',
          minHeight: 60, borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>🚛</span>
          {sidebarOpen && (
            <span style={{ fontWeight: 800, color: '#fff', fontSize: 13, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
              Logistics DMS
            </span>
          )}
        </div>

        <nav style={{ flex: 1, overflowY: 'auto', padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {navItems.map((item) => (
            <NavBtn
              key={item.view}
              item={item}
              active={view === item.view}
              collapsed={!sidebarOpen}
              onClick={() => setView(item.view)}
            />
          ))}
        </nav>

        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 6, padding: '12px 8px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            background: 'transparent', border: 'none',
            color: 'rgba(255,255,255,0.4)', fontSize: 12, cursor: 'pointer',
            transition: 'color 0.15s', whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#fff'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.4)'; }}
        >
          {sidebarOpen ? <>◀ <span>Collapse</span></> : '▶'}
        </button>
      </aside>

      {/* ── Right panel ─────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px', minHeight: 60, flexShrink: 0,
          background: '#fff', borderBottom: '1px solid #e0e0f0',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e' }}>
            {activeItem ? `${activeItem.icon} ${activeItem.label}` : '👁 Review'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {user?.isSuperAdmin && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99,
                background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(165,180,252,0.5)', color: '#6366f1',
              }}>
                🌐 Super Admin
              </span>
            )}
            <button
              onClick={onLogout}
              style={{
                padding: '6px 14px', fontSize: 13, fontWeight: 500,
                background: '#f0f0f8', border: '1px solid #e0e0f0', borderRadius: 7,
                cursor: 'pointer', color: '#1a1a2e', transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#e4e5f8'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#f0f0f8'; }}
            >
              Sign Out
            </button>
          </div>
        </header>

        <main style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            {view === 'dashboard' && <LrDashboard />}
            {view === 'list' && <DocumentList onSelect={handleSelectFromList} refreshTrigger={refreshKey} />}
            {view === 'upload' && canUpload && <DocumentUpload onDocumentReady={handleDocumentReady} />}
            {view === 'review' && selectedDoc && (
              <OCRReview
                document={selectedDoc}
                onSaved={handleSaved}
                onCancel={() => { setRefreshKey((k) => k + 1); setView('list'); setSelectedDoc(null); }}
              />
            )}
            {view === 'bundle' && canBundle && <DocumentBundler onBundleSaved={handleBundleSaved} />}
            {view === 'search' && <SmartSearch />}
            {view === 'dispatch' && canDispatch && <DispatchHistory />}
            {view === 'drivers' && canManageUsers && <AdminDriverAccess />}
            {view === 'customers' && canManageUsers && <AdminCustomerPortalAccess />}
            {view === 'master' && canReadMaster && <MasterParties canManage={canManageMaster} />}
          </div>
        </main>
      </div>

      {dispatchBundle && (
        <DispatchModal
          bundle={dispatchBundle}
          onClose={() => setDispatchBundle(null)}
          onSent={() => { /* log recorded on backend */ }}
        />
      )}
    </div>
  );
}

function NavBtn({ item, active, collapsed, onClick }: {
  item: NavItem; active: boolean; collapsed: boolean; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center',
        gap: collapsed ? 0 : 10,
        justifyContent: collapsed ? 'center' : 'flex-start',
        width: '100%', padding: collapsed ? '9px 0' : '9px 12px',
        borderRadius: 8, border: 'none', cursor: 'pointer',
        fontSize: 13, fontWeight: active ? 600 : 500,
        background: active ? 'rgba(67,97,238,0.85)' : hovered ? 'rgba(255,255,255,0.08)' : 'transparent',
        color: active ? '#fff' : hovered ? '#fff' : 'rgba(255,255,255,0.65)',
        boxShadow: active ? '0 2px 8px rgba(67,97,238,0.3)' : 'none',
        transition: 'all 0.15s', whiteSpace: 'nowrap', overflow: 'hidden', outline: 'none',
      }}
    >
      <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
      {!collapsed && <span>{item.label}</span>}
    </button>
  );
}

export default App;
