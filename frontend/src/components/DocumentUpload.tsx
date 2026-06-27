import React, { useState, useRef } from 'react';
import type { Document } from '../types';
import { documentsApi } from '../services/api';

interface Props { onDocumentReady: (doc: Document) => void; }

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

export function DocumentUpload({ onDocumentReady }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processingOcr, setProcessingOcr] = useState(false);
  const [progress, setProgress] = useState<'idle' | 'uploading' | 'ocr'>('idle');
  const [fileProgress, setFileProgress] = useState<{ current: number; total: number } | null>(null);
  const [ocrProgress, setOcrProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    const invalid = arr.filter((f) => !ACCEPTED_TYPES.includes(f.type));
    if (invalid.length > 0) {
      setError(`Unsupported file type(s): ${invalid.map((f) => f.name).join(', ')}. Please upload JPG, PNG, WEBP, GIF, or PDF files.`);
      return;
    }
    setError(null);
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}|${f.size}`));
      const deduped = arr.filter((f) => !existing.has(`${f.name}|${f.size}`));
      return [...prev, ...deduped];
    });
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
    // Reset input so the same file can be re-added after removal
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  const handleUploadAndOcr = async () => {
    if (files.length === 0) return;
    const allProcessed: Document[] = [];
    try {
      setError(null); setUploading(true); setProgress('uploading');

      // Upload all files sequentially, collecting documents
      const allDocs: Document[] = [];
      for (let fi = 0; fi < files.length; fi++) {
        setFileProgress({ current: fi + 1, total: files.length });
        const currentFile = files[fi]!;
        try {
          const uploaded = await documentsApi.upload(currentFile);
          const docsFromFile = uploaded.documents.length > 0 ? uploaded.documents : [uploaded.document];
          allDocs.push(...docsFromFile);
        } catch (uploadErr) {
          throw new Error(
            `Upload failed for "${currentFile.name}" (file ${fi + 1} of ${files.length}): ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`
          );
        }
      }
      setFileProgress(null);
      setUploading(false); setProcessingOcr(true); setProgress('ocr');

      // Run OCR on every document
      for (let i = 0; i < allDocs.length; i++) {
        setOcrProgress({ current: i + 1, total: allDocs.length });
        const processed = await documentsApi.runOcr(allDocs[i]!.id);
        allProcessed.push(processed);
      }

      setProcessingOcr(false); setProgress('idle');
      setOcrProgress(null);

      const reviewDoc =
        allProcessed.find((doc) => doc.status === 'PENDING_REVIEW') ??
        allProcessed.find((doc) => doc.type !== 'UNKNOWN') ??
        allProcessed[0];

      if (reviewDoc) onDocumentReady(reviewDoc);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload or OCR failed');
      setUploading(false); setProcessingOcr(false); setProgress('idle');
      setFileProgress(null); setOcrProgress(null);
    }
  };

  const reset = () => {
    setFiles([]); setError(null); setProgress('idle');
    setFileProgress(null); setOcrProgress(null);
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
          <div style={{ textAlign: 'center', color: '#888', padding: 20 }}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>📄</div>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#555' }}>
              {files.length > 0
                ? `${files.length} file${files.length > 1 ? 's' : ''} selected – click or drop to add more`
                : 'Drag & drop or click to select'}
            </div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>JPG, PNG, WEBP, GIF or PDF · multiple files supported</div>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES.join(',')}
            onChange={handleFileInput}
            style={{ display: 'none' }}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {files.map((f, i) => (
              <div
                key={`${f.name}-${f.size}-${i}`}
                style={{ padding: '7px 12px', background: '#eef0ff', border: '1px solid #c0c8ff', borderRadius: 8, fontSize: 13, color: '#4361ee', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  📎 <strong>{f.name}</strong> <span style={{ color: '#888' }}>({(f.size / 1024).toFixed(1)} KB)</span>
                </span>
                {!busy && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
                    title="Remove"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
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
            <ProgressSteps step={progress} fileProgress={fileProgress} ocrProgress={ocrProgress} />
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          {files.length > 0 && !busy && (
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
                🔍 Upload & Extract Data{files.length > 1 ? ` (${files.length} files)` : ''}
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

function ProgressSteps({ step, fileProgress, ocrProgress }: {
  step: 'idle' | 'uploading' | 'ocr';
  fileProgress: { current: number; total: number } | null;
  ocrProgress: { current: number; total: number } | null;
}) {
  const steps = [
    {
      id: 'uploading',
      label: fileProgress && fileProgress.total > 1
        ? `Uploading file ${fileProgress.current}/${fileProgress.total}`
        : 'Uploading file',
      icon: '⬆️',
    },
    {
      id: 'ocr',
      label: ocrProgress && ocrProgress.total > 1
        ? `Running AI OCR (${ocrProgress.current}/${ocrProgress.total})`
        : 'Running AI OCR',
      icon: '🤖',
    },
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
