import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { encrypt } from '../utils/encryption.js';
import { notifyNewInstagramLead } from '../skedai/notify.js';

export const instagramSignupRouter = Router();

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, code = 400) =>
  res.status(code).json({ success: false, error: msg });

const META_APP_ID     = () => process.env.META_APP_ID || '1507114490265475';
const META_APP_SECRET = () => process.env.META_APP_SECRET!;

// ---------------------------------------------------------------------------
// POST /api/instagram/oauth/callback
// Receives the auth code from FB.login() on landing page or tenant settings.
// ---------------------------------------------------------------------------
instagramSignupRouter.post('/instagram/oauth/callback', async (req: Request, res: Response) => {
  const { code, source, tenantId, redirect_uri } = req.body as {
    code: string;
    source: 'landing' | 'tenant_settings';
    tenantId?: string;
    redirect_uri?: string;
  };

  if (!code) return err(res, 'code is required');
  if (!source || !['landing', 'tenant_settings'].includes(source))
    return err(res, "source must be 'landing' or 'tenant_settings'");
  if (source === 'tenant_settings' && !tenantId)
    return err(res, 'tenantId is required for tenant_settings source');

  const appSecret = META_APP_SECRET();
  if (!appSecret) return err(res, 'META_APP_SECRET not configured', 500);

  try {
    // 1. Exchange code for short-lived user token
    const redirectUri = 'https://www.skedai.net/';
    console.log('[Instagram] Token exchange redirect_uri:', redirectUri);

    const tokenRes = await fetch('https://graph.facebook.com/v21.0/oauth/access_token?' + new URLSearchParams({
      client_id:     META_APP_ID(),
      client_secret: appSecret,
      code,
      redirect_uri:  redirectUri,
    }));
    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error('[Instagram OAuth] Token exchange failed:', errBody);
      return err(res, 'Token exchange failed — please try again', 502);
    }
    const tokenData = await tokenRes.json() as any;
    const shortToken = tokenData.access_token;
    console.log('[Instagram OAuth] Short-lived token obtained');

    // 2. Exchange for long-lived token (60 days)
    const longRes = await fetch('https://graph.facebook.com/v21.0/oauth/access_token?' + new URLSearchParams({
      grant_type:        'fb_exchange_token',
      client_id:         META_APP_ID(),
      client_secret:     appSecret,
      fb_exchange_token: shortToken,
    }));
    let accessToken = shortToken;
    if (longRes.ok) {
      const longData = await longRes.json() as any;
      accessToken = longData.access_token;
      console.log('[Instagram OAuth] Long-lived token obtained');
    } else {
      console.warn('[Instagram OAuth] Long-lived token exchange failed, using short-lived');
    }

    // 3. Get user's Pages and find the one with an Instagram Business Account
    console.log('[Instagram OAuth] Fetching user Pages...');
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=instagram_business_account,name&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!pagesRes.ok) {
      const pagesErr = await pagesRes.text();
      console.error('[Instagram OAuth] Pages fetch failed:', pagesErr);
      return err(res, 'Could not retrieve your Facebook Pages — make sure you granted pages_show_list permission');
    }
    const pagesData = await pagesRes.json() as any;
    const pages = (pagesData.data ?? []) as any[];

    let instagramAccountId: string | undefined;
    let facebookPageName: string | undefined;
    for (const page of pages) {
      if (page.instagram_business_account?.id) {
        instagramAccountId = page.instagram_business_account.id;
        facebookPageName = page.name;
        break;
      }
    }

    if (!instagramAccountId) {
      console.error('[Instagram OAuth] No Instagram Business Account found on any Page');
      return err(res, 'No Instagram Business Account found — make sure your Instagram is set to Business or Creator and linked to a Facebook Page');
    }
    console.log(`[Instagram OAuth] Found IG account ${instagramAccountId} on page "${facebookPageName}"`);

    // 4. Get Instagram username
    let instagramUsername = '';
    try {
      const igRes = await fetch(
        `https://graph.facebook.com/v21.0/${instagramAccountId}?fields=username,name&access_token=${encodeURIComponent(accessToken)}`,
      );
      if (igRes.ok) {
        const igData = await igRes.json() as any;
        instagramUsername = igData.username || '';
        console.log(`[Instagram OAuth] Instagram username: @${instagramUsername}`);
      }
    } catch (e: any) {
      console.warn('[Instagram OAuth] Username fetch failed:', e.message);
    }

    // 5. Route based on source
    if (source === 'landing') {
      const leadId = crypto.randomUUID();
      const encryptedToken = encrypt(accessToken);
      await dbRun(
        `INSERT INTO instagram_signup_leads
           (id, instagram_account_id, instagram_username, facebook_page_name, access_token_encrypted, status, created_at, updated_at)
         VALUES (?,?,?,?,?,'pending',${isPg ? 'NOW(),NOW()' : "CURRENT_TIMESTAMP,CURRENT_TIMESTAMP"})`,
        leadId, instagramAccountId, instagramUsername || null, facebookPageName || null, encryptedToken,
      );
      console.log(`[Instagram OAuth] Lead created: ${leadId}`);

      notifyNewInstagramLead({
        username: instagramUsername || 'unknown',
        pageName: facebookPageName || 'Unknown',
      }).catch(e => console.error('[Instagram OAuth] Alert failed:', e.message));

      ok(res, { message: 'pending_review', leadId });
    } else {
      // tenant_settings — save directly to tenant
      const tenant = await dbGet('SELECT * FROM tenants WHERE id = ?', tenantId);
      if (!tenant) return err(res, 'Tenant not found', 404);

      const encryptedToken = encrypt(accessToken);

      // Update tenants.instagram_account_id
      await dbRun(
        `UPDATE tenants SET
           instagram_account_id = ?,
           instagram_oauth_token_encrypted = ?,
           instagram_oauth_expires_at = ${isPg ? "NOW() + INTERVAL '60 days'" : "datetime('now', '+60 days')"},
           instagram_connection_type = 'oauth'
         WHERE id = ?`,
        instagramAccountId, encryptedToken, tenantId,
      );

      // Upsert hotel_channel_settings with the access token
      if (isPg) {
        await dbRun(
          `INSERT INTO hotel_channel_settings (id, tenant_id, channel, ai_enabled, connected, access_token)
           VALUES (gen_random_uuid(), ?, 'instagram', false, true, ?)
           ON CONFLICT (tenant_id, channel) DO UPDATE SET
             connected    = true,
             access_token = excluded.access_token,
             updated_at   = NOW()`,
          tenantId, accessToken,
        );
      } else {
        await dbRun(
          `INSERT INTO hotel_channel_settings (id, tenant_id, channel, ai_enabled, connected, access_token)
           VALUES (?, ?, 'instagram', 0, 1, ?)
           ON CONFLICT (tenant_id, channel) DO UPDATE SET
             connected    = 1,
             access_token = excluded.access_token,
             updated_at   = CURRENT_TIMESTAMP`,
          crypto.randomUUID(), tenantId, accessToken,
        );
      }

      console.log(`[Instagram OAuth] Tenant ${tenantId} connected to IG ${instagramAccountId} (@${instagramUsername})`);
      ok(res, { message: 'connected', username: instagramUsername, instagram_account_id: instagramAccountId });
    }
  } catch (e: any) {
    console.error('[Instagram OAuth] Error:', e.message, e.stack);
    err(res, 'Failed to process Instagram connection', 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/instagram/signup-leads — admin list
// ---------------------------------------------------------------------------
instagramSignupRouter.get('/instagram/signup-leads', async (_req: Request, res: Response) => {
  try {
    const rows = await dbAll(
      `SELECT id, instagram_account_id, instagram_username, facebook_page_name, status, notes, tenant_id, created_at, updated_at
       FROM instagram_signup_leads ORDER BY created_at DESC`,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// PATCH /api/instagram/signup-leads/:id — update lead status / notes
// ---------------------------------------------------------------------------
instagramSignupRouter.patch('/instagram/signup-leads/:id', async (req: Request, res: Response) => {
  const { status, notes, tenant_id } = req.body;
  const sets: string[] = [];
  const params: any[] = [];

  if (status) {
    if (!['pending', 'contacted', 'tenant_created', 'rejected', 'assigned'].includes(status))
      return err(res, "status must be 'pending', 'contacted', 'tenant_created', 'rejected', or 'assigned'");
    sets.push('status = ?');
    params.push(status);
  }
  if (notes !== undefined) { sets.push('notes = ?'); params.push(notes); }
  if (tenant_id !== undefined) { sets.push('tenant_id = ?'); params.push(tenant_id); }

  if (!sets.length) return err(res, 'Nothing to update');

  sets.push(isPg ? 'updated_at = NOW()' : 'updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id);

  try {
    await dbRun(`UPDATE instagram_signup_leads SET ${sets.join(', ')} WHERE id = ?`, ...params);
    const row = await dbGet('SELECT * FROM instagram_signup_leads WHERE id = ?', req.params.id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// POST /api/instagram/oauth/disconnect — tenant disconnects Instagram OAuth
// ---------------------------------------------------------------------------
instagramSignupRouter.post('/instagram/oauth/disconnect', async (req: Request, res: Response) => {
  const { tenantId } = req.body as { tenantId: string };
  if (!tenantId) return err(res, 'tenantId is required');

  try {
    await dbRun(
      `UPDATE tenants SET
         instagram_account_id = NULL,
         instagram_oauth_token_encrypted = NULL,
         instagram_oauth_expires_at = NULL,
         instagram_connection_type = NULL
       WHERE id = ?`,
      tenantId,
    );

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

    console.log(`[Instagram OAuth] Tenant ${tenantId} disconnected`);
    ok(res, { disconnected: true });
  } catch (e: any) { err(res, e.message, 500); }
});
