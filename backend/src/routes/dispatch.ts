import { Router, type Request, type Response } from 'express';
import { dispatchBundle, listDispatchLogs } from '../services/dispatchService.js';
import type { DispatchChannel } from '../services/dispatchService.js';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/dispatch/send
// Send a bundle via email or WhatsApp.
//
// Body: {
//   bundleId: string,
//   channel: "EMAIL" | "WHATSAPP",
//   recipient: string,   // email or E.164 phone
//   ccRecipient?: string
// }
// ──────────────────────────────────────────────────────────────────────────────
router.post('/send', async (req: Request, res: Response): Promise<void> => {
  try {
    const { bundleId, channel, recipient, ccRecipient } = req.body as {
      bundleId?: string;
      channel?: string;
      recipient?: string;
      ccRecipient?: string;
    };

    if (!bundleId || !channel || !recipient) {
      res.status(400).json({ error: 'bundleId, channel, and recipient are required' });
      return;
    }

    const validChannels: DispatchChannel[] = ['EMAIL', 'WHATSAPP'];
    if (!validChannels.includes(channel as DispatchChannel)) {
      res.status(400).json({ error: `channel must be one of: ${validChannels.join(', ')}` });
      return;
    }

    // Basic email validation
    if (channel === 'EMAIL' && !recipient.includes('@')) {
      res.status(400).json({ error: 'recipient must be a valid email address for EMAIL channel' });
      return;
    }

    // Basic phone validation for WhatsApp
    if (channel === 'WHATSAPP' && !recipient.match(/^\+?\d{7,15}$/)) {
      res.status(400).json({ error: 'recipient must be an E.164 phone number for WHATSAPP channel (e.g. +919876543210)' });
      return;
    }

    const result = await dispatchBundle({
      bundleId,
      channel: channel as DispatchChannel,
      recipient,
      ccRecipient,
    });

    const statusCode = result.success ? 200 : 502;
    res.status(statusCode).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Dispatch failed';
    const statusCode = message === 'Bundle not found' ? 404 : 500;
    res.status(statusCode).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/dispatch/logs
// List dispatch history across all bundles.
// Query params: page, limit
// ──────────────────────────────────────────────────────────────────────────────
router.get('/logs', async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = '1', limit = '50' } = req.query as Record<string, string>;
    const result = await listDispatchLogs({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch dispatch logs';
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/dispatch/logs/:bundleId
// Dispatch history for a specific bundle.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/logs/:bundleId', async (req: Request, res: Response): Promise<void> => {
  try {
    const bundleId = req.params['bundleId'] as string;
    const result = await listDispatchLogs({ bundleId });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch dispatch logs';
    res.status(500).json({ error: message });
  }
});

export default router;
