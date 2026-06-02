import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, status = 400) =>
  res.status(status).json({ success: false, error: msg });

async function dbAll(sql: string, ...params: unknown[]) {
  return isPg ? query(sql, params) : prepare(sql).all(...params);
}
async function dbGet(sql: string, ...params: unknown[]) {
  return isPg ? queryOne(sql, params) : prepare(sql).get(...params);
}
async function dbRun(sql: string, ...params: unknown[]) {
  if (isPg) return queryRun(sql, params);
  prepare(sql).run(...params);
}

// GET /admin/tenants
adminRouter.get('/tenants', async (_req: Request, res: Response) => {
  const tenants = await dbAll(`
    SELECT t.*,
      COUNT(DISTINCT b.id) AS total_bookings,
      COUNT(DISTINCT s.id) AS specialist_count,
      u.email AS owner_email, u.last_login AS owner_last_login
    FROM tenants t
    LEFT JOIN bookings b ON b.tenant_id=t.id AND b.status != 'cancelled'
    LEFT JOIN specialists s ON s.tenant_id=t.id AND s.is_active=1
    LEFT JOIN users u ON u.tenant_id=t.id AND u.role='shop_owner'
    GROUP BY t.id, u.email, u.last_login
    ORDER BY t.created_at DESC
  `);
  ok(res, tenants);
});

// Normalise a WhatsApp number — always stored with whatsapp: prefix
function normaliseWhatsapp(raw: string | undefined | null): string {
  if (!raw) return '';
  const cleaned = raw.trim();
  return cleaned.startsWith('whatsapp:') ? cleaned : `whatsapp:${cleaned}`;
}

// POST /admin/tenants
adminRouter.post('/tenants', async (req: Request, res: Response) => {
  const {
    name, type='barbershop', timezone='Europe/Tirane',
    ownerEmail, ownerPassword, whatsappNumber='', plan='starter', billingEmail='',
    provider='twilio', metaPhoneNumberId='', metaAccessToken='', metaWabaId='',
    twilioAccountSid='', twilioAuthToken='',
  } = req.body;

  if (!name || !ownerEmail || !ownerPassword)
    return err(res, 'name, ownerEmail and ownerPassword are required');
  if (ownerPassword.length < 8)
    return err(res, 'Password must be at least 8 characters');

  const existing = await dbGet('SELECT id FROM users WHERE email=?', ownerEmail.toLowerCase());
  if (existing) return err(res, 'Email already in use');

  const tenantId           = crypto.randomUUID();
  const userId             = crypto.randomUUID();
  const hash               = bcrypt.hashSync(ownerPassword, 10);
  const normalisedWhatsapp = normaliseWhatsapp(whatsappNumber);

  await dbRun(
    `INSERT INTO tenants
       (id,name,type,timezone,whatsapp_number,plan,is_active,billing_email,
        provider,meta_phone_number_id,meta_access_token,meta_waba_id,
        twilio_account_sid,twilio_auth_token)
     VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?)`,
    tenantId, name, type, timezone, normalisedWhatsapp, plan, billingEmail,
    provider, metaPhoneNumberId||null, metaAccessToken||null, metaWabaId||null,
    twilioAccountSid||null, twilioAuthToken||null,
  );
  await dbRun(
    "INSERT INTO users(id,email,password_hash,role,tenant_id,is_active) VALUES (?,?,?,'shop_owner',?,1)",
    userId, ownerEmail.toLowerCase(), hash, tenantId,
  );

  ok(res, {
    tenant: await dbGet('SELECT * FROM tenants WHERE id=?', tenantId),
    user:   await dbGet('SELECT id,email,role,tenant_id,created_at FROM users WHERE id=?', userId),
  });
});

