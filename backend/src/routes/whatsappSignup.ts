import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { encrypt } from '../utils/encryption.js';
import { notifyNewWhatsAppLead } from '../skedai/notify.js';

export const whatsappSignupRouter = Router();

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, code = 400) =>
  res.status(code).json({ success: false, error: msg });

function normaliseWhatsapp(raw: string | undefined | null): string {
  if (!raw) return '';
  const cleaned = raw.replace(/[\s\-()]/g, '').trim();
  return cleaned.startsWith('whatsapp:') ? cleaned : `whatsapp:${cleaned}`;
}

const META_APP_ID     = () => process.env.META_APP_ID || '1507114490265475';
const META_APP_SECRET = () => process.env.META_APP_SECRET!;

// ---------------------------------------------------------------------------
// POST /api/whatsapp/embedded-signup/callback
// Receives the auth code from the frontend Embedded Signup popup.
// ---------------------------------------------------------------------------
whatsappSignupRouter.post('/whatsapp/embedded-signup/callback', async (req: Request, res: Response) => {
  const { code, source, tenantId } = req.body as {
    code: string;
    source: 'landing' | 'tenant_settings';
    tenantId?: string;
  };

  if (!code) return err(res, 'code is required');
  if (!source || !['landing', 'tenant_settings'].includes(source)) return err(res, "source must be 'landing' or 'tenant_settings'");
  if (source === 'tenant_settings' && !tenantId) return err(res, 'tenantId is required for tenant_settings source');

  const appSecret = META_APP_SECRET();
  if (!appSecret) return err(res, 'META_APP_SECRET not configured', 500);

  try {
    // 1. Exchange code for short-lived user token
    console.log('[WhatsApp Signup] Exchanging code for token...');
    const tokenRes = await fetch('https://graph.facebook.com/v21.0/oauth/access_token?' + new URLSearchParams({
      client_id:     META_APP_ID(),
      client_secret: appSecret,
      code,
      redirect_uri:  process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI || 'https://app.skedai.net/onboarding/whatsapp/callback',
    }));
    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error('[WhatsApp Signup] Token exchange failed:', errBody);
      return err(res, 'Token exchange failed', 502);
    }
    const tokenData = await tokenRes.json() as any;
    const shortToken = tokenData.access_token;
    console.log('[WhatsApp Signup] Short-lived token obtained');

    // 2. Exchange for long-lived token
    const longRes = await fetch('https://graph.facebook.com/v21.0/oauth/access_token?' + new URLSearchParams({
      grant_type:       'fb_exchange_token',
      client_id:        META_APP_ID(),
      client_secret:    appSecret,
      fb_exchange_token: shortToken,
    }));
    let accessToken = shortToken;
    if (longRes.ok) {
      const longData = await longRes.json() as any;
      accessToken = longData.access_token;
      console.log('[WhatsApp Signup] Long-lived token obtained');
    } else {
      console.warn('[WhatsApp Signup] Long-lived token exchange failed, using short-lived');
    }

    // 3. Debug token to extract WABA ID and permissions
    const debugRes = await fetch(`https://graph.facebook.com/v21.0/debug_token?` + new URLSearchParams({
      input_token:  accessToken,
      access_token: `${META_APP_ID()}|${appSecret}`,
    }));
    const debugData = await debugRes.json() as any;
    const granularScopes = debugData?.data?.granular_scopes ?? [];
    const facebookUserId = debugData?.data?.user_id;
    console.log('[WhatsApp Signup] Debug token scopes:', JSON.stringify(granularScopes));

    // Extract WABA IDs from whatsapp_business_management scope
    let wabaId: string | undefined;
    for (const scope of granularScopes) {
      if (scope.permission === 'whatsapp_business_management' && scope.target_ids?.length) {
        wabaId = scope.target_ids[0];
        break;
      }
    }

    if (!wabaId) {
      console.error('[WhatsApp Signup] No WABA ID found in token scopes');
      return err(res, 'No WhatsApp Business Account was granted — please try again and select a business account');
    }
    console.log(`[WhatsApp Signup] WABA ID: ${wabaId}`);

    // 4. Get phone numbers from WABA
    let phoneNumber: string | undefined;
    let phoneNumberId: string | undefined;
    let businessName: string | undefined;
    try {
      const wabaRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}?fields=name,phone_numbers`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (wabaRes.ok) {
        const wabaData = await wabaRes.json() as any;
        businessName = wabaData.name;
        if (wabaData.phone_numbers?.data?.length) {
          const phone = wabaData.phone_numbers.data[0];
          phoneNumber = phone.display_phone_number;
          phoneNumberId = phone.id;
        }
      }
    } catch (e: any) {
      console.warn('[WhatsApp Signup] Failed to fetch WABA details:', e.message);
    }

    // If no phone numbers from WABA directly, try phone_numbers endpoint
    if (!phoneNumber) {
      try {
        const phoneRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/phone_numbers?fields=display_phone_number,verified_name`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (phoneRes.ok) {
          const phoneData = await phoneRes.json() as any;
          if (phoneData.data?.length) {
            phoneNumber = phoneData.data[0].display_phone_number;
            phoneNumberId = phoneData.data[0].id;
            if (!businessName) businessName = phoneData.data[0].verified_name;
          }
        }
      } catch (e: any) {
        console.warn('[WhatsApp Signup] Failed to fetch phone numbers:', e.message);
      }
    }

    console.log(`[WhatsApp Signup] Phone: ${phoneNumber || 'unknown'}, PhoneNumId: ${phoneNumberId || 'unknown'}, Business: ${businessName || 'unknown'}`);

    // 5. Route based on source
    if (source === 'landing') {
      // Create lead record
      const leadId = crypto.randomUUID();
      const encryptedToken = encrypt(accessToken);
      await dbRun(
        `INSERT INTO whatsapp_signup_leads
           (id, waba_id, phone_number, business_name, facebook_user_id, access_token_encrypted, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,'pending',${isPg ? 'NOW(),NOW()' : "CURRENT_TIMESTAMP,CURRENT_TIMESTAMP"})`,
        leadId, wabaId, phoneNumber ?? null, businessName ?? null,
        facebookUserId ?? null, encryptedToken,
      );
      console.log(`[WhatsApp Signup] Lead created: ${leadId}`);

      // Alert Kejdi
      notifyNewWhatsAppLead({
        businessName: businessName ?? 'Unknown',
        phoneNumber: phoneNumber ?? 'Not provided',
        wabaId,
      }).catch(e => console.error('[WhatsApp Signup] Alert failed:', e.message));

      ok(res, { message: 'pending_review', leadId });
    } else {
      // tenant_settings — update tenant directly
      const tenant = await dbGet('SELECT * FROM tenants WHERE id = ?', tenantId);
      if (!tenant) return err(res, 'Tenant not found', 404);

      await dbRun(
        `UPDATE tenants SET
           provider = 'meta',
           meta_waba_id = ?,
           meta_phone_number_id = ?,
           meta_access_token = ?,
           whatsapp_number = ?,
           whatsapp_connected_at = ${isPg ? 'NOW()' : 'CURRENT_TIMESTAMP'}
         WHERE id = ?`,
        wabaId, phoneNumberId ?? null, accessToken,
        normaliseWhatsapp(phoneNumber), tenantId,
      );
      console.log(`[WhatsApp Signup] Tenant ${tenantId} updated with WABA ${wabaId}`);

      // Subscribe to webhooks for this WABA
      try {
        const subRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (subRes.ok) {
          console.log(`[WhatsApp Signup] Webhook subscribed for WABA ${wabaId}`);
        } else {
          console.warn(`[WhatsApp Signup] Webhook subscription failed:`, await subRes.text());
        }
      } catch (e: any) {
        console.warn('[WhatsApp Signup] Webhook subscription error:', e.message);
      }

      ok(res, {
        message: 'connected',
        wabaId,
        phoneNumber,
        phoneNumberId,
        businessName,
      });
    }
  } catch (e: any) {
    console.error('[WhatsApp Signup] Error:', e.message, e.stack);
    err(res, 'Failed to process signup', 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/whatsapp/signup-leads — admin list
// ---------------------------------------------------------------------------
whatsappSignupRouter.get('/whatsapp/signup-leads', async (req: Request, res: Response) => {
  try {
    const rows = await dbAll(
      `SELECT id, waba_id, phone_number, business_name, facebook_user_id, status, notes, tenant_id, created_at, updated_at
       FROM whatsapp_signup_leads ORDER BY created_at DESC`,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// PATCH /api/whatsapp/signup-leads/:id — update lead status / notes
// ---------------------------------------------------------------------------
whatsappSignupRouter.patch('/whatsapp/signup-leads/:id', async (req: Request, res: Response) => {
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
    await dbRun(`UPDATE whatsapp_signup_leads SET ${sets.join(', ')} WHERE id = ?`, ...params);
    const row = await dbGet('SELECT * FROM whatsapp_signup_leads WHERE id = ?', req.params.id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});
