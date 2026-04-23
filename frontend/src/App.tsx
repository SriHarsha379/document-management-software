import { useState } from 'react';
import { DocumentUpload } from './components/DocumentUpload';
import { OCRReview } from './components/OCRReview';
import { DocumentList } from './components/DocumentList';
import { DocumentBundler } from './components/DocumentBundler';
import { SmartSearch } from './components/SmartSearch';
import { DispatchModal } from './components/DispatchModal';
import { DispatchHistory } from './components/DispatchHistory';
import type { Document, Bundle } from './types';

type View = 'list' | 'upload' | 'review' | 'bundle' | 'search' | 'dispatch';

function App() {
  const [view, setView] = useState<View>('list');
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
            style={{ ...styles.navBtn, ...(view === 'list' ? styles.navBtnActive : {}) }}
            onClick={() => setView('list')}
          >
            📋 Documents
          </button>
          <button
            style={{ ...styles.navBtn, ...(view === 'upload' ? styles.navBtnActive : {}) }}
            onClick={() => setView('upload')}
          >
            ➕ Upload
          </button>
          <button
            style={{ ...styles.navBtn, ...(view === 'bundle' ? styles.navBtnActive : {}) }}
            onClick={() => setView('bundle')}
          >
            📦 Bundle
          </button>
          <button
            style={{ ...styles.navBtn, ...(view === 'search' ? styles.navBtnActive : {}) }}
            onClick={() => setView('search')}
          >
            🔍 Search
          </button>
          <button
            style={{ ...styles.navBtn, ...(view === 'dispatch' ? styles.navBtnActive : {}) }}
            onClick={() => setView('dispatch')}
          >
            📤 Dispatch
          </button>
        </nav>
      </header>

      {/* Main content */}
      <main style={styles.main}>
        {view === 'list' && (
          <DocumentList onSelect={handleSelectFromList} refreshTrigger={refreshKey} />
        )}

        {view === 'upload' && (
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

        {view === 'bundle' && (
          <DocumentBundler onBundleSaved={handleBundleSaved} />
        )}

        {view === 'search' && (
          <SmartSearch />
        )}

        {view === 'dispatch' && (
          <DispatchHistory />
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
  main: { maxWidth: 1100, margin: '0 auto', padding: '24px 0' },
};

export default App;
