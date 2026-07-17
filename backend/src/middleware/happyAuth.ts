import jwt from 'jsonwebtoken';
import { isPg, prepare, queryOne } from '../db/database.js';
import { getJwtSecret } from '../lib/jwt.js';

// happy_restaurant / happy_bar / happy_hybrid — POS staff auth.
// Deliberately separate from AuthUser (middleware/auth.ts) and ShopUser
// (middleware/shopAuth.ts) — different payload shape, different table
// (happy_staff, not users/shop_users), so a happy_ token can never be
// mistaken for a SkedAI dashboard or shop-dashboard session and vice versa.

export type HappyRole = 'waiter' | 'manager' | 'kitchen' | 'bar' | 'admin';
export type HappyVenueType = 'happy_restaurant' | 'happy_bar' | 'happy_hybrid';

export interface HappyUser {
  staffId:    string;
  tenantId:   string;
  venueType:  HappyVenueType;
  role:       HappyRole;
  name:       string;
}

declare global {
  namespace Express {
    interface Request {
      happyUser?: HappyUser;
    }
  }
}

async function dbGet(sql: string, ...p: unknown[]) {
  return (isPg ? queryOne(sql, p) : prepare(sql).get(...p)) as any;
}

export async function requireHappyAuth(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorised' });
  }
  const token = auth.slice(7);
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as any;
    if (decoded.type !== 'happy_staff') {
      return res.status(401).json({ success: false, error: 'Not a restaurant staff token' });
    }
    if (typeof decoded.venueType !== 'string' || !decoded.venueType.startsWith('happy_')) {
      return res.status(401).json({ success: false, error: 'Invalid tenant type' });
    }
    const staff = await dbGet(
      `SELECT id, tenant_id, role, name, is_active FROM happy_staff WHERE id = ? AND tenant_id = ?`,
      decoded.staffId, decoded.tenantId,
    );
    if (!staff)          return res.status(401).json({ success: false, error: 'Staff not found' });
    if (!staff.is_active) return res.status(401).json({ success: false, error: 'Account deactivated' });

    req.happyUser = {
      staffId:   staff.id,
      tenantId:  staff.tenant_id,
      venueType: decoded.venueType,
      role:      staff.role,
      name:      staff.name,
    } as HappyUser;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

export function requireHappyRole(roles: HappyRole | HappyRole[]) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req: any, res: any, next: any) => {
    const user = req.happyUser as HappyUser | undefined;
    if (!user) return res.status(401).json({ success: false, error: 'Unauthorised' });
    if (!allowed.includes(user.role)) return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    next();
  };
}
