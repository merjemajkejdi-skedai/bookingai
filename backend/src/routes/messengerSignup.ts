import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { encrypt } from '../utils/encryption.js';
import { notifyNewMessengerLead } from '../skedai/notify.js';

export const messengerSignupRouter = Router();

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, code = 400) =>
  res.status(code).json({ success: false, error: msg });

const META_APP_ID     = () => process.env.META_APP_ID || '1507114490265475';
const META_APP_SECRET = () => process.env.META_APP_SECRET!;

// ---------------------------------------------------------------------------
// GET /api/messenger/config — public, returns Messenger Login config_id
// ---------------------------------------------------------------------------
messengerSignupRouter.get('/messenger/config', (_req: Request, res: Response) => {
  const configId = process.env.META_MESSENGER_CONFIG_ID || '';
  if (!configId || configId.includes('PLACEHOLDER')) {
    return err(res, 'Messenger config_id not configured — set META_MESSENGER_CONFIG_ID env var', 503);
  }
  ok(res, { config_id: configId });
});

// ---------------------------------------------------------------------------
// POST /api/messenger/oauth/callback
// Receives the auth code from FB.login() on landing page or admin settings.
// ---------------------------------------------------------------------------
messengerSignupRouter.post('/messenger/oauth/callback', async (req: Request, res: Response) => {
  const { code, source, tenantId, redirect_uri } = req.body as {
    code: string;
    source: 'landing' | 'admin';
    tenantId?: string;
    redirect_uri?: string;
  };

  if (!code) return err(res, 'code is required');
  if (!source || !['landing', 'admin'].includes(source))
    return err(res, "source must be 'landing' or 'admin'");
  if (source === 'admin' && !tenantId)
    return err(res, 'tenantId is required for admin source');

  const appSecret = META_APP_SECRET();
  if (!appSecret) return err(res, 'META_APP_SECRET not configured', 500);

  try {
    // 1. Exchange code for short-lived user token
    console.log('[Messenger OAuth] callback received, code present:', !!code, 'source:', source, 'tenantId:', tenantId);
    const redirectUri = 'https://www.skedai.net/messenger/oauth/callback';
    console.log('[Messenger] Token exchange redirect_uri:', redirectUri);

    const tokenRes = await fetch('https://graph.facebook.com/v21.0/oauth/access_token?' + new URLSearchParams({
      client_id:     META_APP_ID(),
      client_secret: appSecret,
      code,
      redirect_uri:  redirectUri,
    }));
    console.log('[Messenger OAuth] Token exchange response status:', tokenRes.status);
    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error('[Messenger OAuth] Token exchange failed:', errBody);
      return err(res, 'Token exchange failed — please try again', 502);
    }
    const tokenData = await tokenRes.json() as any;
    const shortToken = tokenData.access_token;
    console.log('[Messenger OAuth] Short-lived token obtained, has access_token:', !!shortToken);

    // 2. Exchange for long-lived token (60 days)
    const longRes = await fetch('https://graph.facebook.com/v21.0/oauth/access_token?' + new URLSearchParams({
      grant_type:        'fb_exchange_token',
      client_id:         META_APP_ID(),
      client_secret:     appSecret,
      fb_exchange_token: shortToken,
    }));
    let longToken = shortToken;
    console.log('[Messenger OAuth] Long-lived exchange status:', longRes.status);
    if (longRes.ok) {
      const longData = await longRes.json() as any;
      longToken = longData.access_token;
      console.log('[Messenger OAuth] Long-lived token obtained');
    } else {
      const longErr = await longRes.text();
      console.warn('[Messenger OAuth] Long-lived token exchange failed:', longErr, '— using short-lived');
    }

    // 3. Get user's Pages with page-level access tokens
    console.log('[Messenger OAuth] Fetching user Pages...');
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(longToken)}`,
    );
    if (!pagesRes.ok) {
      const pagesErr = await pagesRes.text();
      console.error('[Messenger OAuth] Pages fetch failed:', pagesErr);
      return err(res, 'Could not retrieve your Facebook Pages — make sure you granted pages_manage_metadata permission');
    }
    const pagesData = await pagesRes.json() as any;
    const pages = (pagesData.data ?? []) as any[];

    if (pages.length === 0) {
      console.error('[Messenger OAuth] No Pages found for this user');
      return err(res, 'No Facebook Pages found — you need at least one Page to connect Messenger');
    }

    // 4. If multiple pages, return list for frontend selection
    if (pages.length > 1) {
      console.log(`[Messenger OAuth] ${pages.length} Pages found, returning list for selection`);
      return ok(res, {
        pages: pages.map((p: any) => ({ id: p.id, name: p.name })),
        longToken: encrypt(longToken),
      });
    }

    // 5. Single page — auto-select
    const selectedPage = pages[0];
    const pageToken = selectedPage.access_token;
    console.log(`[Messenger OAuth] Auto-selected page "${selectedPage.name}" (${selectedPage.id})`);

    // 6. Subscribe page to Messenger webhook
    await subscribePageToWebhook(selectedPage.id, pageToken);

    // 7. Save based on source
    if (source === 'landing') {
      const result = await saveLandingLead(selectedPage, pageToken);
      return ok(res, result);
    } else {
      const result = await saveAdminConnection(tenantId!, selectedPage, pageToken);
      return ok(res, result);
    }
  } catch (e: any) {
    console.error('[Messenger OAuth] Error:', e.message, e.stack);
    err(res, 'Failed to process Messenger connection', 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/messenger/oauth/select-page
// User picked a specific page from the multi-page list.
// ---------------------------------------------------------------------------
messengerSignupRouter.post('/messenger/oauth/select-page', async (req: Request, res: Response) => {
  const { pageId, encryptedToken, source, tenantId } = req.body as {
    pageId: string;
    encryptedToken: string;
    source: 'landing' | 'admin';
    tenantId?: string;
  };

  if (!pageId) return err(res, 'pageId is required');
  if (!encryptedToken) return err(res, 'encryptedToken is required');
  if (!source || !['landing', 'admin'].includes(source))
    return err(res, "source must be 'landing' or 'admin'");
  if (source === 'admin' && !tenantId)
    return err(res, 'tenantId is required for admin source');

  try {
    // 1. Decrypt the long-lived user token
    const { decrypt } = await import('../utils/encryption.js');
    const longToken = decrypt(encryptedToken);

    // 2. Get pages again with page-level access tokens
    console.log('[Messenger OAuth] Fetching Pages for page selection...');
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(longToken)}`,
    );
    if (!pagesRes.ok) {
      const pagesErr = await pagesRes.text();
      console.error('[Messenger OAuth] Pages re-fetch failed:', pagesErr);
      return err(res, 'Could not retrieve Facebook Pages — token may have expired, please try again');
    }
    const pagesData = await pagesRes.json() as any;
    const pages = (pagesData.data ?? []) as any[];

    // 3. Find the selected page
    const selectedPage = pages.find((p: any) => p.id === pageId);
    if (!selectedPage) {
      return err(res, 'Selected page not found — make sure you have admin access to this Page');
    }
    const pageToken = selectedPage.access_token;
    console.log(`[Messenger OAuth] Selected page "${selectedPage.name}" (${selectedPage.id})`);

    // 4. Subscribe page to Messenger webhook
    await subscribePageToWebhook(selectedPage.id, pageToken);

    // 5. Save based on source
    if (source === 'landing') {
      const result = await saveLandingLead(selectedPage, pageToken);
      return ok(res, result);
    } else {
      const result = await saveAdminConnection(tenantId!, selectedPage, pageToken);
      return ok(res, result);
    }
  } catch (e: any) {
    console.error('[Messenger OAuth] Select-page error:', e.message, e.stack);
    err(res, 'Failed to process page selection', 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/messenger/signup-leads — admin list
// ---------------------------------------------------------------------------
messengerSignupRouter.get('/messenger/signup-leads', async (_req: Request, res: Response) => {
  try {
    const rows = await dbAll(
      `SELECT id, facebook_page_id, facebook_page_name, status, notes, tenant_id, created_at, updated_at
       FROM messenger_signup_leads ORDER BY created_at DESC`,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// PATCH /api/messenger/signup-leads/:id — update lead status / notes
// ---------------------------------------------------------------------------
messengerSignupRouter.patch('/messenger/signup-leads/:id', async (req: Request, res: Response) => {
  const { status, notes, tenant_id } = req.body;
  const sets: string[] = [];
  const params: any[] = [];

  if (status) {
    if (!['pending', 'contacted', 'tenant_created', 'rejected'].includes(status))
      return err(res, "status must be 'pending', 'contacted', 'tenant_created', or 'rejected'");
    sets.push('status = ?');
    params.push(status);
  }
  if (notes !== undefined) { sets.push('notes = ?'); params.push(notes); }
  if (tenant_id !== undefined) { sets.push('tenant_id = ?'); params.push(tenant_id); }

  if (!sets.length) return err(res, 'Nothing to update');

  sets.push(isPg ? 'updated_at = NOW()' : 'updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id);

  try {
    await dbRun(`UPDATE messenger_signup_leads SET ${sets.join(', ')} WHERE id = ?`, ...params);
    const row = await dbGet('SELECT * FROM messenger_signup_leads WHERE id = ?', req.params.id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function subscribePageToWebhook(pageId: string, pageToken: string): Promise<void> {
  console.log(`[Messenger OAuth] Subscribing page ${pageId} to webhook...`);
  const subRes = await fetch(
    `https://graph.facebook.com/v21.0/${pageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks&access_token=${encodeURIComponent(pageToken)}`,
    { method: 'POST' },
  );
  if (!subRes.ok) {
    const subErr = await subRes.text();
    console.error('[Messenger OAuth] Webhook subscription failed:', subErr);
    // Non-fatal — the page is still connected, webhook can be set up later
  } else {
    console.log(`[Messenger OAuth] Webhook subscription successful for page ${pageId}`);
  }
}

async function saveLandingLead(
  page: { id: string; name: string },
  pageToken: string,
): Promise<{ message: string; pageName: string }> {
  const leadId = crypto.randomUUID();
  const encryptedToken = encrypt(pageToken);
  await dbRun(
    `INSERT INTO messenger_signup_leads
       (id, facebook_page_id, facebook_page_name, access_token_encrypted, status, created_at, updated_at)
     VALUES (?,?,?,?,'pending',${isPg ? 'NOW(),NOW()' : "CURRENT_TIMESTAMP,CURRENT_TIMESTAMP"})`,
    leadId, page.id, page.name || null, encryptedToken,
  );
  console.log(`[Messenger OAuth] Lead created: ${leadId}`);

  notifyNewMessengerLead({
    pageName: page.name || 'Unknown',
    pageId: page.id,
  }).catch(e => console.error('[Messenger OAuth] Alert failed:', e.message));

  return { message: 'pending_review', pageName: page.name };
}

async function saveAdminConnection(
  tenantId: string,
  page: { id: string; name: string; access_token: string },
  pageToken: string,
): Promise<{ message: string; pageName: string }> {
  const tenant = await dbGet('SELECT * FROM tenants WHERE id = ?', tenantId);
  if (!tenant) throw new Error('Tenant not found');

  const encryptedToken = encrypt(pageToken);

  // Update tenants with messenger fields
  await dbRun(
    `UPDATE tenants SET
       messenger_page_id = ?,
       messenger_page_name = ?,
       messenger_access_token_encrypted = ?,
       messenger_oauth_token_encrypted = ?,
       messenger_oauth_expires_at = ${isPg ? "NOW() + INTERVAL '60 days'" : "datetime('now', '+60 days')"},
       messenger_connected_at = ${isPg ? 'NOW()' : 'CURRENT_TIMESTAMP'},
       messenger_connection_type = 'oauth'
     WHERE id = ?`,
    page.id, page.name, encryptedToken, encryptedToken, tenantId,
  );

  // Upsert hotel_channel_settings for facebook channel
  if (isPg) {
    await dbRun(
      `INSERT INTO hotel_channel_settings (id, tenant_id, channel, ai_enabled, connected, access_token)
       VALUES (gen_random_uuid(), ?, 'facebook', false, true, ?)
       ON CONFLICT (tenant_id, channel) DO UPDATE SET
         connected    = true,
         access_token = excluded.access_token,
         updated_at   = NOW()`,
      tenantId, pageToken,
    );
  } else {
    await dbRun(
      `INSERT INTO hotel_channel_settings (id, tenant_id, channel, ai_enabled, connected, access_token)
       VALUES (?, ?, 'facebook', 0, 1, ?)
       ON CONFLICT (tenant_id, channel) DO UPDATE SET
         connected    = 1,
         access_token = excluded.access_token,
         updated_at   = CURRENT_TIMESTAMP`,
      crypto.randomUUID(), tenantId, pageToken,
    );
  }

  console.log(`[Messenger OAuth] Tenant ${tenantId} connected to Messenger page "${page.name}" (${page.id})`);
  return { message: 'connected', pageName: page.name };
}
