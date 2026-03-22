import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prepare } from '../db/database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

export const adminRouter = Router();

// All admin routes require auth + super_admin role
adminRouter.use(requireAuth, requireAdmin);

const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, status = 400) =>
  res.status(status).json({ success: false, error: msg });

// ---------------------------------------------------------------------------
// GET /admin/tenants — list all tenants with stats
// ---------------------------------------------------------------------------
adminRouter.get('/tenants', (_req: Request, res: Response) => {
  const tenants = prepare(`
    SELECT
      t.*,
      COUNT(DISTINCT b.id) AS total_bookings,
      COUNT(DISTINCT s.id) AS specialist_count,
      u.email              AS owner_email,
      u.last_login         AS owner_last_login
    FROM tenants t
    LEFT JOIN bookings    b ON b.tenant_id = t.id AND b.status != 'cancelled'
    LEFT JOIN specialists s ON s.tenant_id = t.id AND s.is_active = 1
    LEFT JOIN users       u ON u.tenant_id = t.id AND u.role = 'shop_owner'
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `).all();

  ok(res, tenants);
});

// ---------------------------------------------------------------------------
// POST /admin/tenants — create a new tenant + shop owner account
// Body: { name, type, ownerEmail, ownerPassword, whatsappNumber, plan }
// ---------------------------------------------------------------------------
adminRouter.post('/tenants', (req: Request, res: Response) => {
  const {
    name, type = 'barbershop', timezone = 'Europe/Tirane',
    ownerEmail, ownerPassword,
    whatsappNumber = '', plan = 'starter', billingEmail = '',
  } = req.body as {
    name: string; type?: string; timezone?: string;
    ownerEmail: string; ownerPassword: string;
    whatsappNumber?: string; plan?: string; billingEmail?: string;
  };

  if (!name || !ownerEmail || !ownerPassword) {
    return err(res, 'name, ownerEmail and ownerPassword are required');
  }
  if (ownerPassword.length < 8) {
    return err(res, 'Password must be at least 8 characters');
  }

  // Check email not already taken
  const existing = prepare('SELECT id FROM users WHERE email = ?').get(ownerEmail.toLowerCase());
  if (existing) return err(res, 'Email already in use');

  const tenantId = crypto.randomUUID();
  const userId   = crypto.randomUUID();
  const hash     = bcrypt.hashSync(ownerPassword, 10);

  prepare(`
    INSERT INTO tenants(id, name, type, timezone, whatsapp_number, plan, is_active, billing_email)
    VALUES (?,?,?,?,?,?,1,?)
  `).run(tenantId, name, type, timezone, whatsappNumber, plan, billingEmail);

  prepare(`
    INSERT INTO users(id, email, password_hash, role, tenant_id, is_active)
    VALUES (?,?,?,'shop_owner',?,1)
  `).run(userId, ownerEmail.toLowerCase(), hash, tenantId);

  ok(res, {
    tenant: prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId),
    user:   prepare('SELECT id, email, role, tenant_id, created_at FROM users WHERE id = ?').get(userId),
  });
});

// ---------------------------------------------------------------------------
// PUT /admin/tenants/:id — update tenant settings
// ---------------------------------------------------------------------------
adminRouter.put('/tenants/:id', (req: Request, res: Response) => {
  const {
    name, whatsappNumber, plan,
    isActive, billingEmail, type, timezone,
  } = req.body as Record<string, any>;

  prepare(`
    UPDATE tenants SET
      name             = COALESCE(?, name),
      whatsapp_number  = COALESCE(?, whatsapp_number),
      plan             = COALESCE(?, plan),
      is_active        = COALESCE(?, is_active),
      billing_email    = COALESCE(?, billing_email),
      type             = COALESCE(?, type),
      timezone         = COALESCE(?, timezone)
    WHERE id = ?
  `).run(
    name ?? null,
    whatsappNumber ?? null,
    plan ?? null,
    isActive !== undefined ? (isActive ? 1 : 0) : null,
    billingEmail ?? null,
    type ?? null,
    timezone ?? null,
    req.params.id,
  );

  ok(res, prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id));
});

// ---------------------------------------------------------------------------
// POST /admin/tenants/:id/reset-password — reset shop owner password
// Body: { newPassword }
// ---------------------------------------------------------------------------
adminRouter.post('/tenants/:id/reset-password', (req: Request, res: Response) => {
  const { newPassword } = req.body as { newPassword: string };
  if (!newPassword || newPassword.length < 8) {
    return err(res, 'Password must be at least 8 characters');
  }

  const user = prepare(
    "SELECT id FROM users WHERE tenant_id = ? AND role = 'shop_owner'"
  ).get(req.params.id) as any;

  if (!user) return err(res, 'No shop owner found for this tenant', 404);

  const hash = bcrypt.hashSync(newPassword, 10);
  prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);

  ok(res, { message: 'Password reset successfully' });
});

// ---------------------------------------------------------------------------
// GET /admin/stats — platform-wide stats for admin dashboard
// ---------------------------------------------------------------------------
adminRouter.get('/stats', (_req: Request, res: Response) => {
  const stats = {
    totalTenants:   (prepare('SELECT COUNT(*) AS c FROM tenants WHERE is_active = 1').get() as any).c,
    totalBookings:  (prepare("SELECT COUNT(*) AS c FROM bookings WHERE status = 'confirmed'").get() as any).c,
    bookingsToday:  (prepare("SELECT COUNT(*) AS c FROM bookings WHERE date(starts_at) = date('now') AND status = 'confirmed'").get() as any).c,
    totalUsers:     (prepare('SELECT COUNT(*) AS c FROM users WHERE is_active = 1').get() as any).c,
  };
  ok(res, stats);
});
