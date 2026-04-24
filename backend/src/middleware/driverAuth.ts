import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'change-me-in-production';

export interface DriverTokenPayload {
  driverAccessId: string;
  phone: string;
  expiresAt: string; // ISO string
}

export function signDriverToken(payload: DriverTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

export function requireDriverAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as DriverTokenPayload;

    // Check access expiry stored in token
    const expiresAt = new Date(payload.expiresAt);
    if (expiresAt < new Date()) {
      res.status(403).json({ error: 'Access Expired', code: 'ACCESS_EXPIRED' });
      return;
    }

    (req as Request & { driver: DriverTokenPayload }).driver = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
