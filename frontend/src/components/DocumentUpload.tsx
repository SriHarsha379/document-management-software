import React, { useEffect, useRef, useState } from 'react';
import type { Document } from '../types';
import { documentsApi } from '../services/api';
import { OCRReview } from './OCRReview';
import { DocumentExtractionSummary, getDocumentSummaryTitle } from './DocumentExtractionSummary';

interface Props { onDocumentReady?: (doc: Document) => void; }

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const UPLOAD_REVIEW_SESSION_KEY = 'dms.uploadReviewSession';

type StoredUploadReviewSession = {
  documentIds: string[];
  activeReviewId: string | null;
};

export function DocumentUpload({ onDocumentReady }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processingOcr, setProcessingOcr] = useState(false);
  const [progress, setProgress] = useState<'idle' | 'uploading' | 'ocr'>('idle');
  const [fileProgress, setFileProgress] = useState<{ current: number; total: number } | null>(null);
  const [ocrProgress, setOcrProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [processedDocs, setProcessedDocs] = useState<Document[]>([]);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [sessionRestored, setSessionRestored] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The OCR results are persisted on the server, but this page's current review
  // queue used to exist only in React state. Keep the IDs locally and reload the
  // full documents after a browser refresh so an in-progress review is never lost.
  useEffect(() => {
    const restoreReviewSession = async () => {
      let stored: StoredUploadReviewSession | null = null;
      try {
        const raw = localStorage.getItem(UPLOAD_REVIEW_SESSION_KEY);
        if (raw) stored = JSON.parse(raw) as StoredUploadReviewSession;
      } catch {
        localStorage.removeItem(UPLOAD_REVIEW_SESSION_KEY);
      }

      try {
        let documentIds = stored?.documentIds ?? [];
        let restoredActiveId = stored?.activeReviewId ?? null;

        // A page refreshed before this persistence fix will not have a stored
        // session yet. For a multi-page PDF, recover its most recent page batch.
        if (documentIds.length === 0) {
          const recent = await documentsApi.list({ page: 1, limit: 50 });
          const newestPdfPage = recent.documents.find((doc) => Boolean(doc.sourceDocumentId));
          if (newestPdfPage?.sourceDocumentId) {
            documentIds = recent.documents
              .filter((doc) => doc.sourceDocumentId === newestPdfPage.sourceDocumentId)
              .map((doc) => doc.id);
            restoredActiveId = documentIds.find((id) => id === newestPdfPage.id) ?? null;
          }
        }

        if (documentIds.length === 0) return;

        const results = await Promise.allSettled(documentIds.map((id) => documentsApi.getById(id)));
        const restoredDocs = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
        if (restoredDocs.length === 0) return;

        // A completed batch belongs in Documents, not on the Upload screen.
        // Only resume a session when at least one page still needs review.
        const firstPendingReview = restoredDocs.find((doc) => !doc.extractedData?.userReviewed);
        if (!firstPendingReview) {
          localStorage.removeItem(UPLOAD_REVIEW_SESSION_KEY);
          return;
        }

        setProcessedDocs(restoredDocs);
        const restoredActiveDoc = restoredDocs.find(
          (doc) => doc.id === restoredActiveId && !doc.extractedData?.userReviewed,
        );
        const nextReviewDoc = restoredActiveDoc ?? firstPendingReview;
        setActiveReviewId(nextReviewDoc?.id ?? null);
        setReviewNotice(`↻ Restored ${restoredDocs.length} extracted page${restoredDocs.length === 1 ? '' : 's'} from your previous upload session.`);
      } catch {
        // The normal upload workflow remains available if restoring a prior
        // session fails (for example, after documents were deleted elsewhere).
      } finally {
        setSessionRestored(true);
      }
    };

    void restoreReviewSession();
  }, []);

  useEffect(() => {
    if (!sessionRestored) return;
    if (processedDocs.length === 0 || processedDocs.every((doc) => doc.extractedData?.userReviewed)) {
      localStorage.removeItem(UPLOAD_REVIEW_SESSION_KEY);
      return;
    }
    const session: StoredUploadReviewSession = {
      documentIds: processedDocs.map((doc) => doc.id),
      activeReviewId,
    };
    localStorage.setItem(UPLOAD_REVIEW_SESSION_KEY, JSON.stringify(session));
  }, [activeReviewId, processedDocs, sessionRestored]);

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
      setError(null); setReviewNotice(null); setProcessedDocs([]); setActiveReviewId(null);
      localStorage.removeItem(UPLOAD_REVIEW_SESSION_KEY);
      setUploading(true); setProgress('uploading');

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
          // Prefer the server's error message (e.g. duplicate-file rejection)
          // over axios's generic "Request failed with status code ###".
          const axiosErr = uploadErr as { response?: { data?: { error?: string } } };
          const serverMessage = axiosErr?.response?.data?.error;
          const detail = serverMessage ?? (uploadErr instanceof Error ? uploadErr.message : String(uploadErr));
          throw new Error(`Upload failed for "${currentFile.name}" (file ${fi + 1} of ${files.length}): ${detail}`);
        }
      }
      setFileProgress(null);
      setUploading(false); setProcessingOcr(true); setProgress('ocr');

      // Run OCR on every document. Catch failures per-document so a single
      // slow/failed OCR call (e.g. a timeout) doesn't wipe out results for
      // every other document that succeeded.
      const ocrErrors: string[] = [];
      let extraDetected = 0;
      for (let i = 0; i < allDocs.length; i++) {
        setOcrProgress({ current: i + 1, total: allDocs.length });
        try {
          const { document: processed, additionalDocumentIds } = await documentsApi.runOcr(allDocs[i]!.id);
          allProcessed.push(processed);

          // The source image may have contained more than one toll swipe or
          // weighment slip (see additionalTollEntries/additionalWeighments in
          // the OCR prompt) — each one became its own sibling Document
          // server-side, already saved and auto-linked, but not otherwise
          // visible in this review screen. Fetch and surface them here too
          // so nothing silently disappears from the reviewer's view.
          if (additionalDocumentIds.length > 0) {
            extraDetected += additionalDocumentIds.length;
            for (const extraId of additionalDocumentIds) {
              try {
                const extraDoc = await documentsApi.getById(extraId);
                allProcessed.push(extraDoc);
              } catch (fetchErr) {
                console.error(`Failed to fetch additional document ${extraId}`, fetchErr);
              }
            }
          }
        } catch (ocrErr) {
          const msg = ocrErr instanceof Error ? ocrErr.message : String(ocrErr);
          console.error(`OCR failed for document ${allDocs[i]!.id}`, ocrErr);
          ocrErrors.push(`"${allDocs[i]!.originalFilename}": ${msg}`);
        }
      }

      setProcessingOcr(false); setProgress('idle');
      setOcrProgress(null);
      setProcessedDocs(allProcessed);

      if (extraDetected > 0) {
        setReviewNotice(
          `Detected ${extraDetected} additional document${extraDetected > 1 ? 's' : ''} ` +
          `(e.g. a second toll entry or weighment slip) on a single page — ` +
          `added below for review alongside the rest.`,
        );
      }

      if (ocrErrors.length > 0) {
        setError(
          allProcessed.length > 0
            ? `${ocrErrors.length} of ${allDocs.length} document(s) failed OCR and are not shown below: ${ocrErrors.join('; ')}`
            : `OCR failed for all documents: ${ocrErrors.join('; ')}`
        );
      }

      const reviewDoc =
        allProcessed.find((doc) => doc.status === 'PENDING_REVIEW') ??
        allProcessed.find((doc) => doc.type !== 'UNKNOWN') ??
        allProcessed[0];

      if (reviewDoc) {
        setActiveReviewId(reviewDoc.id);
        onDocumentReady?.(reviewDoc);
      } else {
        setActiveReviewId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload or OCR failed');
      setUploading(false); setProcessingOcr(false); setProgress('idle');
      setFileProgress(null); setOcrProgress(null);
    }
  };

  const reset = () => {
    setFiles([]); setError(null); setProgress('idle');
    setReviewNotice(null);
    setFileProgress(null); setOcrProgress(null);
    setProcessedDocs([]); setActiveReviewId(null);
    localStorage.removeItem(UPLOAD_REVIEW_SESSION_KEY);
    if (inputRef.current) inputRef.current.value = '';
  };

  const busy = uploading || processingOcr;
  const activeReviewDoc = processedDocs.find((doc) => doc.id === activeReviewId) ?? null;

  return (
    <div style={{ maxWidth: activeReviewDoc || processedDocs.length > 0 ? 1000 : 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
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

      {processedDocs.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e0e0f0', padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#1a1a2e' }}>Extracted Results</h3>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: '#6b7280' }}>
                Review the fields extracted from each uploaded page/document.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#4338ca', background: '#eef2ff', borderRadius: 999, padding: '6px 10px' }}>
                {processedDocs.length} extracted document{processedDocs.length === 1 ? '' : 's'}
              </span>
              {!activeReviewDoc && (
                <button
                  type="button"
                  onClick={reset}
                  style={{
                    border: 'none', borderRadius: 9, background: '#22c55e', color: '#fff',
                    padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(34,197,94,0.3)', transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#16a34a'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#22c55e'; }}
                >
                  ✅ Done
                </button>
              )}
            </div>
          </div>

          {reviewNotice && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: '#ecfdf5', border: '1px solid #86efac', borderRadius: 8, fontSize: 13, color: '#166534' }}>
              {reviewNotice}
            </div>
          )}

          <div style={{ display: 'grid', gap: 12 }}>
            {processedDocs.map((doc) => (
              <div key={doc.id} style={{ border: activeReviewId === doc.id ? '1px solid #818cf8' : '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: activeReviewId === doc.id ? '#f8faff' : '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#1f2937' }}>{getDocumentSummaryTitle(doc)}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{doc.originalFilename}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '5px 9px', background: doc.extractedData?.userReviewed ? '#dcfce7' : '#dbeafe', color: doc.extractedData?.userReviewed ? '#166534' : '#1d4ed8' }}>
                      {doc.extractedData?.userReviewed ? 'Reviewed' : 'Extracted'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setReviewNotice(null);
                        setActiveReviewId((current) => current === doc.id ? null : doc.id);
                      }}
                      style={{ border: '1px solid #c7d2fe', borderRadius: 8, background: '#eef2ff', color: '#4338ca', padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >
                      {activeReviewId === doc.id ? 'Hide Review' : 'Review Fields'}
                    </button>
                  </div>
                </div>
                <DocumentExtractionSummary document={doc} />
              </div>
            ))}
          </div>
        </div>
      )}

      {activeReviewDoc && (
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e0e0f0', padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <OCRReview
            key={activeReviewDoc.id}
            document={activeReviewDoc}
            allDocs={processedDocs}
            onSaved={(savedDoc) => {
              const updatedDocs = processedDocs.map((doc) => doc.id === savedDoc.id ? savedDoc : doc);
              const savedIndex = updatedDocs.findIndex((doc) => doc.id === savedDoc.id);
              const remainingDocs = [
                ...updatedDocs.slice(savedIndex + 1),
                ...updatedDocs.slice(0, savedIndex),
              ];
              const nextReviewDoc = remainingDocs.find((doc) => !doc.extractedData?.userReviewed);

              setProcessedDocs(updatedDocs);
              setReviewNotice(
                nextReviewDoc
                  ? `✅ ${savedDoc.originalFilename} saved. Reviewing ${getDocumentSummaryTitle(nextReviewDoc)} next.`
                  : `✅ ${savedDoc.originalFilename} saved successfully. All extracted pages have been reviewed.`,
              );
              setActiveReviewId(nextReviewDoc?.id ?? null);
            }}
            onSelectDocument={(doc) => {
              setReviewNotice(null);
              setActiveReviewId(doc.id);
            }}
            onCancel={() => setActiveReviewId(null)}
          />
        </div>
      )}
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

