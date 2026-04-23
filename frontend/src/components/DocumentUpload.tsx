import React, { useState, useRef } from 'react';
import type { Document } from '../types';
import { documentsApi } from '../services/api';

interface Props {
  onDocumentReady: (doc: Document) => void;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

export function DocumentUpload({ onDocumentReady }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processingOcr, setProcessingOcr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectFile = (selected: File) => {
    if (!ACCEPTED_TYPES.includes(selected.type)) {
      setError('Unsupported file type. Please upload a JPG, PNG, WEBP, GIF, or PDF.');
      return;
    }
    setError(null);
    setFile(selected);
    if (selected.type.startsWith('image/')) {
      const objectUrl = URL.createObjectURL(selected);
      // createObjectURL always returns a blob: URL; validate before use
      if (objectUrl.startsWith('blob:')) {
        setPreview(objectUrl);
      }
    } else {
      setPreview(null);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) selectFile(f);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) selectFile(f);
  };

  const handleUploadAndOcr = async () => {
    if (!file) return;

    try {
      setError(null);
      setUploading(true);
      const uploaded = await documentsApi.upload(file);

      setUploading(false);
      setProcessingOcr(true);
      const processed = await documentsApi.runOcr(uploaded.id);

      setProcessingOcr(false);
      onDocumentReady(processed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload or OCR failed';
      setError(msg);
      setUploading(false);
      setProcessingOcr(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Upload Document</h2>
      <p style={styles.subtitle}>
        Supported: LR, Invoice, Toll Receipt, Weighment Slip (JPG, PNG, PDF)
      </p>

      {/* Drop zone */}
      <div
        style={{ ...styles.dropZone, ...(dragging ? styles.dropZoneActive : {}) }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        {preview ? (
          <img src={preview} alt="Preview" style={styles.preview} />
        ) : (
          <div style={styles.dropPlaceholder}>
            <span style={styles.uploadIcon}>📄</span>
            <p>{file ? file.name : 'Drag & drop or click to select a file'}</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />
      </div>

      {file && (
        <p style={styles.filename}>
          📎 {file.name} ({(file.size / 1024).toFixed(1)} KB)
        </p>
      )}

      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.actions}>
        {file && !uploading && !processingOcr && (
          <>
            <button style={styles.btnPrimary} onClick={handleUploadAndOcr}>
              🔍 Upload & Extract Data
            </button>
            <button style={styles.btnSecondary} onClick={reset}>
              ✕ Clear
            </button>
          </>
        )}
        {uploading && <p style={styles.status}>⬆️ Uploading file…</p>}
        {processingOcr && <p style={styles.status}>🤖 Running OCR with AI…</p>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 560, margin: '0 auto', padding: 24 },
  title: { fontSize: 22, fontWeight: 700, marginBottom: 4, color: '#1a1a2e' },
  subtitle: { fontSize: 13, color: '#666', marginBottom: 20 },
  dropZone: {
    border: '2px dashed #c0c0d0',
    borderRadius: 10,
    minHeight: 160,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    background: '#f8f9ff',
    transition: 'border-color 0.2s, background 0.2s',
    overflow: 'hidden',
  },
  dropZoneActive: { borderColor: '#4361ee', background: '#eef0ff' },
  dropPlaceholder: { textAlign: 'center', color: '#888', padding: 16 },
  uploadIcon: { fontSize: 40 },
  preview: { maxWidth: '100%', maxHeight: 300, objectFit: 'contain' },
  filename: { fontSize: 13, color: '#444', marginTop: 8 },
  error: { color: '#e53e3e', fontSize: 13, marginTop: 8 },
  actions: { marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  status: { fontSize: 14, color: '#4361ee', fontStyle: 'italic' },
  btnPrimary: {
    padding: '10px 20px', background: '#4361ee', color: '#fff', border: 'none',
    borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14,
  },
  btnSecondary: {
    padding: '10px 16px', background: '#eee', color: '#444', border: 'none',
    borderRadius: 6, cursor: 'pointer', fontSize: 14,
  },
};
