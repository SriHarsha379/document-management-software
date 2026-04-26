/**
 * communicationWorker.ts
 *
 * The worker registers a job-processing handler with the queue and starts
 * the polling loop.  Import and call startCommunicationWorker() once at
 * server startup.
 *
 * Handler responsibilities:
 *  1. Fan out CommunicationJob → N CommunicationMessage rows (one per recipient).
 *  2. Send each message via the appropriate channel adapter.
 *  3. Update each CommunicationMessage status (SENT / FAILED).
 *  4. If all messages failed → throw so the queue can retry / fail the job.
 */

import * as nodemailer from 'nodemailer';
import twilio from 'twilio';
import * as path from 'path';
import * as fs from 'fs';
import { prisma } from '../../services/documentService.js';
import { jobQueue } from './communicationQueue.js';
import { resolveTemplate, renderTemplateRecord } from './templateService.js';
import type { JobPayload } from './communicationQueue.js';
import type { ResolvedRecipient } from './recipientResolver.js';

// ── Error classification ────────────────────────────────────────────────────────

// SMTP response codes that indicate a transient failure (worth retrying)
const RETRYABLE_SMTP_CODES = new Set([421, 450, 451, 452]);

// Twilio error codes that indicate a transient failure
const RETRYABLE_TWILIO_CODES = new Set([20429, 30001, 30002, 30003, 30005]);

function isRetryableSmtp(err: unknown): boolean {
  const code = (err as { responseCode?: number })?.responseCode;
  return code !== undefined && RETRYABLE_SMTP_CODES.has(code);
}

function isRetryableTwilio(err: unknown): boolean {
  const code = (err as { code?: number })?.code;
  return code !== undefined && RETRYABLE_TWILIO_CODES.has(code);
}

// ── Resolve company-level sending credentials ──────────────────────────────────

async function getCompanySettings(companyId: string) {
  return prisma.companySettings.findUnique({ where: { companyId } });
}

// ── Email sender ───────────────────────────────────────────────────────────────

async function sendEmail(opts: {
  from: string;
  to: string;
  cc?: string[];
  subject: string;
  body: string;
  attachments: Array<{ filename: string; path: string }>;
}): Promise<string> {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('Email not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const validAttachments = opts.attachments.filter((a) => {
    try { return fs.existsSync(a.path); } catch { return false; }
  });

  const info = await transporter.sendMail({
    from:        opts.from,
    to:          opts.to,
    cc:          opts.cc?.join(', '),
    subject:     opts.subject,
    text:        opts.body,
    attachments: validAttachments.map((a) => ({ filename: a.filename, path: a.path })),
  });

  return (info.messageId as string) ?? '';
}

// ── WhatsApp sender ────────────────────────────────────────────────────────────

async function sendWhatsApp(opts: {
  from: string;
  to: string;
  body: string;
  mediaUrls?: string[];
}): Promise<string> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('WhatsApp not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN.');
  }

  const client   = twilio(accountSid, authToken);
  const fromNum  = opts.from.startsWith('whatsapp:') ? opts.from : `whatsapp:${opts.from}`;
  const toNum    = opts.to.startsWith('whatsapp:')   ? opts.to   : `whatsapp:${opts.to}`;
  const firstUrl = opts.mediaUrls?.[0];

  const msg = await client.messages.create({
    from: fromNum,
    to:   toNum,
    body: opts.body,
    ...(firstUrl ? { mediaUrl: [firstUrl] } : {}),
  });

  return msg.sid;
}

// ── Resolve attachment paths for a bundle ─────────────────────────────────────

async function bundleAttachments(bundleId: string) {
  const bundle = await prisma.documentBundle.findUnique({
    where:   { id: bundleId },
    include: {
      group: true,
      items: { include: { document: true } },
    },
  });
  if (!bundle) return { attachments: [], mediaUrls: [], templateVars: {} };

  const uploadDir = process.env.UPLOAD_DIR ?? './uploads';
  const baseUrl   = process.env.BACKEND_PUBLIC_URL ?? 'http://localhost:3001';

  const attachments = bundle.items.map((item) => ({
    filename: item.document.originalFilename,
    path: path.isAbsolute(item.document.rawFilePath)
      ? item.document.rawFilePath
      : path.resolve(process.cwd(), item.document.rawFilePath),
  }));

  const mediaUrls = bundle.items.map(
    (item) => `${baseUrl}/uploads/${path.basename(item.document.rawFilePath)}`,
  );

  const templateVars = {
    vehicleNo:     bundle.group.vehicleNo,
    date:          bundle.group.date,
    documentCount: bundle.items.length,
  };

  return { attachments, mediaUrls, templateVars };
}

// ── Job handler ────────────────────────────────────────────────────────────────

