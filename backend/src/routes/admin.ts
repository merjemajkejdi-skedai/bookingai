import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { encrypt, decrypt } from '../utils/encryption.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

const PROTECTED_TENANT_IDS = [
  '41b10744-891e-439a-a976-3aff28c51afe', // La Favorita
  '1a7ef18c-394b-441e-8376-fc57238b7dcc', // Bloom Matcha
];

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
adminRouter.get('/tenants', async (req: Request, res: Response) => {
  const showDeleted = req.query.showDeleted === 'true';
  const deletedFilter = showDeleted ? 'WHERE t.deleted_at IS NOT NULL' : 'WHERE t.deleted_at IS NULL';
  const tenants = await dbAll(`
    SELECT t.*,
      COUNT(DISTINCT b.id) AS total_bookings,
      COUNT(DISTINCT s.id) AS specialist_count,
      u.email AS owner_email, u.last_login AS owner_last_login
    FROM tenants t
    LEFT JOIN bookings b ON b.tenant_id=t.id AND b.status != 'cancelled'
    LEFT JOIN specialists s ON s.tenant_id=t.id AND s.is_active=1
    LEFT JOIN users u ON u.tenant_id=t.id AND u.role='shop_owner'
    ${deletedFilter}
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

// GET /admin/tenants/list — lightweight list with channel connection flags
adminRouter.get('/tenants/list', async (_req: Request, res: Response) => {
  const tenants = await dbAll(`
    SELECT id, name, type,
      CASE WHEN whatsapp_number IS NOT NULL AND whatsapp_number != '' THEN 1 ELSE 0 END AS has_whatsapp,
      CASE WHEN instagram_account_id IS NOT NULL THEN 1 ELSE 0 END AS has_instagram,
      CASE WHEN messenger_page_id IS NOT NULL THEN 1 ELSE 0 END AS has_messenger
    FROM tenants
    WHERE deleted_at IS NULL
    ORDER BY name ASC
  `);
  ok(res, tenants);
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
      connected:       isTrue(find('instagram')?.connected),
      ai_enabled:      isTrue(find('instagram')?.ai_enabled),
      connection_type: tenant.instagram_connection_type || 'manual',
    },
    facebook:  {
      connected:  !!tenant.messenger_page_id,
      ai_enabled: !!tenant.messenger_page_id && (tenant.messenger_ai_enabled === true || tenant.messenger_ai_enabled === 1),
      page_name:  tenant.messenger_page_name || null,
    },
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

// POST /admin/tenants/:tenantId/channels/facebook/connect
adminRouter.post('/tenants/:tenantId/channels/facebook/connect', async (req: Request, res: Response) => {
  const { tenantId } = req.params;
  const { page_id, access_token } = req.body as {
    page_id: string; access_token: string;
  };

  if (!page_id?.trim() || !access_token?.trim())
    return err(res, 'Page ID and Page Token are required');
  if (!/^\d+$/.test(page_id.trim()))
    return err(res, 'Page ID must be numeric');

  // Verify token by calling GET /me as the Page (no extra permissions needed)
  let pageName = '';
  try {
    const verifyRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(access_token.trim())}`,
    );
    if (verifyRes.ok) {
      const pageData = await verifyRes.json() as any;
      if (pageData.id && pageData.id !== page_id.trim()) {
        return err(res, `Token belongs to page ${pageData.id}, not ${page_id.trim()}`);
      }
      pageName = pageData.name || '';
    } else {
      const body = await verifyRes.json().catch(() => ({})) as any;
      console.warn(`[Admin] Messenger token verify failed (non-blocking):`, body?.error?.message || verifyRes.status);
    }
  } catch (e: any) {
    console.warn(`[Admin] Messenger token verify error (non-blocking):`, e.message);
  }

  const conflict = await dbGet(
    'SELECT id, name FROM tenants WHERE messenger_page_id = ? AND id != ?',
    page_id.trim(), tenantId,
  ) as any;
  if (conflict)
    return err(res, `This Facebook page is already connected to ${conflict.name}`);

  const encryptedToken = encrypt(access_token.trim());
  await dbRun(
    `UPDATE tenants
     SET messenger_page_id = ?,
         messenger_page_name = ?,
         messenger_access_token_encrypted = ?,
         messenger_connected_at = CURRENT_TIMESTAMP,
         messenger_ai_enabled = true
     WHERE id = ?`,
    page_id.trim(), pageName, encryptedToken, tenantId,
  );

  console.log(`[Admin] Messenger connected to ${tenantId} (page ${page_id.trim()} — ${pageName})`);
  ok(res, { connected: true, page_name: pageName });
});

