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
  return (isPg ? query(sql, params) : prepare(sql).all(...params)) as any[];
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

const HAPPY_TYPES = ['happy_restaurant', 'happy_bar', 'happy_hybrid'];

function slugify(raw: string): string {
  return raw.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'venue';
}

// Provision a happy_settings row for a freshly-created happy_ tenant.
// tenant_code is how staff identify the venue at POS login (/restaurant/auth/login).
async function provisionHappySettings(tenantId: string, venueType: string, venueName: string, requestedCode?: string) {
  let code = slugify(requestedCode || venueName);
  let suffix = 0;
  while (await dbGet('SELECT 1 FROM happy_settings WHERE tenant_code=?', suffix ? `${code}-${suffix}` : code)) {
    suffix += 1;
  }
  if (suffix) code = `${code}-${suffix}`;

  const isBar = venueType === 'happy_bar';
  await dbRun(
    `INSERT INTO happy_settings
       (id, tenant_id, venue_type, venue_name, tenant_code,
        counter_service_enabled, send_by_course, kitchen_display_enabled, bar_display_enabled)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    crypto.randomUUID(), tenantId, venueType, venueName, code,
    isBar ? 1 : 0,           // counter_service_enabled defaults on for bars
    0,                       // send_by_course — off until enabled explicitly (always off for bars)
    isBar ? 0 : 1,           // kitchen_display_enabled — always off for bars
    venueType === 'happy_restaurant' ? 0 : 1, // bar_display_enabled — on for bar/hybrid
  );
  return code;
}

// Bootstrap: happy_staff admin creation normally requires an admin token,
// which doesn't exist yet for a brand-new tenant. The super_admin-authenticated
// tenant-creation flow is the one trusted place allowed to seed the first
// admin account (bcrypt-hashed PIN, same as every other happy_staff row).
function randomPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function provisionInitialHappyAdmin(tenantId: string) {
  const pin = randomPin();
  const pinHash = bcrypt.hashSync(pin, 10);
  await dbRun(
    `INSERT INTO happy_staff (id, tenant_id, name, role, pin_hash) VALUES (?,?,?,?,?)`,
    crypto.randomUUID(), tenantId, 'Admin', 'admin', pinHash,
  );
  return pin;
}

// POST /admin/tenants
adminRouter.post('/tenants', async (req: Request, res: Response) => {
  const {
    name, type='barbershop', timezone='Europe/Tirane',
    ownerEmail, ownerPassword, whatsappNumber='', plan='starter', billingEmail='',
    provider='twilio', metaPhoneNumberId='', metaAccessToken='', metaWabaId='',
    twilioAccountSid='', twilioAuthToken='', twilioDeptTemplateSid='',
    tenantCode='',
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
        twilio_account_sid,twilio_auth_token,twilio_dept_template_sid)
     VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?,?)`,
    tenantId, name, type, timezone, normalisedWhatsapp, plan, billingEmail,
    provider, metaPhoneNumberId||null, metaAccessToken||null, metaWabaId||null,
    twilioAccountSid||null, twilioAuthToken||null, twilioDeptTemplateSid||null,
  );
  await dbRun(
    "INSERT INTO users(id,email,password_hash,role,tenant_id,is_active) VALUES (?,?,?,'shop_owner',?,1)",
    userId, ownerEmail.toLowerCase(), hash, tenantId,
  );

  let happyTenantCode: string | null = null;
  let happyAdminPin: string | null = null;
  if (HAPPY_TYPES.includes(type)) {
    happyTenantCode = await provisionHappySettings(tenantId, type, name, tenantCode);
    happyAdminPin   = await provisionInitialHappyAdmin(tenantId);
  }

  ok(res, {
    tenant: await dbGet('SELECT * FROM tenants WHERE id=?', tenantId),
    user:   await dbGet('SELECT id,email,role,tenant_id,created_at FROM users WHERE id=?', userId),
    happyTenantCode,
    happyAdminPin,
  });
});

// POST /admin/tenants/:id/happy-bootstrap-admin
// Backfill: create the first happy_staff admin for a happy_ tenant that
// doesn't have one yet (e.g. created before this endpoint existed, or the
// PIN was lost). No-op with an error if an admin already exists.
adminRouter.post('/tenants/:id/happy-bootstrap-admin', async (req: Request, res: Response) => {
  const { id } = req.params;
  const tenant = await dbGet('SELECT id, type FROM tenants WHERE id=?', id) as any;
  if (!tenant) return err(res, 'Tenant not found', 404);
  if (!HAPPY_TYPES.includes(tenant.type)) return err(res, 'Not a happy_ tenant');
  const existingAdmin = await dbGet(`SELECT id FROM happy_staff WHERE tenant_id=? AND role='admin' AND is_active=1`, id);
  if (existingAdmin) return err(res, 'This tenant already has an active admin');
  const pin = await provisionInitialHappyAdmin(id);
  ok(res, { happyAdminPin: pin });
});

