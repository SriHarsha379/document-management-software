import React, { useState } from 'react';
import type { Bundle, DispatchChannel, DispatchResult } from '../types';
import { dispatchApi } from '../services/api';

interface Props { bundle: Bundle; onClose: () => void; onSent?: (result: DispatchResult) => void; }
type Step = 'compose' | 'sending' | 'done';

const CHANNEL_INFO: Record<DispatchChannel, { icon: string; label: string; placeholder: string; hint: string }> = {
  EMAIL: { icon: '📧', label: 'Email', placeholder: 'recipient@company.com', hint: 'Enter a valid email address.' },
  WHATSAPP: { icon: '💬', label: 'WhatsApp', placeholder: '+919876543210', hint: 'E.164 format phone number (e.g. +919876543210).' },
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
    `Dear ${bundle.recipientType},\n\nPlease find attached ${docCount} document(s) for Vehicle ${vehicleNo} dated ${date}.\n\nThis is an automated dispatch from the Logistics Document Management System.\n\nRegards,\nLogistics DMS`;

  const handleSend = async () => {
    if (!recipient.trim()) return;
    setStep('sending');
    try {
      const res = await dispatchApi.send({ bundleId: bundle.id, channel, recipient: recipient.trim(), ccRecipient: ccRecipient.trim() || undefined });
      setResult(res); onSent?.(res);
    } catch (err) {
      setResult({ success: false, logId: '', error: err instanceof Error ? err.message : 'Dispatch failed' });
    } finally { setStep('done'); }
  };

  const info = CHANNEL_INFO[channel];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.2)', width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto', padding: 28 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: '#1a1a2e' }}>📤 Send Documents</h2>
            <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>Bundle for <strong>{vehicleNo}</strong> · {date} · {bundle.recipientType}</p>
          </div>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9ca3af', lineHeight: 1 }} onClick={onClose}>✕</button>
        </div>

        {step === 'compose' && (
          <>
            <div style={section}>
              <label style={sLabel}>Send via</label>
              <div style={{ display: 'flex', gap: 10 }}>
                {(['EMAIL', 'WHATSAPP'] as DispatchChannel[]).map((ch) => (
                  <button key={ch}
                    style={{ flex: 1, padding: '10px 0', border: `2px solid ${channel === ch ? '#4361ee' : '#e0e0f0'}`, borderRadius: 9, cursor: 'pointer', fontSize: 14, fontWeight: 600, background: channel === ch ? '#eef0ff' : '#f8f8ff', color: channel === ch ? '#4361ee' : '#555', transition: 'all 0.15s' }}
                    onClick={() => setChannel(ch)}
                  >
                    {CHANNEL_INFO[ch].icon} {CHANNEL_INFO[ch].label}
                  </button>
                ))}
              </div>
            </div>

            <div style={section}>
              <label style={sLabel}>{info.icon} Recipient {info.label}</label>
              <input style={sInput} type={channel === 'EMAIL' ? 'email' : 'tel'} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={info.placeholder} autoFocus />
              <p style={sHint}>{info.hint}</p>
            </div>

            <div style={section}>
              <label style={sLabel}>Auto-CC (optional)</label>
              <input style={sInput} type={channel === 'EMAIL' ? 'email' : 'tel'} value={ccRecipient} onChange={(e) => setCcRecipient(e.target.value)} placeholder={channel === 'EMAIL' ? 'accounts@mycompany.com' : '+910000000000'} />
              <p style={sHint}>Company {channel === 'EMAIL' ? 'email' : 'number'} to auto-CC on every dispatch.</p>
            </div>

            <div style={section}>
              <label style={sLabel}>Attachments ({docCount})</label>
              <div style={{ background: '#f8f8ff', border: '1px solid #e8e8f0', borderRadius: 8, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {bundle.items.map((item) => (
                  <div key={item.id} style={{ fontSize: 13, color: '#444', display: 'flex', alignItems: 'center', gap: 6 }}>
                    📎 {item.document?.originalFilename ?? item.documentId}
                    {item.document?.type && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', background: '#4361ee', color: '#fff', borderRadius: 8 }}>{item.document.type}</span>}
                  </div>
                ))}
              </div>
            </div>

            <div style={section}>
              <label style={sLabel}>Message Preview</label>
              <pre style={{ background: '#f8f8ff', border: '1px solid #e8e8f0', borderRadius: 8, padding: 12, fontSize: 12, color: '#444', whiteSpace: 'pre-wrap', fontFamily: 'monospace', margin: 0 }}>{previewMessage}</pre>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button style={{ padding: '10px 20px', border: '1.5px solid #d0d0e0', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#555' }} onClick={onClose}>Cancel</button>
              <button
                style={{ padding: '10px 24px', background: recipient.trim() ? '#4361ee' : '#9ca3af', color: '#fff', border: 'none', borderRadius: 8, cursor: recipient.trim() ? 'pointer' : 'not-allowed', fontSize: 14, fontWeight: 700, boxShadow: recipient.trim() ? '0 2px 8px rgba(67,97,238,0.3)' : 'none', transition: 'background 0.15s' }}
                onClick={() => { void handleSend(); }}
                disabled={!recipient.trim()}
              >
                {info.icon} Send via {info.label}
              </button>
            </div>
          </>
        )}

        {step === 'sending' && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⏳</div>
            <p style={{ fontSize: 18, fontWeight: 800, color: '#1a1a2e', margin: '0 0 6px' }}>Sending via {info.label}…</p>
            <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Please wait while we dispatch your documents.</p>
          </div>
        )}

        {step === 'done' && result && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            {result.success ? (
              <>
                <div style={{ fontSize: 52 }}>✅</div>
                <p style={{ fontSize: 18, fontWeight: 800, color: '#1a1a2e', margin: '12px 0 6px' }}>Sent successfully!</p>
                <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
                  {docCount} document(s) dispatched to <strong>{recipient}</strong>
                  {ccRecipient ? ` (CC: ${ccRecipient})` : ''} via {info.label}.
                </p>
                <div style={{ marginTop: 10, fontSize: 11, color: '#aaa', fontFamily: 'monospace' }}>Log ID: {result.logId}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 52 }}>❌</div>
                <p style={{ fontSize: 18, fontWeight: 800, color: '#1a1a2e', margin: '12px 0 6px' }}>Dispatch failed</p>
                <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>{result.error}</p>
                <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>Check your {channel === 'EMAIL' ? 'SMTP' : 'Twilio'} environment variables on the server.</p>
              </>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
              <button style={{ padding: '10px 24px', background: '#4361ee', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700 }} onClick={onClose}>Close</button>
              {!result.success && (
                <button style={{ padding: '10px 20px', border: '1.5px solid #d0d0e0', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#555' }} onClick={() => { setStep('compose'); setResult(null); }}>Try again</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const section: React.CSSProperties = { marginBottom: 18 };
const sLabel: React.CSSProperties = { display: 'block', fontWeight: 700, fontSize: 13, color: '#555', marginBottom: 6 };
const sHint: React.CSSProperties = { margin: '4px 0 0', fontSize: 12, color: '#9ca3af' };
const sInput: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1.5px solid #d0d0e0', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box', color: '#1a1a2e', fontFamily: 'inherit', transition: 'border-color 0.15s' };