// DELETE /admin/tenants/:tenantId/channels/facebook/disconnect
adminRouter.delete('/tenants/:tenantId/channels/facebook/disconnect', async (req: Request, res: Response) => {
  const { tenantId } = req.params;

  await dbRun(
    `UPDATE tenants
     SET messenger_page_id = NULL,
         messenger_page_name = NULL,
         messenger_access_token_encrypted = NULL,
         messenger_connected_at = NULL,
         messenger_ai_enabled = false
     WHERE id = ?`,
    tenantId,
  );

  console.log(`[Admin] Messenger disconnected from ${tenantId}`);
  ok(res, { connected: false });
});

// PUT /admin/tenants/:tenantId/channels/:channel/ai-toggle
adminRouter.put('/tenants/:tenantId/channels/:channel/ai-toggle', async (req: Request, res: Response) => {
  const { tenantId, channel } = req.params;
  const { ai_enabled } = req.body as { ai_enabled: boolean };

  const valid = ['whatsapp', 'instagram', 'facebook', 'email'];
  if (!valid.includes(channel)) return err(res, 'Invalid channel');

  console.log('[Admin] AI toggle - only updating ai_enabled, nothing else');

  if (channel === 'facebook') {
    await dbRun(
      `UPDATE tenants SET messenger_ai_enabled = ? WHERE id = ?`,
      ai_enabled, tenantId,
    );
  } else {
    await dbRun(
      `UPDATE hotel_channel_settings
       SET ai_enabled = ?, updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND channel = ?`,
      ai_enabled, tenantId, channel,
    );
  }
  console.log(`[Admin] ${channel} AI → ${ai_enabled} for tenant ${tenantId}`);
  ok(res, { channel, ai_enabled });
});

