import cron from 'node-cron';
import { isPg, query, queryRun } from '../db/database.js';
import { decrypt, encrypt } from '../utils/encryption.js';
import { alertError } from '../utils/errorMonitor.js';

async function refreshInstagramTokens() {
  if (!isPg) return;

  try {
    const rows = await query(
      `SELECT id, instagram_oauth_token_encrypted, instagram_oauth_expires_at
       FROM tenants
       WHERE instagram_connection_type = 'oauth'
         AND instagram_oauth_expires_at IS NOT NULL
         AND instagram_oauth_expires_at < NOW() + INTERVAL '30 days'
         AND instagram_oauth_expires_at > NOW()`,
      [],
    ) as any[];

    if (!rows.length) return;
    console.log(`[Instagram Refresh] ${rows.length} token(s) expiring within 30 days`);

    for (const tenant of rows) {
      try {
        const token = decrypt(tenant.instagram_oauth_token_encrypted);
        const response = await fetch(
          `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
        );
        const data = await response.json() as any;

        if (data.access_token) {
          const newEncrypted = encrypt(data.access_token);
          await queryRun(
            `UPDATE tenants SET
               instagram_oauth_token_encrypted = $1,
               instagram_oauth_expires_at = NOW() + INTERVAL '60 days'
             WHERE id = $2`,
            [newEncrypted, tenant.id],
          );
          // Also update the live token in hotel_channel_settings
          await queryRun(
            `UPDATE hotel_channel_settings
             SET access_token = $1, updated_at = NOW()
             WHERE tenant_id = $2 AND channel = 'instagram'`,
            [data.access_token, tenant.id],
          );
          console.log(`[Instagram Refresh] Token refreshed for tenant ${tenant.id}`);
        } else {
          console.warn(`[Instagram Refresh] No new token for tenant ${tenant.id}:`, JSON.stringify(data));
        }
      } catch (err: any) {
        console.error(`[Instagram Refresh] Failed for tenant ${tenant.id}:`, err.message);
        alertError(err, 'instagramTokenRefresh', { tenantId: tenant.id });
      }
    }
  } catch (err: any) {
    console.error('[Instagram Refresh] Query error:', err.message);
    alertError(err, 'instagramTokenRefreshQuery');
  }
}

async function refreshMessengerTokens() {
  if (!isPg) return;

  try {
    const rows = await query(
      `SELECT id, messenger_oauth_token_encrypted, messenger_oauth_expires_at
       FROM tenants
       WHERE messenger_connection_type = 'oauth'
         AND messenger_oauth_expires_at IS NOT NULL
         AND messenger_oauth_expires_at < NOW() + INTERVAL '30 days'
         AND messenger_oauth_expires_at > NOW()`,
      [],
    ) as any[];

    if (!rows.length) return;
    console.log(`[Messenger Refresh] ${rows.length} token(s) expiring within 30 days`);

    for (const tenant of rows) {
      try {
        const token = decrypt(tenant.messenger_oauth_token_encrypted);
        const response = await fetch(
          'https://graph.facebook.com/v21.0/oauth/access_token?' + new URLSearchParams({
            grant_type:        'fb_exchange_token',
            client_id:         process.env.META_APP_ID || '1507114490265475',
            client_secret:     process.env.META_APP_SECRET!,
            fb_exchange_token: token,
          }),
        );
        const data = await response.json() as any;

        if (data.access_token) {
          const newEncrypted = encrypt(data.access_token);
          await queryRun(
            `UPDATE tenants SET
               messenger_oauth_token_encrypted = $1,
               messenger_access_token_encrypted = $1,
               messenger_oauth_expires_at = NOW() + INTERVAL '60 days'
             WHERE id = $2`,
            [newEncrypted, tenant.id],
          );
          // Also update the live token in hotel_channel_settings
          await queryRun(
            `UPDATE hotel_channel_settings
             SET access_token = $1, updated_at = NOW()
             WHERE tenant_id = $2 AND channel = 'facebook'`,
            [data.access_token, tenant.id],
          );
          console.log(`[Messenger Refresh] Token refreshed for tenant ${tenant.id}`);
        } else {
          console.warn(`[Messenger Refresh] No new token for tenant ${tenant.id}:`, JSON.stringify(data));
        }
      } catch (err: any) {
        console.error(`[Messenger Refresh] Failed for tenant ${tenant.id}:`, err.message);
        alertError(err, 'messengerTokenRefresh', { tenantId: tenant.id });
      }
    }
  } catch (err: any) {
    console.error('[Messenger Refresh] Query error:', err.message);
    alertError(err, 'messengerTokenRefreshQuery');
  }
}

export function startInstagramTokenRefresh() {
  cron.schedule('0 2 * * *', () => {
    console.log('[Token Refresh] Running daily token refresh...');
    refreshInstagramTokens().catch(e => console.error('[Instagram Refresh] Uncaught:', e.message));
    refreshMessengerTokens().catch(e => console.error('[Messenger Refresh] Uncaught:', e.message));
  });
  console.log('[Token Refresh] Daily token refresh scheduled at 02:00');
}
