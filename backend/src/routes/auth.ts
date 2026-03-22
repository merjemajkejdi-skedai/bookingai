import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prepare } from '../db/database.js';
import { requireAuth } from '../middleware/auth.js';
import { getJwtSecret } from '../lib/jwt.js';

export const authRouter = Router();

const TOKEN_TTL = '7d'; // Tokens expire after 7 days

// ---------------------------------------------------------------------------
// POST /auth/login
// Body: { email, password }
// ---------------------------------------------------------------------------
authRouter.post('/login', (req: Request, res: Response) => {
  const { email, password } = req.body as { email: string; password: string };

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password required' });
  }

  const user = prepare(
    'SELECT * FROM users WHERE email = ? AND is_active = 1'
  ).get(email.toLowerCase().trim()) as any;

  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid email or password' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ success: false, error: 'Invalid email or password' });
  }

  // Update last_login
  prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

  const payload = {
    userId:   user.id,
    email:    user.email,
    role:     user.role,
    tenantId: user.tenant_id,
  };

  const token = jwt.sign(payload, getJwtSecret(), { expiresIn: TOKEN_TTL });

  // Get tenant name for the response
  const tenant = user.tenant_id
    ? prepare('SELECT name, type, plan, is_active FROM tenants WHERE id = ?').get(user.tenant_id) as any
    : null;

  res.json({
    success: true,
    data: {
      token,
      user: {
        id:       user.id,
        email:    user.email,
        role:     user.role,
        tenantId: user.tenant_id,
        tenant:   tenant ? { name: tenant.name, type: tenant.type, plan: tenant.plan } : null,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /auth/me — returns current user from token
// ---------------------------------------------------------------------------
authRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = prepare(
    'SELECT id, email, role, tenant_id, is_active, last_login, created_at FROM users WHERE id = ?'
  ).get(req.user!.userId) as any;

  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  const tenant = user.tenant_id
    ? prepare('SELECT id, name, type, plan, whatsapp_number, is_active FROM tenants WHERE id = ?').get(user.tenant_id) as any
    : null;

  res.json({ success: true, data: { ...user, tenant } });
});

// ---------------------------------------------------------------------------
// POST /auth/change-password
// Body: { currentPassword, newPassword }
// ---------------------------------------------------------------------------
authRouter.post('/change-password', requireAuth, (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Both passwords required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
  }

  const user = prepare('SELECT * FROM users WHERE id = ?').get(req.user!.userId) as any;
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ success: false, error: 'Current password is incorrect' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);

  res.json({ success: true, data: { message: 'Password updated' } });
});
