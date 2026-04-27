import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const CUSTOMER_JWT_SECRET = process.env.CUSTOMER_JWT_SECRET ?? process.env.JWT_SECRET ?? 'customer-change-me-in-production';

export interface CustomerTokenPayload {
  accessId: string;
  partyId: string;
  partyName: string;
  loginEmail: string;
  companyId: string;
  expiresAt: string; // ISO string
}

export function signCustomerToken(payload: CustomerTokenPayload): string {
  return jwt.sign(payload, CUSTOMER_JWT_SECRET, { expiresIn: '8h' });
}

export function requireCustomerAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, CUSTOMER_JWT_SECRET) as CustomerTokenPayload;

    // Check access expiry stored in token
    const expiresAt = new Date(payload.expiresAt);
    if (expiresAt < new Date()) {
      res.status(403).json({ error: 'Access Expired', code: 'ACCESS_EXPIRED' });
      return;
    }

    (req as Request & { customer: CustomerTokenPayload }).customer = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
