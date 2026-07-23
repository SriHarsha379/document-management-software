import React, { useState } from 'react';
import type { Document } from '../types';
import { DOCUMENT_TYPE_LABELS } from '../constants/documentTypeLabels';

interface ImagePreviewModalProps {
  docs: Document[];
  header: string;
  onClose: () => void;
  /** Zero-based index to open the viewer at. Defaults to 0. */
  initialIndex?: number;
}

export function ImagePreviewModal({ docs, header, onClose, initialIndex = 0 }: ImagePreviewModalProps) {
  const [current, setCurrent] = useState(Math.max(0, Math.min(initialIndex, docs.length - 1)));
  const doc = docs[Math.min(current, docs.length - 1)];

  if (!doc) return null;

  const url = `/uploads/${doc.filePath}`;
  const isPdf = doc.mimeType === 'application/pdf';

  return (
    <div style={iv.backdrop} onClick={onClose}>
      <div style={iv.modal} onClick={(e) => e.stopPropagation()}>
        <div style={iv.header}>
          <span style={iv.title}>🔍 {header}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={iv.openBtn}
              title="Open in new tab"
            >
              ↗ Open
            </a>
            <button style={iv.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>
        <div style={iv.body}>
          {isPdf ? (
            <iframe src={url} style={iv.iframe} title={doc.originalFilename} />
          ) : (
            <img src={url} alt={doc.originalFilename} style={iv.img} />
          )}
        </div>
        {docs.length > 1 && (
          <div style={iv.nav}>
            <button
              style={iv.navBtn}
              disabled={current === 0}
              onClick={() => setCurrent((c) => c - 1)}
            >
              ‹ Prev
            </button>
            <span style={iv.navLabel}>
              {DOCUMENT_TYPE_LABELS[doc.type]} {current + 1} of {docs.length}
            </span>
            <button
              style={iv.navBtn}
              disabled={current === docs.length - 1}
              onClick={() => setCurrent((c) => c + 1)}
            >
              Next ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const iv: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1100, padding: 16,
  },
  modal: {
    background: '#fff', borderRadius: 14, boxShadow: '0 8px 48px rgba(0,0,0,0.35)',
    width: '100%', maxWidth: 860, maxHeight: '92vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 18px', borderBottom: '1px solid #e0e0f0', flexShrink: 0,
  },
  title: { fontSize: 15, fontWeight: 700, color: '#1a1a2e', margin: 0 },
  openBtn: {
    padding: '5px 12px', background: '#4361ee', color: '#fff',
    borderRadius: 6, fontSize: 12, fontWeight: 700, textDecoration: 'none',
    display: 'inline-flex', alignItems: 'center',
  },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 20, color: '#9ca3af', lineHeight: 1, padding: 0,
  },
  body: {
    flex: 1, overflow: 'auto', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    padding: 16, background: '#f0f0f5', minHeight: 0,
  },
  img: {
    maxWidth: '100%', maxHeight: '70vh',
    objectFit: 'contain', borderRadius: 6,
    boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
  },
  iframe: {
    width: '100%', height: '70vh',
    border: 'none', borderRadius: 6,
  },
  nav: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 12, padding: '10px 18px', borderTop: '1px solid #e0e0f0', flexShrink: 0,
  },
  navBtn: {
    padding: '5px 14px', border: '1.5px solid #d0d0e0', borderRadius: 6,
    background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#4361ee',
  },
  navLabel: { fontSize: 13, color: '#555' },
};
