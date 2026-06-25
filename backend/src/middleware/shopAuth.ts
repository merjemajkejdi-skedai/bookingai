import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { getJwtSecret } from '../lib/jwt.js';

export interface ShopUser {
  userId:         string;
  tenantId:       string;
  username:       string;
  name:           string;
  surname:        string;
  role:           'operator' | 'supervisor' | 'admin';
  sessionVersion: number;
}

async function dbGet(sql: string, ...p: unknown[]) {
  return (isPg ? queryOne(sql, p) : prepare(sql).get(...p)) as any;
}

async function dbRun(sql: string, ...p: unknown[]) {
  if (isPg) return queryRun(sql, p);
  prepare(sql).run(...p);
}

export async function authenticateShopUser(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorised' });
  }
  const token = auth.slice(7);
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as any;
    if (decoded.type !== 'shop_user') {
      return res.status(401).json({ success: false, error: 'Not a shop user token' });
    }
    const user = await dbGet(
      `SELECT id, tenant_id, username, name, surname, role, is_active, session_version FROM shop_users WHERE id = ? AND tenant_id = ?`,
      decoded.userId, decoded.tenantId,
    );
    if (!user) return res.status(401).json({ success: false, error: 'User not found' });
    if (!user.is_active) return res.status(401).json({ success: false, error: 'Account deactivated' });
    if (Number(user.session_version) !== Number(decoded.sessionVersion)) {
      return res.status(401).json({ success: false, error: 'Session expired — please log in again' });
    }
    req.shopUser = {
      userId:         user.id,
      tenantId:       user.tenant_id,
      username:       user.username,
      name:           user.name,
      surname:        user.surname,
      role:           user.role,
      sessionVersion: user.session_version,
    } as ShopUser;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

export function requireRole(roles: string | string[]) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req: any, res: any, next: any) => {
    if (!req.shopUser) return res.status(401).json({ success: false, error: 'Unauthorised' });
    if (!allowed.includes(req.shopUser.role)) return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    next();
  };
}

export async function auditLog(
  tenantId:   string,
  userId:     string | null,
  userName:   string | null,
  action:     string,
  entityType: string | null,
  entityId:   string | null,
  details:    any = null,
) {
  try {
    await dbRun(
      `INSERT INTO shop_audit_log (id, tenant_id, user_id, user_name, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?,?,?)`,
      crypto.randomUUID(), tenantId, userId, userName, action, entityType, entityId,
      details ? JSON.stringify(details) : null,
    );
  } catch (err) {
    console.error('[Audit] Failed to log:', err);
  }
}