async function handleJob(payload: JobPayload): Promise<void> {
  const { jobId, companyId, bundleId, channel, recipients, templateVars } = payload;

  // Resolve company settings (for centralized from-address)
  const settings = await getCompanySettings(companyId);

  // Build attachment list and extra template vars from bundle (if any)
  const bundleData = bundleId ? await bundleAttachments(bundleId) : { attachments: [], mediaUrls: [], templateVars: {} };
  const mergedVars: Record<string, unknown> = { ...bundleData.templateVars, ...templateVars };

  // Expand company name for template
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
  mergedVars['companyName'] = company?.name ?? 'Logistics DMS';

  // Determine which concrete channels to send on
  const channels: Array<'EMAIL' | 'WHATSAPP'> = channel === 'BOTH'
    ? ['EMAIL', 'WHATSAPP']
    : [channel];

  let anySuccess = false;

  for (const ch of channels) {
    const template = await resolveTemplate(companyId, ch, undefined);

    // Sending identity
    const smtpFrom     = settings?.smtpFrom      ?? process.env.SMTP_FROM      ?? 'noreply@logistics-dms.local';
    const waFrom       = settings?.whatsappFrom   ?? process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886';
    const defaultCCEmail = settings?.defaultCCEmail;
    const defaultCCPhone = settings?.defaultCCPhone;

    // Separate primary and CC recipients for this channel
    const primary = recipients.filter((r) => !r.isCC);
    const ccList  = recipients.filter((r) =>  r.isCC).map((r) => r.address);

    if (defaultCCEmail && ch === 'EMAIL' && !ccList.includes(defaultCCEmail)) {
      ccList.push(defaultCCEmail);
    }
    if (defaultCCPhone && ch === 'WHATSAPP') {
      const ccPhones = recipients.filter((r) => r.isCC).map((r) => r.address);
      if (!ccPhones.includes(defaultCCPhone)) ccList.push(defaultCCPhone);
    }

    // Fan-out: create one CommunicationMessage per recipient (primary + CC)
    const allRecipients: Array<ResolvedRecipient & { isCC: boolean }> = [
      ...primary.map((r) => ({ ...r, isCC: false })),
      ...ccList.map((addr) => ({
        type: 'CUSTOM' as const,
        name: addr,
        address: addr,
        isCC: true,
      })),
    ];

    for (const recipient of allRecipients) {
      const vars = { ...mergedVars, recipientName: recipient.name };
      const rendered = renderTemplateRecord(template, vars);

      // Upsert message row (idempotent on retry — check if already SENT)
      let msg = await prisma.communicationMessage.findFirst({
        where: { jobId, channel: ch, recipient: recipient.address },
      });

      if (!msg) {
        msg = await prisma.communicationMessage.create({
          data: {
            jobId,
            channel:        ch,
            recipient:      recipient.address,
            recipientName:  recipient.name,
            isCC:           recipient.isCC,
            renderedSubject: rendered.subject ?? null,
            renderedBody:   rendered.body,
            mediaUrls:      JSON.stringify(ch === 'EMAIL' ? [] : bundleData.mediaUrls),
            status:         'PENDING',
          },
        });
      }

      if (msg.status === 'SENT') { anySuccess = true; continue; } // already delivered

      // Mark attempt
      await prisma.communicationMessage.update({
        where: { id: msg.id },
        data:  { attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
      });

      try {
        let externalId = '';

        if (ch === 'EMAIL') {
          externalId = await sendEmail({
            from:        smtpFrom,
            to:          recipient.address,
            cc:          recipient.isCC ? [] : ccList,
            subject:     rendered.subject ?? `Documents – ${mergedVars['vehicleNo'] ?? ''}`,
            body:        rendered.body,
            attachments: bundleData.attachments,
          });
        } else {
          externalId = await sendWhatsApp({
            from:      waFrom,
            to:        recipient.address,
            body:      rendered.body,
            mediaUrls: bundleData.mediaUrls,
          });
        }

        await prisma.communicationMessage.update({
          where: { id: msg.id },
          data:  { status: 'SENT', sentAt: new Date(), externalId },
        });
        anySuccess = true;
      } catch (err) {
        const errMsg  = err instanceof Error ? err.message : String(err);
        const retryable = ch === 'EMAIL' ? isRetryableSmtp(err) : isRetryableTwilio(err);

        await prisma.communicationMessage.update({
          where: { id: msg.id },
          data: {
            status:    retryable ? 'PENDING' : 'FAILED',
            errorMsg:  errMsg,
          },
        });

        if (!retryable) {
          console.warn(`[comm-worker] Hard failure for ${ch} to ${recipient.address}: ${errMsg}`);
        }
      }
    }
  }

  if (!anySuccess) {
    throw new Error('All message send attempts failed');
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Register the handler with the queue and start the polling loop.
 * Returns a stop function for graceful shutdown.
 */
export function startCommunicationWorker(): () => void {
  jobQueue.process(handleJob);
  const stop = (jobQueue as import('./communicationQueue.js').DbJobQueue).start();
  console.log('[comm-worker] Communication worker started');
  return stop;
}