// PUT /admin/tenants/:id
adminRouter.put('/tenants/:id', async (req: Request, res: Response) => {
  const {
    name, whatsappNumber, plan, isActive, billingEmail, type, timezone, hasAnalytics,
    reviewsEnabled, surveyEnabled,
    provider, metaPhoneNumberId, metaAccessToken, metaWabaId,
    twilioAccountSid, twilioAuthToken,
  } = req.body;

  // Normalise: always store with whatsapp: prefix; empty string → null (don't overwrite)
  const normalisedWhatsapp = whatsappNumber
    ? normaliseWhatsapp(whatsappNumber)
    : null;

  await dbRun(
    `UPDATE tenants SET
       name                 = COALESCE(?,name),
       whatsapp_number      = COALESCE(?,whatsapp_number),
       plan                 = COALESCE(?,plan),
       is_active            = COALESCE(?,is_active),
       billing_email        = COALESCE(?,billing_email),
       type                 = COALESCE(?,type),
       timezone             = COALESCE(?,timezone),
       has_analytics        = COALESCE(?,has_analytics),
       reviews_enabled      = COALESCE(?,reviews_enabled),
       survey_enabled       = COALESCE(?,survey_enabled),
       provider             = COALESCE(?,provider),
       meta_phone_number_id = COALESCE(?,meta_phone_number_id),
       meta_access_token    = COALESCE(?,meta_access_token),
       meta_waba_id         = COALESCE(?,meta_waba_id),
       twilio_account_sid   = COALESCE(?,twilio_account_sid),
       twilio_auth_token    = COALESCE(?,twilio_auth_token)
     WHERE id=?`,
    name??null, normalisedWhatsapp, plan??null,
    isActive !== undefined ? (isActive ? 1 : 0) : null,
    billingEmail??null, type??null, timezone??null,
    hasAnalytics    !== undefined ? (hasAnalytics    ? 1 : 0) : null,
    reviewsEnabled  !== undefined ? (reviewsEnabled  ? 1 : 0) : null,
    surveyEnabled   !== undefined ? (surveyEnabled   ? 1 : 0) : null,
    provider??null, metaPhoneNumberId??null, metaAccessToken??null, metaWabaId??null,
    twilioAccountSid||null, twilioAuthToken||null,
    req.params.id,
  );
  ok(res, await dbGet('SELECT * FROM tenants WHERE id=?', req.params.id));
});

// POST /admin/tenants/:id/reset-password
adminRouter.post('/tenants/:id/reset-password', async (req: Request, res: Response) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8)
    return err(res, 'Password must be at least 8 characters');

  const user = await dbGet("SELECT id FROM users WHERE tenant_id=? AND role='shop_owner'", req.params.id) as any;
  if (!user) return err(res, 'No shop owner found', 404);

  await dbRun('UPDATE users SET password_hash=? WHERE id=?', bcrypt.hashSync(newPassword, 10), user.id);
  ok(res, { message: 'Password reset successfully' });
});

// POST /admin/tenants/:id/migrate-demo-data
// Re-assigns records stored under 'tenant-demo-001' (the old fallback) to this tenant
adminRouter.post('/tenants/:id/migrate-demo-data', async (req: Request, res: Response) => {
  const { id } = req.params;
  const tenant = await dbGet('SELECT id FROM tenants WHERE id=?', id) as any;
  if (!tenant) return err(res, 'Tenant not found', 404);
  try {
    const results: Record<string, number> = {};
    for (const table of ['bookings', 'art_events', 'event_templates', 'event_registrations', 'specialists', 'services']) {
      const r = await dbAll(
        `SELECT COUNT(*) AS c FROM ${table} WHERE tenant_id='tenant-demo-001'`
      ) as any[];
      const count = Number(r[0]?.c ?? 0);
      if (count > 0) {
        await dbRun(`UPDATE ${table} SET tenant_id=? WHERE tenant_id='tenant-demo-001'`, id);
        results[table] = count;
      }
    }
    ok(res, { migrated: results });
  } catch (e: any) { err(res, e.message, 500); }
});

// GET /admin/stats
adminRouter.get('/stats', async (_req: Request, res: Response) => {
  const [t, b, bt, u] = await Promise.all([
    dbGet('SELECT COUNT(*) AS c FROM tenants WHERE is_active=1'),
    dbGet("SELECT COUNT(*) AS c FROM bookings WHERE status='confirmed'"),
    dbGet("SELECT COUNT(*) AS c FROM bookings WHERE DATE(starts_at)=CURRENT_DATE AND status='confirmed'"),
    dbGet('SELECT COUNT(*) AS c FROM users WHERE is_active=1'),
  ]);
  ok(res, {
    totalTenants:  (t as any)?.c ?? 0,
    totalBookings: (b as any)?.c ?? 0,
    bookingsToday: (bt as any)?.c ?? 0,
    totalUsers:    (u as any)?.c ?? 0,
  });
});
