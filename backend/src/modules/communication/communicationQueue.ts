/**
 * communicationQueue.ts
 *
 * Abstraction layer for the async job queue used by the communication module.
 *
 * IJobQueue — interface that any queue backend must implement.
 * DbJobQueue  — durable DB-backed implementation (no extra infra required).
 *               Polls `communication_jobs` every POLL_INTERVAL_MS for QUEUED
 *               rows whose scheduledAt ≤ NOW().
 *
 * To switch to BullMQ/Redis in the future, implement IJobQueue with BullMQ
 * and pass the new instance to startCommunicationWorker().
 */

import { prisma } from '../../services/documentService.js';
import type { ResolvedRecipient } from './recipientResolver.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type CommChannel = 'EMAIL' | 'WHATSAPP' | 'BOTH';
export type JobStatus   = 'QUEUED' | 'PROCESSING' | 'DONE' | 'FAILED' | 'CANCELLED';
export type JobPriority = 'HIGH' | 'NORMAL' | 'LOW';

export interface JobPayload {
  jobId: string;
  companyId: string;
  bundleId?: string;
  channel: CommChannel;
  recipients: ResolvedRecipient[];   // already resolved
  templateVars: Record<string, string | number>;
  templateCode?: string;
  maxRetries: number;
}

export interface IJobQueue {
  /** Persist a job and return its id. */
  enqueue(payload: Omit<JobPayload, 'jobId'> & {
    scheduledAt?: Date;
    priority?: JobPriority;
    templateId?: string;
    notes?: string;
    createdBy?: string;
  }): Promise<string>;

  /** Register the handler that processes each job.  Implementations call it
   *  for every ready job; the handler is responsible for persisting results. */
  process(handler: (payload: JobPayload) => Promise<void>): void;

  /** Start polling / listening. Returns a stop function. */
  start(): () => void;
}

// ── DbJobQueue ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS    = 10_000;   // poll every 10 s
const BATCH_SIZE          = 10;       // max jobs per poll cycle
const STALE_AFTER_MINUTES = 15;       // jobs stuck in PROCESSING reset to QUEUED

export class DbJobQueue implements IJobQueue {
  private handler: ((payload: JobPayload) => Promise<void>) | null = null;

  async enqueue(opts: {
    companyId: string;
    bundleId?: string;
    channel: CommChannel;
    recipients: ResolvedRecipient[];
    templateVars: Record<string, string | number>;
    templateCode?: string;
    templateId?: string;
    maxRetries?: number;
    scheduledAt?: Date;
    priority?: JobPriority;
    notes?: string;
    createdBy?: string;
  }): Promise<string> {
    const job = await prisma.communicationJob.create({
      data: {
        companyId:    opts.companyId,
        bundleId:     opts.bundleId ?? null,
        channel:      opts.channel as import('@prisma/client').$Enums.CommChannel,
        recipients:   JSON.stringify(opts.recipients),
        templateId:   opts.templateId ?? null,
        templateVars: JSON.stringify(opts.templateVars),
        status:       'QUEUED',
        priority:     (opts.priority ?? 'NORMAL') as import('@prisma/client').$Enums.JobPriority,
        scheduledAt:  opts.scheduledAt ?? new Date(),
        maxRetries:   opts.maxRetries ?? 3,
        notes:        opts.notes ?? null,
        createdBy:    opts.createdBy ?? null,
      },
    });
    return job.id;
  }

  process(handler: (payload: JobPayload) => Promise<void>): void {
    this.handler = handler;
  }

  start(): () => void {
    const interval = setInterval(() => { void this.tick(); }, POLL_INTERVAL_MS);
    // Run one tick immediately on startup
    void this.tick();
    return () => clearInterval(interval);
  }

  // ── Internal ──────────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (!this.handler) return;

    // Recover stale PROCESSING jobs
    const staleThreshold = new Date(Date.now() - STALE_AFTER_MINUTES * 60_000);
    await prisma.communicationJob.updateMany({
      where: { status: 'PROCESSING', updatedAt: { lt: staleThreshold } },
      data:  { status: 'QUEUED' },
    });

    // Pick up QUEUED jobs that are due
    const jobs = await prisma.communicationJob.findMany({
      where: {
        status:      'QUEUED',
        scheduledAt: { lte: new Date() },
      },
      orderBy: [
        { priority: 'asc' },   // HIGH < NORMAL < LOW alphabetically — fine for SQLite
        { scheduledAt: 'asc' },
      ],
      take: BATCH_SIZE,
    });

    for (const job of jobs) {
      // Atomically claim the job
      const claimed = await prisma.communicationJob.updateMany({
        where: { id: job.id, status: 'QUEUED' },
        data:  { status: 'PROCESSING' },
      });
      if (claimed.count === 0) continue; // another worker grabbed it

      const payload: JobPayload = {
        jobId:        job.id,
        companyId:    job.companyId,
        bundleId:     job.bundleId ?? undefined,
        channel:      job.channel as CommChannel,
        recipients:   JSON.parse(job.recipients) as ResolvedRecipient[],
        templateVars: JSON.parse(job.templateVars) as Record<string, string | number>,
        maxRetries:   job.maxRetries,
      };

      try {
        await this.handler(payload);
        await prisma.communicationJob.update({
          where: { id: job.id },
          data: { status: 'DONE', processedAt: new Date() },
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const retryCount = job.retryCount + 1;
        if (retryCount >= job.maxRetries) {
          await prisma.communicationJob.update({
            where: { id: job.id },
            data: { status: 'FAILED', retryCount, lastError: errMsg, processedAt: new Date() },
          });
        } else {
          // Exponential back-off: 30s, 2m, 10m, …
          const backoffMs = [30_000, 120_000, 600_000][retryCount - 1] ?? 600_000;
          await prisma.communicationJob.update({
            where: { id: job.id },
            data: {
              status:      'QUEUED',
              retryCount,
              lastError:   errMsg,
              scheduledAt: new Date(Date.now() + backoffMs),
            },
          });
        }
      }
    }
  }
}

// ── Singleton queue instance ───────────────────────────────────────────────────

export const jobQueue: IJobQueue = new DbJobQueue();
