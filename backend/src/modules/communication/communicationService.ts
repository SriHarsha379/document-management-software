/**
 * communicationService.ts
 *
 * High-level service used by the HTTP routes.
 * Orchestrates: validate → resolve recipients → enqueue job → return 202.
 */

import { prisma } from '../../services/documentService.js';
import { jobQueue } from './communicationQueue.js';
import { resolveRecipients } from './recipientResolver.js';
import type { RecipientInput, CommChannel, ResolvedRecipient } from './recipientResolver.js';
import type { JobPriority } from './communicationQueue.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SendCommunicationRequest {
  bundleId?: string;
  channel: CommChannel;
  recipients: RecipientInput[];
  ccAddresses?: string[];
  templateCode?: string;
  scheduledAt?: string;   // ISO-8601
  priority?: JobPriority;
}

export interface SendCommunicationResult {
  jobId: string;
  status: 'QUEUED';
  recipientCount: number;
  resolvedRecipients: Array<{ name: string; address: string; isCC: boolean }>;
  scheduledAt: string;
  warnings?: string[];
}

export class CommunicationValidationError extends Error {
  constructor(msg: string) { super(msg); this.name = 'CommunicationValidationError'; }
}

// ── Send ───────────────────────────────────────────────────────────────────────

export async function sendCommunication(
  companyId: string,
  userId: string,
  req: SendCommunicationRequest,
): Promise<SendCommunicationResult> {
  const { bundleId, channel, recipients, ccAddresses, templateCode, scheduledAt, priority } = req;

  if (!channel || !['EMAIL', 'WHATSAPP', 'BOTH'].includes(channel)) {
    throw new CommunicationValidationError('channel must be EMAIL, WHATSAPP, or BOTH');
  }
  if (!recipients || recipients.length === 0) {
    throw new CommunicationValidationError('recipients must be a non-empty array');
  }

  // Validate bundle exists if provided
  if (bundleId) {
    const bundle = await prisma.documentBundle.findUnique({ where: { id: bundleId } });
    if (!bundle) throw new CommunicationValidationError(`Bundle "${bundleId}" not found`);
  }

  // Resolve for concrete channels
  const concChannels: Array<'EMAIL' | 'WHATSAPP'> = channel === 'BOTH'
    ? ['EMAIL', 'WHATSAPP']
    : [channel];

  const allWarnings: string[] = [];
  const allResolved: ResolvedRecipient[] = [];

  // We resolve for the first concrete channel for the 202 response preview;
  // the worker handles BOTH internally.
  const { resolvedRecipients, warnings } = await resolveRecipients({
    inputs: recipients,
    ccAddresses,
    channel: concChannels[0]!,
    companyId,
  });

  allWarnings.push(...warnings);
  allResolved.push(...resolvedRecipients);

  if (allResolved.length === 0) {
    throw new CommunicationValidationError(
      'No deliverable recipients. Check that the selected records have addresses for the chosen channel. ' +
      (warnings.length > 0 ? `Warnings: ${warnings.join('; ')}` : ''),
    );
  }

  // Build template vars that are known now (bundle vars added by worker)
  const templateVars: Record<string, string> = {};
  if (templateCode) templateVars['templateCode'] = templateCode;

  const scheduledDate = scheduledAt ? new Date(scheduledAt) : new Date();

  const jobId = await jobQueue.enqueue({
    companyId,
    bundleId,
    channel,
    recipients: allResolved,
    templateVars,
    maxRetries: 3,
    scheduledAt: scheduledDate,
    priority: priority ?? 'NORMAL',
    notes: allWarnings.length > 0 ? allWarnings.join('\n') : undefined,
    createdBy: userId,
  });

  return {
    jobId,
    status: 'QUEUED',
    recipientCount: allResolved.length,
    resolvedRecipients: allResolved.map((r) => ({
      name:    r.name,
      address: r.address,
      isCC:    r.isCC,
    })),
    scheduledAt: scheduledDate.toISOString(),
    ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
  };
}

// ── Job queries ────────────────────────────────────────────────────────────────

export async function getJob(jobId: string, companyId: string) {
  const job = await prisma.communicationJob.findFirst({
    where:   { id: jobId, companyId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!job) return null;
  return formatJob(job);
}

export async function listJobs(
  companyId: string,
  opts: { page?: number; limit?: number; status?: string; bundleId?: string } = {},
) {
  const page  = Math.max(1, opts.page  ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const skip  = (page - 1) * limit;

  const where: Record<string, unknown> = { companyId };
  if (opts.status)   where['status']   = opts.status;
  if (opts.bundleId) where['bundleId'] = opts.bundleId;

  const [jobs, total] = await Promise.all([
    prisma.communicationJob.findMany({
      where,
      include: { messages: { select: { id: true, channel: true, recipient: true, status: true, sentAt: true, errorMsg: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.communicationJob.count({ where }),
  ]);

  return { jobs: jobs.map(formatJob), total, page, limit, pages: Math.ceil(total / limit) };
}

// ── Message retry ──────────────────────────────────────────────────────────────

export async function retryMessage(messageId: string, companyId: string) {
  const msg = await prisma.communicationMessage.findFirst({
    where:   { id: messageId },
    include: { job: { select: { companyId: true } } },
  });
  if (!msg)                             return null;
  if (msg.job.companyId !== companyId)  return null;  // not in scope

  if (msg.status === 'SENT') {
    return { messageId, newStatus: 'SENT', note: 'Already delivered' };
  }

  // Reset message to PENDING and re-queue its parent job
  await prisma.communicationMessage.update({
    where: { id: messageId },
    data:  { status: 'PENDING', errorCode: null, errorMsg: null },
  });

  // Re-queue the parent job if it isn't already QUEUED/PROCESSING
  await prisma.communicationJob.updateMany({
    where: { id: msg.jobId, status: { in: ['FAILED', 'DONE', 'CANCELLED'] } },
    data:  { status: 'QUEUED', scheduledAt: new Date() },
  });

  return {
    messageId,
    newStatus:    'QUEUED',
    attemptCount: msg.attemptCount + 1,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatJob(job: {
  id: string;
  companyId: string;
  bundleId: string | null;
  channel: string;
  recipients: string;
  status: string;
  priority: string;
  scheduledAt: Date;
  processedAt: Date | null;
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: Date;
  messages: Array<{
    id: string;
    channel: string;
    recipient: string;
    recipientName?: string | null;
    isCC?: boolean;
    status: string;
    sentAt: Date | null;
    errorMsg: string | null;
    attemptCount?: number;
  }>;
}) {
  return {
    jobId:       job.id,
    companyId:   job.companyId,
    bundleId:    job.bundleId,
    channel:     job.channel,
    status:      job.status,
    priority:    job.priority,
    scheduledAt: job.scheduledAt.toISOString(),
    processedAt: job.processedAt?.toISOString() ?? null,
    retryCount:  job.retryCount,
    maxRetries:  job.maxRetries,
    lastError:   job.lastError,
    notes:       job.notes,
    createdBy:   job.createdBy,
    createdAt:   job.createdAt.toISOString(),
    messages: job.messages.map((m) => ({
      id:            m.id,
      channel:       m.channel,
      recipient:     m.recipient,
      recipientName: 'recipientName' in m ? m.recipientName : undefined,
      isCC:          'isCC' in m ? m.isCC : undefined,
      status:        m.status,
      sentAt:        m.sentAt?.toISOString() ?? null,
      errorMsg:      m.errorMsg,
      attemptCount:  'attemptCount' in m ? m.attemptCount : undefined,
    })),
  };
}
