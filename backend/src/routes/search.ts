import { Router, type Request, type Response } from 'express';
import { searchDocuments } from '../services/searchService.js';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/search
// Accept a natural language query, parse it via OpenAI into structured filters,
// execute the DB search, and return matching documents with resolved filter chips.
//
// Body: { query: string }
// ──────────────────────────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { query } = req.body as { query?: string };

    if (!query || typeof query !== 'string' || query.trim() === '') {
      res.status(400).json({ error: 'query is required and must be a non-empty string' });
      return;
    }

    const trimmed = query.trim().slice(0, 500); // guard against very long inputs

    const result = await searchDocuments(trimmed);

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed';
    res.status(500).json({ error: message });
  }
});

export default router;