// GET /admin/stats
adminRouter.get('/stats', async (_req: Request, res: Response) => {
  const [t, b, bt, u] = await Promise.all([
    dbGet('SELECT COUNT(*) AS c FROM tenants WHERE is_active=1 AND deleted_at IS NULL'),
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

// DELETE /admin/tenants/:id — soft delete with R2 cleanup
adminRouter.delete('/tenants/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { confirmName } = req.body as { confirmName?: string };

  if (PROTECTED_TENANT_IDS.includes(id)) {
    console.log(`[Admin] BLOCKED delete attempt on protected tenant ${id}`);
    return err(res, 'This tenant is protected and cannot be deleted', 403);
  }

  const tenant = await dbGet('SELECT id, name FROM tenants WHERE id = ? AND deleted_at IS NULL', id) as any;
  if (!tenant) return err(res, 'Tenant not found', 404);

  if (!confirmName || confirmName !== tenant.name) {
    return err(res, 'Tenant name does not match');
  }

  // Delete R2 files (non-blocking — log errors but proceed)
  let deletedFiles = 0;
  try {
    const { deleteTenantR2Files } = await import('../utils/r2.js');
    deletedFiles = await deleteTenantR2Files(id);
  } catch (e: any) {
    console.error(`[Admin] R2 cleanup error for tenant ${id}:`, e.message);
  }

  const adminEmail = (req.user as any)?.email || 'unknown';
  await dbRun(
    `UPDATE tenants SET deleted_at = ${isPg ? 'NOW()' : 'CURRENT_TIMESTAMP'}, deleted_by = ? WHERE id = ? AND deleted_at IS NULL`,
    adminEmail, id,
  );

  console.log(`[Admin] Tenant ${tenant.name} (${id}) soft-deleted by ${adminEmail}. R2 files deleted: ${deletedFiles}`);
  ok(res, { deletedFiles });
});

// POST /admin/leads/:leadType/:leadId/assign — assign lead to existing tenant
adminRouter.post('/leads/:leadType/:leadId/assign', async (req: Request, res: Response) => {
  const { leadType, leadId } = req.params;
  const { tenantId } = req.body as { tenantId?: string };

  if (!tenantId) return err(res, 'tenantId is required');
  if (!['whatsapp', 'instagram', 'messenger'].includes(leadType))
    return err(res, "leadType must be 'whatsapp', 'instagram', or 'messenger'");

  const tableMap: Record<string, string> = {
    whatsapp: 'whatsapp_signup_leads',
    instagram: 'instagram_signup_leads',
    messenger: 'messenger_signup_leads',
  };
  const table = tableMap[leadType];

  const lead = await dbGet(`SELECT * FROM ${table} WHERE id = ?`, leadId) as any;
  if (!lead) return err(res, 'Lead not found', 404);
  if (lead.status === 'tenant_created' || lead.status === 'assigned')
    return err(res, `Lead already ${lead.status}`);

  const tenant = await dbGet('SELECT id, name FROM tenants WHERE id = ? AND deleted_at IS NULL', tenantId) as any;
  if (!tenant) return err(res, 'Tenant not found', 404);

  const adminEmail = (req.user as any)?.email || 'unknown';

  try {
    if (leadType === 'whatsapp') {
      const phoneRaw = (lead.phone_number || '').replace(/[\s\-()]/g, '').trim();
      const phone = phoneRaw.startsWith('whatsapp:') ? phoneRaw : `whatsapp:${phoneRaw}`;
      await dbRun(
        `UPDATE tenants SET
           provider = 'meta',
           meta_waba_id = ?,
           whatsapp_number = ?,
           whatsapp_connected_at = ${isPg ? 'NOW()' : 'CURRENT_TIMESTAMP'}
         WHERE id = ?`,
        lead.waba_id, phone, tenantId,
      );
    } else if (leadType === 'instagram') {
      const accessToken = lead.access_token_encrypted ? decrypt(lead.access_token_encrypted) : '';
      await dbRun(
        `UPDATE tenants SET
           instagram_account_id = ?,
           instagram_oauth_token_encrypted = ?,
           instagram_oauth_expires_at = ${isPg ? "NOW() + INTERVAL '60 days'" : "datetime('now', '+60 days')"},
           instagram_connection_type = 'oauth'
         WHERE id = ?`,
        lead.instagram_account_id, lead.access_token_encrypted, tenantId,
      );
      if (accessToken) {
        if (isPg) {
          await dbRun(
            `INSERT INTO hotel_channel_settings (id, tenant_id, channel, ai_enabled, connected, access_token)
             VALUES (gen_random_uuid(), ?, 'instagram', false, true, ?)
             ON CONFLICT (tenant_id, channel) DO UPDATE SET
               connected = true, access_token = excluded.access_token, updated_at = NOW()`,
            tenantId, accessToken,
          );
        } else {
          await dbRun(
            `INSERT INTO hotel_channel_settings (id, tenant_id, channel, ai_enabled, connected, access_token)
             VALUES (?, ?, 'instagram', 0, 1, ?)
             ON CONFLICT (tenant_id, channel) DO UPDATE SET
               connected = 1, access_token = excluded.access_token, updated_at = CURRENT_TIMESTAMP`,
            crypto.randomUUID(), tenantId, accessToken,
          );
        }
      }
    } else if (leadType === 'messenger') {
      const pageToken = lead.access_token_encrypted ? decrypt(lead.access_token_encrypted) : '';
      await dbRun(
        `UPDATE tenants SET
           messenger_page_id = ?,
           messenger_page_name = ?,
           messenger_access_token_encrypted = ?,
           messenger_connected_at = ${isPg ? 'NOW()' : 'CURRENT_TIMESTAMP'},
           messenger_connection_type = 'oauth'
         WHERE id = ?`,
        lead.facebook_page_id, lead.facebook_page_name, lead.access_token_encrypted, tenantId,
      );
      if (pageToken) {
        if (isPg) {
          await dbRun(
            `INSERT INTO hotel_channel_settings (id, tenant_id, channel, ai_enabled, connected, access_token)
             VALUES (gen_random_uuid(), ?, 'facebook', false, true, ?)
             ON CONFLICT (tenant_id, channel) DO UPDATE SET
               connected = true, access_token = excluded.access_token, updated_at = NOW()`,
            tenantId, pageToken,
          );
        } else {
          await dbRun(
            `INSERT INTO hotel_channel_settings (id, tenant_id, channel, ai_enabled, connected, access_token)
             VALUES (?, ?, 'facebook', 0, 1, ?)
             ON CONFLICT (tenant_id, channel) DO UPDATE SET
               connected = 1, access_token = excluded.access_token, updated_at = CURRENT_TIMESTAMP`,
            crypto.randomUUID(), tenantId, pageToken,
          );
        }
        try {
          const { subscribePageToWebhook } = await import('./messengerSignup.js');
          await subscribePageToWebhook(lead.facebook_page_id, pageToken);
        } catch (e: any) {
          console.warn('[Admin] Messenger webhook subscription during assign failed:', e.message);
        }
      }
    }

    // Update lead status
    await dbRun(
      `UPDATE ${table} SET status = 'assigned', tenant_id = ?, assigned_at = ${isPg ? 'NOW()' : 'CURRENT_TIMESTAMP'}, updated_at = ${isPg ? 'NOW()' : 'CURRENT_TIMESTAMP'} WHERE id = ?`,
      tenantId, leadId,
    );

    console.log(`[Admin] Lead ${leadId} (${leadType}) assigned to tenant ${tenant.name} by ${adminEmail}`);
    ok(res, { tenantName: tenant.name });
  } catch (e: any) {
    console.error(`[Admin] Lead assign error:`, e.message);
    err(res, e.message, 500);
  }
});
