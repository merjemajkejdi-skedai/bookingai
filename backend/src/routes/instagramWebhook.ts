import { Router } from 'express';
import { isPg, prepare, queryOne, queryRun } from '../db/database.js';
import { runHotelAgent } from '../hotel/agent.js';
import { sendInstagramMessage, getInstagramSenderProfile } from '../whatsapp/instagram.js';
import { alertError } from '../utils/errorMonitor.js';

const router = Router();

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}
async function dbRun(sql: string, ...p: unknown[]) {
  if (isPg) return queryRun(sql, p);
  prepare(sql).run(...p);
}

// POST /instagram/webhook — Incoming Instagram DMs from Meta
router.post('/instagram/webhook', async (req, res) => {
  res.sendStatus(200); // respond immediately to Meta

  try {
    const body = req.body;
    if (body.object !== 'instagram') return;

    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        if (!event.message || event.message.is_echo) continue;

        const psid:        string = event.sender.id;
        const recipientId: string = event.recipient.id;
        const text:        string = event.message.text ?? '';

        if (!text) continue;

        console.log(`[Instagram] DM from ${psid}: "${text.slice(0, 80)}"`);

        // Find tenant by Instagram account ID, join channel settings
        const row = await dbGet(
          `SELECT t.*, cs.ai_enabled, cs.access_token AS ig_access_token
           FROM tenants t
           LEFT JOIN hotel_channel_settings cs
             ON cs.tenant_id = t.id AND cs.channel = 'instagram'
           WHERE t.instagram_account_id = ?
           LIMIT 1`,
          recipientId,
        ) as any;

        if (!row) {
          console.error(`[Instagram] No tenant for account ID ${recipientId}`);
          continue;
        }

        const tenantId    = row.id as string;
        const aiEnabled   = row.ai_enabled === 1 || row.ai_enabled === true;
        const accessToken = (row.ig_access_token || process.env.INSTAGRAM_ACCESS_TOKEN || '') as string;
        const guestPhone  = `instagram:${psid}`;

        // Check if this is a new or existing conversation
        const existing = await dbGet(
          'SELECT id, guest_name, guest_username FROM hotel_conversations WHERE tenant_id = ? AND guest_phone = ?',
          tenantId, guestPhone,
        ) as any;

        if (!existing) {
          // New conversation — fetch sender profile before inserting
          const profile = await getInstagramSenderProfile(psid, accessToken);
          console.log(`[Instagram] Sender profile: name=${profile.name} username=${profile.username}`);
          await dbRun(
            `INSERT INTO hotel_conversations
               (id, tenant_id, guest_phone, messages, channel, channel_user_id,
                guest_name, guest_username, last_message, updated_at, last_guest_message_at)
             VALUES (?,?,?,'[]','instagram',?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
            crypto.randomUUID(), tenantId, guestPhone, psid, profile.name, profile.username,
          );
        } else {
          // Existing conversation — update timestamps; backfill name if still null
          if (!existing.guest_name && !existing.guest_username) {
            const profile = await getInstagramSenderProfile(psid, accessToken);
            console.log(`[Instagram] Backfill profile: name=${profile.name} username=${profile.username}`);
            if (profile.name || profile.username) {
              await dbRun(
                `UPDATE hotel_conversations
                 SET guest_name = ?, guest_username = ?, channel_user_id = ?,
                     last_guest_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE tenant_id = ? AND guest_phone = ?`,
                profile.name, profile.username, psid, tenantId, guestPhone,
              );
            } else {
              await dbRun(
                `UPDATE hotel_conversations
                 SET channel_user_id = ?, last_guest_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE tenant_id = ? AND guest_phone = ?`,
                psid, tenantId, guestPhone,
              );
            }
          } else {
            await dbRun(
              `UPDATE hotel_conversations
               SET channel_user_id = ?, last_guest_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
               WHERE tenant_id = ? AND guest_phone = ?`,
              psid, tenantId, guestPhone,
            );
          }
        }

        if (!aiEnabled) {
          // Append message so it appears in the dashboard for staff
          const convRow = await dbGet(
            'SELECT messages FROM hotel_conversations WHERE tenant_id = ? AND guest_phone = ?',
            tenantId, guestPhone,
          ) as any;
          const prev: any[] = (() => { try { return JSON.parse(convRow?.messages ?? '[]'); } catch { return []; } })();
          const updated = [
            ...prev,
            { role: 'user', content: text, ts: new Date().toISOString() },
          ].slice(-30);
          await dbRun(
            `UPDATE hotel_conversations
             SET messages = ?, updated_at = CURRENT_TIMESTAMP
             WHERE tenant_id = ? AND guest_phone = ?`,
            JSON.stringify(updated), tenantId, guestPhone,
          );
          console.log(`[Instagram] AI off for ${tenantId} — saved message from ${psid}`);
          continue;
        }

        // AI is ON — run hotel agent (saves conversation internally)
        try {
          const reply = await runHotelAgent(text, [], guestPhone, tenantId);
          if (!reply) continue;
          if (!accessToken) {
            console.error(`[Instagram] No access token for tenant ${tenantId}`);
            continue;
          }
          await sendInstagramMessage(psid, reply, accessToken);
          console.log(`[Instagram] AI reply sent to ${psid}`);
        } catch (agentErr: any) {
          alertError(agentErr, 'instagramAgent', { tenantId, psid });
          console.error('[Instagram] Agent error:', agentErr.message);
        }
      }
    }
  } catch (err: any) {
    alertError(err, 'instagramWebhook');
    console.error('[Instagram] Webhook error:', err.message);
  }
});

export default router;
