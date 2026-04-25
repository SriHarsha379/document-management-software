import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { loginUser, verifyUserToken } from './auth.service.js';
import type { UserContext } from '../rbac/userContext.js';

const router = Router();

// Rate limiter: max 10 login attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
});

// ── requireAuth middleware ─────────────────────────────────────────────────────
// Exported so other route files can import and apply it directly.

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const context = verifyUserToken(token);
  if (!context) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.user = context as UserContext;
  next();
}

// ── POST /api/auth/login ───────────────────────────────────────────────────────

router.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const result = await loginUser(email, password);
  if (!result) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  res.json({ token: result.token, user: result.user });
});

// ── GET /api/auth/me ───────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req: Request, res: Response): void => {
  res.json({ user: req.user });
});

export default router;
