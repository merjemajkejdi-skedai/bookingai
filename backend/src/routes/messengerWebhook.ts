import { Router } from 'express';
import crypto from 'crypto';
import { isPg, prepare, queryOne, queryRun } from '../db/database.js';
import { runHotelAgent } from '../hotel/agent.js';
import { sendMessengerMessage, getMessengerSenderProfile } from '../channels/messenger.js';
import { decrypt } from '../utils/encryption.js';
import { alertError } from '../utils/errorMonitor.js';
import { getConversationsTable } from '../utils/conversationsTable.js';

const router = Router();

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}
async function dbRun(sql: string, ...p: unknown[]) {
  if (isPg) return queryRun(sql, p);
  prepare(sql).run(...p);
}

router.get('/messenger/webhook', (req, res) => {
  const mode      = req.query['hub.mode']         as string;
  const token     = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge']     as string;

  if (mode === 'subscribe' && token === process.env.MESSENGER_VERIFY_TOKEN) {
    console.log('[Messenger] Webhook verified');
    return res.status(200).send(challenge);
  }
  console.warn('[Messenger] Webhook verification failed — check MESSENGER_VERIFY_TOKEN');
  res.sendStatus(403);
});

router.post('/messenger/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== 'page') return;

    for (const entry of body.entry ?? []) {
      const pageId: string = entry.id;

      const tenant = await dbGet(
        `SELECT * FROM tenants WHERE messenger_page_id = ? LIMIT 1`,
        pageId,
      ) as any;

      if (!tenant) {
        console.warn(`[Messenger] Unknown page ID: ${pageId}`);
        continue;
      }

      for (const event of entry.messaging ?? []) {
        try {
          await handleMessengerMessage(tenant, event);
        } catch (err: any) {
          alertError(err, 'messengerMessageHandler', { tenantId: tenant.id, pageId });
          console.error('[Messenger] Message handler error:', err.message);
        }
      }
    }
  } catch (err: any) {
    alertError(err, 'messengerWebhook');
    console.error('[Messenger] Webhook error:', err.message);
  }
});

async function handleMessengerMessage(tenant: any, event: any) {
  if (event.message?.is_echo) return;
  if (event.delivery || event.read) return;
  if (event.postback) return;

  const psid: string = event.sender.id;
  const text: string = event.message?.text ?? '';
  const messageId: string = event.message?.mid ?? '';
  const timestamp: number = event.timestamp ?? Math.floor(Date.now() / 1000);

  if (!text) return;

  console.log(`[Messenger] DM from ${psid}: "${text.slice(0, 80)}"`);

  const tenantId = tenant.id as string;
  const aiEnabled = tenant.messenger_ai_enabled === true || tenant.messenger_ai_enabled === 1;
  const encryptedToken = (tenant.messenger_access_token_encrypted || '') as string;
  const guestPhone = `messenger:${psid}`;

  if (!encryptedToken) {
    console.error(`[Messenger] No access token for tenant ${tenantId}`);
    return;
  }

  const table = getConversationsTable(tenant.type);

  const existing = await dbGet(
    `SELECT id, guest_name FROM ${table} WHERE tenant_id = ? AND guest_phone = ?`,
    tenantId, guestPhone,
  ) as any;

  const convId: string = existing?.id ?? crypto.randomUUID();

  if (!existing) {
    const pageToken = decrypt(encryptedToken);
    const profile = await getMessengerSenderProfile(psid, pageToken);
    console.log(`[Messenger] Sender profile: name=${profile.name}`);
    await dbRun(
      `INSERT INTO ${table}
         (id, tenant_id, guest_phone, messages, channel, channel_user_id,
          guest_name, last_message, updated_at, last_guest_message_at)
       VALUES (?,?,?,'[]','messenger',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      convId, tenantId, guestPhone, psid, profile.name,
    );
  } else {
    if (!existing.guest_name) {
      const pageToken = decrypt(encryptedToken);
      const profile = await getMessengerSenderProfile(psid, pageToken);
      if (profile.name) {
        await dbRun(
          `UPDATE ${table}
           SET guest_name = ?, channel_user_id = ?,
               last_guest_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE tenant_id = ? AND guest_phone = ?`,
          profile.name, psid, tenantId, guestPhone,
        );
      }
    } else {
      await dbRun(
        `UPDATE ${table}
         SET channel_user_id = ?, last_guest_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ? AND guest_phone = ?`,
        psid, tenantId, guestPhone,
      );
    }
  }

  if (!aiEnabled) {
    const guestMsg = {
      role: 'user',
      content: text,
      ts: new Date(Number(timestamp)).toISOString(),
    };
    if (isPg) {
      await dbRun(
        `UPDATE ${table}
         SET messages = messages || ?::jsonb, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        JSON.stringify([guestMsg]), convId,
      );
    } else {
      const convRow = await dbGet(
        `SELECT messages FROM ${table} WHERE id = ?`,
        convId,
      ) as any;
      const prev: any[] = (() => { try { return JSON.parse(convRow?.messages ?? '[]'); } catch { return []; } })();
      await dbRun(
        `UPDATE ${table}
         SET messages = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        JSON.stringify([...prev, guestMsg].slice(-30)), convId,
      );
    }
    console.log(`[Messenger] AI off for ${tenantId} — saved message from ${psid}`);
    return;
  }

  try {
    const reply = await runHotelAgent(text, [], guestPhone, tenantId);
    if (!reply) return;
    await sendMessengerMessage(tenant.messenger_page_id, psid, reply, encryptedToken);
    console.log(`[Messenger] AI reply sent to ${psid}`);
  } catch (agentErr: any) {
    alertError(agentErr, 'messengerAgent', { tenantId, psid });
    console.error('[Messenger] Agent error:', agentErr.message);
  }
}

export default router;
