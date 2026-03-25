import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../lib/jwt.js';

export interface AuthUser {
  userId: string;
  email: string;
  role: 'super_admin' | 'shop_owner';
  tenantId: string | null;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// ---------------------------------------------------------------------------
// requireAuth — rejects requests with no valid JWT
// ---------------------------------------------------------------------------
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, getJwtSecret()) as AuthUser;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

// ---------------------------------------------------------------------------
// requireAdmin — only super_admin can proceed
// ---------------------------------------------------------------------------
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'super_admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

// ---------------------------------------------------------------------------
// resolveTenantId — gets the right tenantId for the request:
//   super_admin: uses ?tenantId query param or body.tenantId
//   shop_owner:  always uses their own tenantId, ignores any override
// ---------------------------------------------------------------------------
export function resolveTenantId(req: Request, fallback = 'tenant-demo-001'): string {
  if (!req.user) return fallback;
  if (req.user.role === 'super_admin') {
    const fromQuery = typeof req.query.tenantId === 'string' && req.query.tenantId.trim()
      ? req.query.tenantId.trim() : null;
    const fromBody  = typeof req.body?.tenantId === 'string' && req.body.tenantId.trim()
      ? req.body.tenantId.trim() : null;
    return fromQuery || fromBody || fallback;
  }
  const id = req.user.tenantId;
  return (typeof id === 'string' && id.trim()) ? id.trim() : fallback;
}
