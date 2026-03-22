import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query, queryOne, queryRun, isPg, prepare } from '../db/database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, status = 400) =>
  res.status(status).json({ success: false, error: msg });

const dbAll = async (sql: string, ...p: unknown[]) =>
  isPg ? query(sql, p) : prepare(sql).all(...p);
const dbGet = async (sql: string, ...p: unknown[]) =>
  isPg ? queryOne(sql, p) : prepare(sql).get(...p);
const dbRun = async (sql: string, ...p: unknown[]) =>
  isPg ? queryRun(sql, p) : prepare(sql).run(...p);

// GET /admin/tenants
adminRouter.get('/tenants', async (_req: Request, res: Response) => {
  try {
    const tenants = await dbAll(`
      SELECT t.*,
        COUNT(DISTINCT b.id)  AS total_bookings,
        COUNT(DISTINCT s.id)  AS specialist_count,
        u.email               AS owner_email,
        u.last_login          AS owner_last_login
      FROM tenants t
      LEFT JOIN bookings    b ON b.tenant_id = t.id AND b.status != 'cancelled'
      LEFT JOIN specialists s ON s.tenant_id = t.id AND s.is_active = 1
      LEFT JOIN users       u ON u.tenant_id = t.id AND u.role = 'shop_owner'
      GROUP BY t.id, u.email, u.last_login
      ORDER BY t.created_at DESC
    `);
    ok(res, tenants);
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /admin/tenants
adminRouter.post('/tenants', async (req: Request, res: Response) => {
  const {
    name, type = 'barbershop', timezone = 'Europe/Tirane',
    ownerEmail, ownerPassword,
    whatsappNumber = '', plan = 'starter', billingEmail = '',
  } = req.body as Record<string, string>;

  if (!name || !ownerEmail || !ownerPassword)
    return err(res, 'name, ownerEmail and ownerPassword are required');
  if (ownerPassword.length < 8)
    return err(res, 'Password must be at least 8 characters');

  const existing = await dbGet(
    isPg ? 'SELECT id FROM users WHERE email = $1' : 'SELECT id FROM users WHERE email = ?',
    ownerEmail.toLowerCase()
  );
  if (existing) return err(res, 'Email already in use');

  const tenantId = crypto.randomUUID();
  const userId   = crypto.randomUUID();
  const hash     = bcrypt.hashSync(ownerPassword, 10);

  await dbRun(
    isPg
      ? 'INSERT INTO tenants(id,name,type,timezone,whatsapp_number,plan,is_active,billing_email) VALUES($1,$2,$3,$4,$5,$6,$7,$8)'
      : 'INSERT INTO tenants(id,name,type,timezone,whatsapp_number,plan,is_active,billing_email) VALUES(?,?,?,?,?,?,1,?)',
    tenantId, name, type, timezone, whatsappNumber, plan, ...(isPg ? [1] : []), billingEmail
  );
  await dbRun(
    isPg
      ? "INSERT INTO users(id,email,password_hash,role,tenant_id,is_active) VALUES($1,$2,$3,'shop_owner',$4,$5)"
      : "INSERT INTO users(id,email,password_hash,role,tenant_id,is_active) VALUES(?,?,?,'shop_owner',?,1)",
    userId, ownerEmail.toLowerCase(), hash, tenantId, ...(isPg ? [1] : [])
  );

  const tenant = await dbGet(isPg ? 'SELECT * FROM tenants WHERE id = $1' : 'SELECT * FROM tenants WHERE id = ?', tenantId);
  const user   = await dbGet(
    isPg ? 'SELECT id,email,role,tenant_id,created_at FROM users WHERE id = $1'
         : 'SELECT id,email,role,tenant_id,created_at FROM users WHERE id = ?',
    userId
  );
  ok(res, { tenant, user });
});

// PUT /admin/tenants/:id
adminRouter.put('/tenants/:id', async (req: Request, res: Response) => {
  try {
    const { name, whatsappNumber, plan, isActive, billingEmail, type, timezone } = req.body as Record<string, any>;
    if (isPg) {
      await queryRun(`
        UPDATE tenants SET
          name            = COALESCE($1, name),
          whatsapp_number = COALESCE($2, whatsapp_number),
          plan            = COALESCE($3, plan),
          is_active       = COALESCE($4, is_active),
          billing_email   = COALESCE($5, billing_email),
          type            = COALESCE($6, type),
          timezone        = COALESCE($7, timezone)
        WHERE id = $8
      `, [name??null, whatsappNumber??null, plan??null,
          isActive !== undefined ? (isActive ? 1 : 0) : null,
          billingEmail??null, type??null, timezone??null, req.params.id]);
    } else {
      prepare(`UPDATE tenants SET
        name=COALESCE(?,name), whatsapp_number=COALESCE(?,whatsapp_number),
        plan=COALESCE(?,plan), is_active=COALESCE(?,is_active),
        billing_email=COALESCE(?,billing_email), type=COALESCE(?,type),
        timezone=COALESCE(?,timezone) WHERE id=?`)
        .run(name??null, whatsappNumber??null, plan??null,
             isActive !== undefined ? (isActive ? 1 : 0) : null,
             billingEmail??null, type??null, timezone??null, req.params.id);
    }
    ok(res, await dbGet(isPg ? 'SELECT * FROM tenants WHERE id = $1' : 'SELECT * FROM tenants WHERE id = ?', req.params.id));
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /admin/tenants/:id/reset-password
adminRouter.post('/tenants/:id/reset-password', async (req: Request, res: Response) => {
  try {
    const { newPassword } = req.body as { newPassword: string };
    if (!newPassword || newPassword.length < 8)
      return err(res, 'Password must be at least 8 characters');

    const user = await dbGet(
      isPg ? "SELECT id FROM users WHERE tenant_id = $1 AND role = 'shop_owner'"
           : "SELECT id FROM users WHERE tenant_id = ? AND role = 'shop_owner'",
      req.params.id
    ) as any;
    if (!user) return err(res, 'No shop owner found', 404);

    const hash = bcrypt.hashSync(newPassword, 10);
    await dbRun(
      isPg ? 'UPDATE users SET password_hash = $1 WHERE id = $2'
           : 'UPDATE users SET password_hash = ? WHERE id = ?',
      hash, user.id
    );
    ok(res, { message: 'Password reset successfully' });
  } catch (e: any) { err(res, e.message, 500); }
});

// GET /admin/stats
adminRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [t, b, bt, u] = await Promise.all([
      dbGet(isPg ? 'SELECT COUNT(*) AS c FROM tenants WHERE is_active = 1' : "SELECT COUNT(*) AS c FROM tenants WHERE is_active = 1"),
      dbGet(isPg ? "SELECT COUNT(*) AS c FROM bookings WHERE status = 'confirmed'" : "SELECT COUNT(*) AS c FROM bookings WHERE status = 'confirmed'"),
      dbGet(isPg ? "SELECT COUNT(*) AS c FROM bookings WHERE starts_at::date = CURRENT_DATE AND status = 'confirmed'"
                 : "SELECT COUNT(*) AS c FROM bookings WHERE date(starts_at) = date('now') AND status = 'confirmed'"),
      dbGet(isPg ? 'SELECT COUNT(*) AS c FROM users WHERE is_active = 1' : 'SELECT COUNT(*) AS c FROM users WHERE is_active = 1'),
    ]);
    ok(res, {
      totalTenants:  Number((t as any)?.c ?? 0),
      totalBookings: Number((b as any)?.c ?? 0),
      bookingsToday: Number((bt as any)?.c ?? 0),
      totalUsers:    Number((u as any)?.c ?? 0),
    });
  } catch (e: any) { err(res, e.message, 500); }
});
