import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { isPg, query, queryOne, queryRun, prepare } from '../db/database.js';

export const facebookComplianceRouter = Router();

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const META_APP_SECRET = () => process.env.META_APP_SECRET!;

function parseSignedRequest(signedRequest: string, secret: string): { user_id: string } | null {
  const [encodedSig, payload] = signedRequest.split('.', 2);
  if (!encodedSig || !payload) return null;

  const sig = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();

  if (!crypto.timingSafeEqual(sig, expected)) return null;

  const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  return data;
}

// ---------------------------------------------------------------------------
// POST /api/facebook/deauthorize
// ---------------------------------------------------------------------------
facebookComplianceRouter.post('/facebook/deauthorize', async (req: Request, res: Response) => {
  const { signed_request } = req.body;
  console.log('[FB Deauthorize] Received deauthorize callback');

  const appSecret = META_APP_SECRET();
  if (!appSecret) {
    console.error('[FB Deauthorize] META_APP_SECRET not configured');
    return res.sendStatus(200);
  }

  if (!signed_request) {
    console.warn('[FB Deauthorize] No signed_request in body');
    return res.sendStatus(200);
  }

  const data = parseSignedRequest(signed_request, appSecret);
  if (!data) {
    console.warn('[FB Deauthorize] Invalid signed_request signature');
    return res.sendStatus(200);
  }

  const fbUserId = data.user_id;
  console.log(`[FB Deauthorize] Facebook user_id: ${fbUserId}`);

  try {
    // Disconnect any WhatsApp leads from this FB user
    await dbRun(
      `UPDATE whatsapp_signup_leads SET status = 'deauthorized', ${isPg ? 'updated_at = NOW()' : "updated_at = CURRENT_TIMESTAMP"} WHERE facebook_user_id = ?`,
      fbUserId,
    );

    // Disconnect any Instagram leads from this FB user (instagram_signup_leads doesn't have facebook_user_id, so we log it)
    console.log(`[FB Deauthorize] Processed deauthorize for FB user ${fbUserId}`);
  } catch (e: any) {
    console.error('[FB Deauthorize] Error:', e.message);
  }

  res.sendStatus(200);
});

// ---------------------------------------------------------------------------
// POST /api/facebook/data-deletion
// ---------------------------------------------------------------------------
facebookComplianceRouter.post('/facebook/data-deletion', async (req: Request, res: Response) => {
  const { signed_request } = req.body;
  console.log('[FB Data Deletion] Received data deletion request');

  const appSecret = META_APP_SECRET();
  if (!appSecret) {
    console.error('[FB Data Deletion] META_APP_SECRET not configured');
    return res.sendStatus(200);
  }

  if (!signed_request) {
    console.warn('[FB Data Deletion] No signed_request in body');
    return res.sendStatus(200);
  }

  const data = parseSignedRequest(signed_request, appSecret);
  if (!data) {
    console.warn('[FB Data Deletion] Invalid signed_request signature');
    return res.sendStatus(200);
  }

  const fbUserId = data.user_id;
  const confirmationCode = `DEL-${fbUserId}-${Date.now().toString(36)}`;
  console.log(`[FB Data Deletion] Facebook user_id: ${fbUserId}, confirmation: ${confirmationCode}`);

  try {
    // Delete WhatsApp signup leads for this FB user
    const leads = await dbAll(
      `SELECT id, tenant_id FROM whatsapp_signup_leads WHERE facebook_user_id = ?`,
      fbUserId,
    ) as any[];

    if (leads.length > 0) {
      await dbRun(
        `DELETE FROM whatsapp_signup_leads WHERE facebook_user_id = ?`,
        fbUserId,
      );
      console.log(`[FB Data Deletion] Deleted ${leads.length} WhatsApp signup lead(s)`);
    }

    console.log(`[FB Data Deletion] Completed for FB user ${fbUserId}`);
  } catch (e: any) {
    console.error('[FB Data Deletion] Error:', e.message);
  }

  res.json({
    url: 'https://skedai.net/data-deletion-confirmation',
    confirmation_code: confirmationCode,
  });
});
