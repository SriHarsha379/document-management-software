import React, { useState, useRef } from 'react';
import type { Document } from '../types';
import { documentsApi } from '../services/api';

interface Props { onDocumentReady: (doc: Document) => void; }

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

export function DocumentUpload({ onDocumentReady }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processingOcr, setProcessingOcr] = useState(false);
  const [progress, setProgress] = useState<'idle' | 'uploading' | 'ocr'>('idle');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectFile = (selected: File) => {
    if (!ACCEPTED_TYPES.includes(selected.type)) {
      setError('Unsupported file type. Please upload a JPG, PNG, WEBP, GIF, or PDF.');
      return;
    }
    setError(null); setFile(selected);
    if (selected.type.startsWith('image/')) {
      const objectUrl = URL.createObjectURL(selected);
      // Validate that the URL has a blob: protocol before using it as an image source.
      // URL.createObjectURL always returns a blob: URI; this check prevents a
      // hypothetical non-blob value from reaching the img src attribute.
      const parsed = new URL(objectUrl);
      if (parsed.protocol === 'blob:') setPreview(parsed.href);
    } else { setPreview(null); }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) selectFile(f);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) selectFile(f);
  };

  const handleUploadAndOcr = async () => {
    if (!file) return;
    try {
      setError(null); setUploading(true); setProgress('uploading');
      const uploaded = await documentsApi.upload(file);
      setUploading(false); setProcessingOcr(true); setProgress('ocr');
      const processed = await documentsApi.runOcr(uploaded.id);
      setProcessingOcr(false); setProgress('idle');
      onDocumentReady(processed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload or OCR failed');
      setUploading(false); setProcessingOcr(false); setProgress('idle');
    }
  };

  const reset = () => {
    setFile(null); setPreview(null); setError(null); setProgress('idle');
    if (inputRef.current) inputRef.current.value = '';
  };

  const busy = uploading || processingOcr;

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e0e0f0', padding: '28px 28px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: '#1a1a2e' }}>Upload Document</h2>
        <p style={{ margin: '0 0 22px', fontSize: 13, color: '#6b7280' }}>
          Supported: LR, Invoice, Toll Receipt, Weighment Slip (JPG, PNG, PDF)
        </p>

        {/* Drop zone */}
        <div
          style={{
            border: `2px dashed ${dragging ? '#4361ee' : '#c0c0d0'}`,
            borderRadius: 12,
            minHeight: 180,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: busy ? 'not-allowed' : 'pointer',
            background: dragging ? '#eef0ff' : '#f8f9ff',
            transition: 'border-color 0.2s, background 0.2s',
            overflow: 'hidden', position: 'relative',
          }}
          onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { if (!busy) handleDrop(e); }}
          onClick={() => { if (!busy) inputRef.current?.click(); }}
        >
          {preview ? (
            <img src={preview} alt="Preview" style={{ maxWidth: '100%', maxHeight: 300, objectFit: 'contain' }} />
          ) : (
            <div style={{ textAlign: 'center', color: '#888', padding: 20 }}>
              <div style={{ fontSize: 48, marginBottom: 10 }}>📄</div>
              <div style={{ fontSize: 15, fontWeight: 500, color: '#555' }}>
                {file ? file.name : 'Drag & drop or click to select'}
              </div>
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>JPG, PNG, WEBP, GIF or PDF</div>
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
          <div style={{ marginTop: 12, padding: '8px 12px', background: '#eef0ff', border: '1px solid #c0c8ff', borderRadius: 8, fontSize: 13, color: '#4361ee', display: 'flex', alignItems: 'center', gap: 6 }}>
            📎 <strong>{file.name}</strong> <span style={{ color: '#888' }}>({(file.size / 1024).toFixed(1)} KB)</span>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 13, color: '#b91c1c' }}>
            ⚠️ {error}
          </div>
        )}

        {/* Progress steps */}
        {busy && (
          <div style={{ marginTop: 16 }}>
            <ProgressSteps step={progress} />
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          {file && !busy && (
            <>
              <button
                style={{
                  flex: 1, padding: '11px 20px', background: '#4361ee', color: '#fff',
                  border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 700,
                  fontSize: 14, boxShadow: '0 2px 8px rgba(67,97,238,0.3)',
                  transition: 'background 0.15s',
                }}
                onClick={() => { void handleUploadAndOcr(); }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#3651d4'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#4361ee'; }}
              >
                🔍 Upload & Extract Data
              </button>
              <button
                style={{
                  padding: '11px 16px', background: '#f0f0f8', color: '#444',
                  border: '1px solid #e0e0f0', borderRadius: 9, cursor: 'pointer', fontSize: 14,
                }}
                onClick={reset}
              >
                ✕ Clear
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressSteps({ step }: { step: 'idle' | 'uploading' | 'ocr' }) {
  const steps = [
    { id: 'uploading', label: 'Uploading file', icon: '⬆️' },
    { id: 'ocr',       label: 'Running AI OCR', icon: '🤖' },
  ];
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {steps.map((s) => {
        const active = step === s.id;
        const done = (s.id === 'uploading' && step === 'ocr');
        return (
          <div key={s.id} style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px', borderRadius: 8,
            background: active ? '#eef0ff' : done ? '#d1fae5' : '#f5f5f5',
            border: `1px solid ${active ? '#c0c8ff' : done ? '#a7f3d0' : '#eee'}`,
            fontSize: 13, fontWeight: active ? 600 : 400, color: active ? '#4361ee' : done ? '#065f46' : '#9ca3af',
            transition: 'all 0.3s',
          }}>
            <span>{done ? '✅' : active ? <Spinner /> : s.icon}</span>
            {s.label}
          </div>
        );
      })}
    </div>
  );
}

function Spinner() {
  return (
    <span style={{
      display: 'inline-block', width: 14, height: 14, border: '2px solid #c0c8ff',
      borderTopColor: '#4361ee', borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
    }} />
  );
}
