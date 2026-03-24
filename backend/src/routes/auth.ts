import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { queryOne, queryRun, prepare, isPg } from '../db/database.js';
import { requireAuth } from '../middleware/auth.js';
import { getJwtSecret } from '../lib/jwt.js';

export const authRouter = Router();
const TOKEN_TTL = '7d';

authRouter.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email: string; password: string };
  if (!email || !password)
    return res.status(400).json({ success: false, error: 'Email and password required' });

  const user: any = isPg
    ? await queryOne('SELECT * FROM users WHERE email = $1 AND is_active = 1', [email.toLowerCase().trim()])
    : prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.toLowerCase().trim());

  if (!user) return res.status(401).json({ success: false, error: 'Invalid email or password' });

  if (!bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ success: false, error: 'Invalid email or password' });

  if (isPg) await queryRun('UPDATE users SET last_login = NOW()::text WHERE id = $1', [user.id]);
  else prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, tenantId: user.tenant_id },
    getJwtSecret(), { expiresIn: TOKEN_TTL }
  );

  const tenant: any = user.tenant_id
    ? isPg
      ? await queryOne('SELECT name, type, plan, has_analytics FROM tenants WHERE id = $1', [user.tenant_id])
      : prepare('SELECT name, type, plan, has_analytics FROM tenants WHERE id = ?').get(user.tenant_id)
    : null;

  res.json({ success: true, data: {
    token,
    user: { id: user.id, email: user.email, role: user.role, tenantId: user.tenant_id,
      tenant: tenant ? { name: tenant.name, type: tenant.type, plan: tenant.plan, hasAnalytics: !!tenant.has_analytics } : null }
  }});
});

authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user: any = isPg
    ? await queryOne('SELECT id,email,role,tenant_id,is_active,last_login,created_at FROM users WHERE id = $1', [req.user!.userId])
    : prepare('SELECT id,email,role,tenant_id,is_active,last_login,created_at FROM users WHERE id = ?').get(req.user!.userId);

  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const tenant: any = user.tenant_id
    ? isPg
      ? await queryOne('SELECT id,name,type,plan,whatsapp_number,is_active,has_analytics FROM tenants WHERE id = $1', [user.tenant_id])
      : prepare('SELECT id,name,type,plan,whatsapp_number,is_active,has_analytics FROM tenants WHERE id = ?').get(user.tenant_id)
    : null;

  res.json({ success: true, data: { ...user, tenant } });
});

authRouter.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
  if (!currentPassword || !newPassword)
    return res.status(400).json({ success: false, error: 'Both passwords required' });
  if (newPassword.length < 8)
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });

  const user: any = isPg
    ? await queryOne('SELECT * FROM users WHERE id = $1', [req.user!.userId])
    : prepare('SELECT * FROM users WHERE id = ?').get(req.user!.userId);

  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  if (!bcrypt.compareSync(currentPassword, user.password_hash))
    return res.status(401).json({ success: false, error: 'Current password is incorrect' });

  const hash = bcrypt.hashSync(newPassword, 10);
  if (isPg) await queryRun('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
  else prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);

  res.json({ success: true, data: { message: 'Password updated' } });
});