// PUT /admin/tenants/:id
adminRouter.put('/tenants/:id', async (req: Request, res: Response) => {
  const {
    name, whatsappNumber, plan, isActive, billingEmail, type, timezone, hasAnalytics,
    reviewsEnabled, surveyEnabled, menusEnabled, shopPhotosEnabled,
    provider, metaPhoneNumberId, metaAccessToken, metaWabaId,
    twilioAccountSid, twilioAuthToken, twilioDeptTemplateSid,
    notificationEmail, emailFallbackEnabled,
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
       menus_enabled        = COALESCE(?,menus_enabled),
       shop_photos_enabled  = COALESCE(?,shop_photos_enabled),
       provider             = COALESCE(?,provider),
       meta_phone_number_id = COALESCE(?,meta_phone_number_id),
       meta_access_token    = COALESCE(?,meta_access_token),
       meta_waba_id         = COALESCE(?,meta_waba_id),
       twilio_account_sid        = COALESCE(?,twilio_account_sid),
       twilio_auth_token         = COALESCE(?,twilio_auth_token),
       twilio_dept_template_sid  = COALESCE(?,twilio_dept_template_sid),
       notification_email        = COALESCE(?,notification_email),
       email_fallback_enabled    = COALESCE(?,email_fallback_enabled)
     WHERE id=?`,
    name??null, normalisedWhatsapp, plan??null,
    isActive !== undefined ? (isActive ? 1 : 0) : null,
    billingEmail??null, type??null, timezone??null,
    hasAnalytics        !== undefined ? (hasAnalytics        ? 1 : 0) : null,
    reviewsEnabled      !== undefined ? (reviewsEnabled      ? 1 : 0) : null,
    surveyEnabled       !== undefined ? (surveyEnabled       ? 1 : 0) : null,
    menusEnabled        !== undefined ? (menusEnabled        ? 1 : 0) : null,
    shopPhotosEnabled   !== undefined ? (shopPhotosEnabled   ? 1 : 0) : null,
    provider??null, metaPhoneNumberId??null, metaAccessToken??null, metaWabaId??null,
    twilioAccountSid||null, twilioAuthToken||null, twilioDeptTemplateSid||null,
    notificationEmail !== undefined ? (notificationEmail || null) : null,
    emailFallbackEnabled !== undefined ? (emailFallbackEnabled ? 1 : 0) : null,
    req.params.id,
  );

  // When photos are turned OFF, clear all photo files and DB references for this shop
  if (shopPhotosEnabled === false) {
    const photoItems = await dbAll(
      'SELECT photo_url FROM shop_menu_items WHERE tenant_id = ? AND photo_url IS NOT NULL',
      req.params.id,
    ) as any[];
    const { isR2Url, deleteFromR2 } = await import('../utils/r2.js');
    for (const item of photoItems) {
      if (isR2Url(item.photo_url)) { try { await deleteFromR2(item.photo_url); } catch { /* ignore */ } }
    }
    await dbRun(
      'UPDATE shop_menu_items SET photo_url = NULL, photo_filename = NULL WHERE tenant_id = ?',
      req.params.id,
    );
  }

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

// GET /admin/tenants/:id  — single tenant with channel settings
adminRouter.get('/tenants/:id', async (req: Request, res: Response) => {
  const tenant = await dbGet('SELECT * FROM tenants WHERE id = ?', req.params.id) as any;
  if (!tenant) return err(res, 'Tenant not found', 404);

  const whatsappConnected = !!(
    (tenant.twilio_account_sid && tenant.twilio_auth_token) ||
    (tenant.meta_phone_number_id && tenant.meta_access_token)
  );

  const channelRows = await dbAll(
    'SELECT channel, ai_enabled, connected FROM hotel_channel_settings WHERE tenant_id = ?',
    req.params.id,
  );

  // Lazily seed WhatsApp row if credentials exist but no row yet
  if (whatsappConnected && !channelRows.find((r: any) => r.channel === 'whatsapp')) {
    if (isPg) {
      await dbRun(
        `INSERT INTO hotel_channel_settings (id, tenant_id, channel, ai_enabled, connected)
         VALUES (gen_random_uuid(), ?, 'whatsapp', true, true)
         ON CONFLICT (tenant_id, channel) DO NOTHING`,
        req.params.id,
      );
    } else {
      await dbRun(
        `INSERT INTO hotel_channel_settings (id, tenant_id, channel, ai_enabled, connected)
         VALUES (?, ?, 'whatsapp', 1, 1)
         ON CONFLICT (tenant_id, channel) DO NOTHING`,
        crypto.randomUUID(), req.params.id,
      );
    }
    channelRows.push({ channel: 'whatsapp', ai_enabled: true, connected: true });
  }

  const find = (ch: string) => channelRows.find((r: any) => r.channel === ch) as any;
  const isTrue = (v: any) => v === true || v === 1;

  const channels = {
    whatsapp:  {
      connected:  whatsappConnected,
      ai_enabled: whatsappConnected ? (find('whatsapp') ? isTrue(find('whatsapp').ai_enabled) : true) : false,
    },
    instagram: {
      connected:  isTrue(find('instagram')?.connected),
      ai_enabled: isTrue(find('instagram')?.ai_enabled),
    },
    facebook:  { connected: false, ai_enabled: false },
    email:     { connected: false, ai_enabled: false },
  };

  ok(res, { ...tenant, channels });
});

// POST /admin/tenants/:tenantId/channels/instagram/connect
adminRouter.post('/tenants/:tenantId/channels/instagram/connect', async (req: Request, res: Response) => {
  const { tenantId } = req.params;
  const { access_token, instagram_account_id } = req.body as {
    access_token: string; instagram_account_id: string;
  };

  if (!access_token?.trim() || !instagram_account_id?.trim())
    return err(res, 'Access token and Instagram account ID are required');
  if (!/^\d+$/.test(instagram_account_id.trim()))
    return err(res, 'Instagram account ID must be a numeric string');

  // Check if another tenant already uses this account ID
  const conflict = await dbGet(
    'SELECT id, name FROM tenants WHERE instagram_account_id = ? AND id != ?',
    instagram_account_id.trim(), tenantId,
  ) as any;
  if (conflict)
    return err(res, `This Instagram account is already connected to ${conflict.name}`);

  if (isPg) {
    await dbRun(
      `INSERT INTO hotel_channel_settings (id, tenant_id, channel, ai_enabled, connected, access_token)
       VALUES (gen_random_uuid(), ?, 'instagram', false, true, ?)
       ON CONFLICT (tenant_id, channel) DO UPDATE SET
         connected    = true,
         access_token = excluded.access_token,
         updated_at   = NOW()`,
      tenantId, access_token.trim(),
    );
  } else {
    await dbRun(
      `INSERT INTO hotel_channel_settings (id, tenant_id, channel, ai_enabled, connected, access_token)
       VALUES (?, ?, 'instagram', 0, 1, ?)
       ON CONFLICT (tenant_id, channel) DO UPDATE SET
         connected    = 1,
         access_token = excluded.access_token,
         updated_at   = CURRENT_TIMESTAMP`,
      crypto.randomUUID(), tenantId, access_token.trim(),
    );
  }
  await dbRun(
    'UPDATE tenants SET instagram_account_id = ? WHERE id = ?',
    instagram_account_id.trim(), tenantId,
  );

  console.log(`[Admin] Instagram connected to ${tenantId} (account ${instagram_account_id.trim()})`);
  ok(res, { connected: true });
});

// DELETE /admin/tenants/:tenantId/channels/instagram/disconnect
adminRouter.delete('/tenants/:tenantId/channels/instagram/disconnect', async (req: Request, res: Response) => {
  const { tenantId } = req.params;

  if (isPg) {
    await dbRun(
      `UPDATE hotel_channel_settings
       SET connected = false, access_token = NULL, ai_enabled = false, updated_at = NOW()
       WHERE tenant_id = ? AND channel = 'instagram'`,
      tenantId,
    );
  } else {
    await dbRun(
      `UPDATE hotel_channel_settings
       SET connected = 0, access_token = NULL, ai_enabled = 0, updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND channel = 'instagram'`,
      tenantId,
    );
  }
  await dbRun('UPDATE tenants SET instagram_account_id = NULL WHERE id = ?', tenantId);

  console.log(`[Admin] Instagram disconnected from ${tenantId}`);
  ok(res, { connected: false });
});

// PUT /admin/tenants/:tenantId/channels/:channel/ai-toggle
adminRouter.put('/tenants/:tenantId/channels/:channel/ai-toggle', async (req: Request, res: Response) => {
  const { tenantId, channel } = req.params;
  const { ai_enabled } = req.body as { ai_enabled: boolean };

  const valid = ['whatsapp', 'instagram', 'facebook', 'email'];
  if (!valid.includes(channel)) return err(res, 'Invalid channel');

  console.log('[Admin] AI toggle - only updating ai_enabled, nothing else');
  await dbRun(
    `UPDATE hotel_channel_settings
     SET ai_enabled = ?, updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = ? AND channel = ?`,
    ai_enabled, tenantId, channel,
  );
  console.log(`[Admin] ${channel} AI → ${ai_enabled} for tenant ${tenantId}`);
  ok(res, { channel, ai_enabled });
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
