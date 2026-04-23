import React, { useState } from 'react';
import type { Bundle, DispatchChannel, DispatchResult } from '../types';
import { dispatchApi } from '../services/api';

interface Props {
  bundle: Bundle;
  onClose: () => void;
  onSent?: (result: DispatchResult) => void;
}

type Step = 'compose' | 'sending' | 'done';

const CHANNEL_INFO: Record<DispatchChannel, { icon: string; label: string; placeholder: string; hint: string }> = {
  EMAIL: {
    icon: '📧',
    label: 'Email',
    placeholder: 'recipient@company.com',
    hint: 'Enter a valid email address.',
  },
  WHATSAPP: {
    icon: '💬',
    label: 'WhatsApp',
    placeholder: '+919876543210',
    hint: 'Enter E.164 format phone number (e.g. +919876543210).',
  },
};

export function DispatchModal({ bundle, onClose, onSent }: Props) {
  const [channel, setChannel] = useState<DispatchChannel>('EMAIL');
  const [recipient, setRecipient] = useState('');
  const [ccRecipient, setCcRecipient] = useState('');
  const [step, setStep] = useState<Step>('compose');
  const [result, setResult] = useState<DispatchResult | null>(null);

  const vehicleNo = bundle.group?.vehicleNo ?? 'N/A';
  const date = bundle.group?.date ?? 'N/A';
  const docCount = bundle.items.length;

  const previewMessage =
    `Dear ${bundle.recipientType},\n\n` +
    `Please find attached ${docCount} document(s) for Vehicle ${vehicleNo} dated ${date}.\n\n` +
    `This is an automated dispatch from the Logistics Document Management System.\n\n` +
    `Regards,\nLogistics DMS`;

  const handleSend = async () => {
    if (!recipient.trim()) return;
    setStep('sending');
    try {
      const res = await dispatchApi.send({
        bundleId: bundle.id,
        channel,
        recipient: recipient.trim(),
        ccRecipient: ccRecipient.trim() || undefined,
      });
      setResult(res);
      onSent?.(res);
    } catch (err) {
      setResult({
        success: false,
        logId: '',
        error: err instanceof Error ? err.message : 'Dispatch failed',
      });
    } finally {
      setStep('done');
    }
  };

  const info = CHANNEL_INFO[channel];

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>📤 Send Documents</h2>
            <p style={styles.subtitle}>
              Bundle for <strong>{vehicleNo}</strong> · {date} · {bundle.recipientType}
            </p>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {step === 'compose' && (
          <>
            {/* Channel picker */}
            <div style={styles.section}>
              <label style={styles.label}>Send via</label>
              <div style={styles.channelRow}>
                {(['EMAIL', 'WHATSAPP'] as DispatchChannel[]).map((ch) => (
                  <button
                    key={ch}
                    style={{
                      ...styles.channelBtn,
                      ...(channel === ch ? styles.channelBtnActive : {}),
                    }}
                    onClick={() => setChannel(ch)}
                  >
                    {CHANNEL_INFO[ch].icon} {CHANNEL_INFO[ch].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Recipient */}
            <div style={styles.section}>
              <label style={styles.label}>{info.icon} Recipient {info.label}</label>
              <input
                style={styles.input}
                type={channel === 'EMAIL' ? 'email' : 'tel'}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder={info.placeholder}
                autoFocus
              />
              <p style={styles.hint}>{info.hint}</p>
            </div>

            {/* CC */}
            <div style={styles.section}>
              <label style={styles.label}>Auto-CC (optional)</label>
              <input
                style={styles.input}
                type={channel === 'EMAIL' ? 'email' : 'tel'}
                value={ccRecipient}
                onChange={(e) => setCcRecipient(e.target.value)}
                placeholder={
                  channel === 'EMAIL' ? 'accounts@mycompany.com' : '+910000000000'
                }
              />
              <p style={styles.hint}>
                Company {channel === 'EMAIL' ? 'email' : 'number'} to auto-CC on every dispatch.
              </p>
            </div>

            {/* Attachments summary */}
            <div style={styles.section}>
              <label style={styles.label}>Attachments ({docCount})</label>
              <div style={styles.attachList}>
                {bundle.items.map((item) => (
                  <div key={item.id} style={styles.attachItem}>
                    📎 {item.document?.originalFilename ?? item.documentId}
                    {item.document?.type && (
                      <span style={styles.typeTag}>{item.document.type}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Message preview */}
            <div style={styles.section}>
              <label style={styles.label}>Message Preview</label>
              <pre style={styles.preview}>{previewMessage}</pre>
            </div>

            {/* Actions */}
            <div style={styles.actions}>
              <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
              <button
                style={{
                  ...styles.sendBtn,
                  ...(recipient.trim() ? {} : styles.sendBtnDisabled),
                }}
                onClick={() => void handleSend()}
                disabled={!recipient.trim()}
              >
                {info.icon} Send via {info.label}
              </button>
            </div>
          </>
        )}

        {step === 'sending' && (
          <div style={styles.statusBox}>
            <div style={styles.spinner}>⏳</div>
            <p style={styles.statusMsg}>Sending via {info.label}…</p>
            <p style={styles.statusSub}>Please wait while we dispatch your documents.</p>
          </div>
        )}

        {step === 'done' && result && (
          <div style={styles.statusBox}>
            {result.success ? (
              <>
                <div style={styles.successIcon}>✅</div>
                <p style={styles.statusMsg}>Sent successfully!</p>
                <p style={styles.statusSub}>
                  {docCount} document(s) dispatched to <strong>{recipient}</strong>
                  {ccRecipient ? ` (CC: ${ccRecipient})` : ''} via {info.label}.
                </p>
                <div style={styles.logId}>Log ID: {result.logId}</div>
              </>
            ) : (
              <>
                <div style={styles.errorIcon}>❌</div>
                <p style={styles.statusMsg}>Dispatch failed</p>
                <p style={styles.statusSub}>{result.error}</p>
                <p style={styles.hint}>
                  Check your {channel === 'EMAIL' ? 'SMTP' : 'Twilio'} environment variables on the server.
                </p>
              </>
            )}
            <div style={styles.actions}>
              <button style={styles.sendBtn} onClick={onClose}>Close</button>
              {!result.success && (
                <button
                  style={styles.cancelBtn}
                  onClick={() => { setStep('compose'); setResult(null); }}
                >
                  Try again
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#fff', borderRadius: 14,
    boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
    width: '100%', maxWidth: 560, maxHeight: '90vh',
    overflowY: 'auto', padding: 28,
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  title: { margin: 0, fontSize: 20, fontWeight: 800, color: '#1a1a2e' },
  subtitle: { margin: '4px 0 0', fontSize: 13, color: '#888' },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 18, color: '#aaa', lineHeight: 1,
  },

  section: { marginBottom: 18 },
  label: { display: 'block', fontWeight: 700, fontSize: 13, color: '#555', marginBottom: 6 },
  hint: { margin: '4px 0 0', fontSize: 12, color: '#999' },

  channelRow: { display: 'flex', gap: 10 },
  channelBtn: {
    flex: 1, padding: '10px 0', border: '2px solid #e0e0f0',
    borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600,
    background: '#f8f8ff', color: '#555', transition: 'all 0.15s',
  },
  channelBtnActive: { borderColor: '#4361ee', background: '#eef0ff', color: '#4361ee' },

  input: {
    width: '100%', padding: '10px 12px',
    border: '1.5px solid #e0e0f0', borderRadius: 8, fontSize: 14,
    outline: 'none', boxSizing: 'border-box', color: '#1a1a2e',
  },

  attachList: {
    background: '#f8f8ff', border: '1px solid #e8e8f0',
    borderRadius: 8, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4,
  },
  attachItem: { fontSize: 13, color: '#444', display: 'flex', alignItems: 'center', gap: 6 },
  typeTag: {
    fontSize: 10, fontWeight: 700, padding: '1px 6px',
    background: '#4361ee', color: '#fff', borderRadius: 8,
  },

  preview: {
    background: '#f8f8ff', border: '1px solid #e8e8f0', borderRadius: 8,
    padding: 12, fontSize: 12, color: '#444',
    whiteSpace: 'pre-wrap', fontFamily: 'monospace', margin: 0,
  },

  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 },
  cancelBtn: {
    padding: '10px 20px', border: '1.5px solid #ddd', borderRadius: 8,
    background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#555',
  },
  sendBtn: {
    padding: '10px 24px', background: '#4361ee', color: '#fff',
    border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700,
  },
  sendBtnDisabled: { opacity: 0.45, cursor: 'not-allowed' },

  statusBox: { textAlign: 'center', padding: '20px 0' },
  spinner: { fontSize: 48 },
  successIcon: { fontSize: 48 },
  errorIcon: { fontSize: 48 },
  statusMsg: { fontSize: 18, fontWeight: 800, color: '#1a1a2e', margin: '10px 0 6px' },
  statusSub: { fontSize: 13, color: '#666', maxWidth: 380, margin: '0 auto' },
  logId: { marginTop: 10, fontSize: 11, color: '#aaa', fontFamily: 'monospace' },
};
