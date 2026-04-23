import nodemailer from 'nodemailer';
import twilio from 'twilio';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from './documentService.js';
import type { RecipientType } from '../types/index.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type DispatchChannel = 'EMAIL' | 'WHATSAPP';

export interface DispatchRequest {
  bundleId: string;
  channel: DispatchChannel;
  recipient: string;       // email or phone number (+91XXXXXXXXXX)
  ccRecipient?: string;    // auto-CC email or phone
}

export interface DispatchResult {
  success: boolean;
  logId: string;
  message?: string;
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Generate a human-friendly dispatch message for the bundle.
 */
export function generateMessage(opts: {
  vehicleNo: string;
  date: string;
  recipientType: RecipientType;
  documentCount: number;
}): string {
  const { vehicleNo, date, recipientType, documentCount } = opts;
  const recipientLabel =
    recipientType === 'ACCOUNTS' ? 'Accounts'
    : recipientType === 'PARTY' ? 'Party'
    : 'Transporter';

  return (
    `Dear ${recipientLabel},\n\n` +
    `Please find attached ${documentCount} document(s) for Vehicle ${vehicleNo} dated ${date}.\n\n` +
    `This is an automated dispatch from the Logistics Document Management System.\n\n` +
    `Regards,\nLogistics DMS`
  );
}

/**
 * Resolve the absolute file path for a stored document (rawFilePath may be
 * relative to the process working directory or already absolute).
 */
function resolveFilePath(rawFilePath: string): string {
  if (path.isAbsolute(rawFilePath)) return rawFilePath;
  const uploadDir = process.env.UPLOAD_DIR ?? './uploads';
  // If rawFilePath already starts with the upload dir prefix, resolve from cwd
  return path.resolve(process.cwd(), rawFilePath);
}

// ── Email dispatch ─────────────────────────────────────────────────────────────

async function sendEmail(opts: {
  recipient: string;
  ccRecipient?: string;
  subject: string;
  body: string;
  attachments: Array<{ filename: string; path: string }>;
}): Promise<void> {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? user ?? 'noreply@logistics-dms.local';

  if (!host || !user || !pass) {
    throw new Error(
      'Email not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS environment variables.'
    );
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

  await transporter.sendMail({
    from,
    to: opts.recipient,
    cc: opts.ccRecipient,
    subject: opts.subject,
    text: opts.body,
    attachments: validAttachments.map((a) => ({ filename: a.filename, path: a.path })),
  });
}

// ── WhatsApp dispatch (Twilio) ─────────────────────────────────────────────────

async function sendWhatsApp(opts: {
  recipient: string;    // E.164 format e.g. +919876543210
  ccRecipient?: string;
  body: string;
  mediaUrls?: string[]; // public HTTPS URLs only
}): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886'; // sandbox default

  if (!accountSid || !authToken) {
    throw new Error(
      'WhatsApp not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN environment variables.'
    );
  }

  const client = twilio(accountSid, authToken);

  const toNumber = opts.recipient.startsWith('whatsapp:')
    ? opts.recipient
    : `whatsapp:${opts.recipient}`;

  // Twilio supports at most one mediaUrl per message; send first attachment URL
  const firstMediaUrl = opts.mediaUrls?.[0];

  await client.messages.create({
    from: fromNumber,
    to: toNumber,
    body: opts.body,
    ...(firstMediaUrl ? { mediaUrl: [firstMediaUrl] } : {}),
  });

  // Auto-CC: send a copy to the CC number if provided
  if (opts.ccRecipient) {
    const ccNumber = opts.ccRecipient.startsWith('whatsapp:')
      ? opts.ccRecipient
      : `whatsapp:${opts.ccRecipient}`;
    await client.messages.create({
      from: fromNumber,
      to: ccNumber,
      body: `[CC copy] ${opts.body}`,
      ...(firstMediaUrl ? { mediaUrl: [firstMediaUrl] } : {}),
    });
  }
}

// ── Main entry point ───────────────────────────────────────────────────────────

export async function dispatchBundle(req: DispatchRequest): Promise<DispatchResult> {
  // 1. Load the bundle with all relations
  const bundle = await prisma.documentBundle.findUnique({
    where: { id: req.bundleId },
    include: {
      group: true,
      items: {
        include: {
          document: { include: { extractedData: true } },
        },
      },
    },
  });

  if (!bundle) throw new Error('Bundle not found');

  // 2. Create a PENDING dispatch log immediately
  const log = await prisma.dispatchLog.create({
    data: {
      bundleId: bundle.id,
      channel: req.channel,
      recipient: req.recipient,
      ccRecipient: req.ccRecipient ?? null,
      message: '',       // filled in after generation
      status: 'PENDING',
    },
  });

  // 3. Generate message
  const documentCount = bundle.items.length;
  const body = generateMessage({
    vehicleNo: bundle.group.vehicleNo,
    date: bundle.group.date,
    recipientType: bundle.recipientType as RecipientType,
    documentCount,
  });

  // 4. Attempt to send
  try {
    if (req.channel === 'EMAIL') {
      const attachments = bundle.items.map((item) => ({
        filename: item.document.originalFilename,
        path: resolveFilePath(item.document.rawFilePath),
      }));

      await sendEmail({
        recipient: req.recipient,
        ccRecipient: req.ccRecipient,
        subject: `Documents for Vehicle ${bundle.group.vehicleNo} – ${bundle.group.date}`,
        body,
        attachments,
      });
    } else {
      // WhatsApp: build public URLs for attachments
      const baseUrl = process.env.BACKEND_PUBLIC_URL ?? 'http://localhost:3001';
      const mediaUrls = bundle.items.map(
        (item) => `${baseUrl}/uploads/${path.basename(item.document.rawFilePath)}`
      );

      await sendWhatsApp({
        recipient: req.recipient,
        ccRecipient: req.ccRecipient,
        body,
        mediaUrls,
      });
    }

    // 5a. Mark as SENT
    await prisma.dispatchLog.update({
      where: { id: log.id },
      data: { status: 'SENT', message: body },
    });

    return { success: true, logId: log.id, message: body };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // 5b. Mark as FAILED
    await prisma.dispatchLog.update({
      where: { id: log.id },
      data: { status: 'FAILED', message: body, errorMsg },
    });

    return { success: false, logId: log.id, error: errorMsg };
  }
}

// ── Log queries ────────────────────────────────────────────────────────────────

export async function listDispatchLogs(opts?: { bundleId?: string; page?: number; limit?: number }) {
  const page = opts?.page ?? 1;
  const limit = opts?.limit ?? 50;
  const skip = (page - 1) * limit;
  const where = opts?.bundleId ? { bundleId: opts.bundleId } : {};

  const [logs, total] = await Promise.all([
    prisma.dispatchLog.findMany({
      where,
      include: {
        bundle: {
          select: {
            recipientType: true,
            group: { select: { vehicleNo: true, date: true } },
          },
        },
      },
      orderBy: { sentAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.dispatchLog.count({ where }),
  ]);

  return { logs, total, page, limit, pages: Math.ceil(total / limit) };
}
