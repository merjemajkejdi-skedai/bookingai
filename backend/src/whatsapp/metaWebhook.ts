import { Router, type Request, type Response } from 'express';
import { isPg, prepare, queryOne } from '../db/database.js';
import { getSession, updateSession } from './sessions.js';
import { bufferMessage, cancelOrderReminder, scheduleOrderReminder, REMINDER_PROMPT } from './webhook.js';
import { sendWhatsAppMessage } from './twilio.js';
import { downloadMetaMedia } from './meta.js';
import { uploadToR2 } from '../utils/r2.js';
import { logMessage } from './messageLog.js';
import { runHotelAgent } from '../hotel/agent.js';
import { runShopAgent } from '../shop/agent.js';
import { runSkedAIAgent } from '../skedai/agent.js';
import { runBookingAgent } from '../modules/booking/agent.js';
import { runArtEventAgent } from '../modules/art_event/agent.js';
import { runArtClassAgent } from '../modules/art_class/agent.js';
import { runRestaurantAgent } from '../modules/restaurant/agent.js';
import { sendEmailFallback } from '../utils/emailFallback.js';
import { alertError } from '../utils/errorMonitor.js';

const metaRouter = Router();

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Agent timed out after ${ms}ms`)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// GET /meta/webhook — Meta Developer Portal verification
metaRouter.get('/meta/webhook', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode'] as string;
  const token     = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('[Meta] ✅ Webhook verified');
    return res.status(200).send(challenge);
  }
  console.warn('[Meta] ❌ Webhook verification failed — check META_VERIFY_TOKEN');
  res.sendStatus(403);
});

// POST /meta/webhook — Incoming WhatsApp messages from Meta Cloud API
metaRouter.post('/meta/webhook', async (req: Request, res: Response) => {
  res.sendStatus(200); // respond immediately to Meta

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value      = change.value;
        const phoneNumId = value.metadata?.phone_number_id as string | undefined;
        const contacts   = (value.contacts || []) as any[];

        // Log status updates but don't process them
        for (const status of value.statuses || []) {
          console.log(`[Meta] Status: ${status.status} for ${status.recipient_id}`);
        }

        for (const message of (value.messages || []) as any[]) {
          const guestPhone = message.from as string; // e.g. "355696032577"
          const contact    = contacts.find((c: any) => c.wa_id === guestPhone);
          const guestName  = contact?.profile?.name as string | undefined;

          let messageText = '';
          let mediaId     = '';
          let mediaMime   = '';

          switch (message.type) {
            case 'text':
              messageText = message.text?.body || '';
              break;
            case 'image':
              messageText = message.image?.caption || '';
              mediaId     = message.image?.id || '';
              mediaMime   = 'image/jpeg';
              break;
            case 'video':
              messageText = message.video?.caption || '';
              mediaId     = message.video?.id || '';
              mediaMime   = 'video/mp4';
              break;
            case 'document':
              messageText = message.document?.caption || '';
              break;
            default:
              console.log(`[Meta] Skipping unsupported type: ${message.type}`);
              continue;
          }

          if (!messageText && !mediaId) continue;

          const customerPhone = `+${guestPhone}`;
          console.log(`[Meta] 📱 ${customerPhone}${guestName ? ` (${guestName})` : ''}: "${messageText}"${mediaId ? ' [+media]' : ''}`);

          const tenant = await dbGet(
            'SELECT * FROM tenants WHERE meta_phone_number_id = ? AND is_active = 1 LIMIT 1',
            phoneNumId,
          ) as any;

          if (!tenant) {
            console.warn(`[Meta] No active tenant for phoneNumberId: ${phoneNumId}`);
            continue;
          }

          logMessage(tenant.id, 'inbound', 'meta');

          const tenantType  = (tenant.type || '').toLowerCase();
          const textToAgent = messageText || (mediaId ? '[Guest sent a photo]' : '');

          console.log(`[Meta] Tenant: ${tenant.id} (${tenantType})`);

          // ── Hotel: download media first, then buffer, then agent ──────────────
          if (tenantType === 'hotel') {
            let photoUrl: string | null = null;

            if (mediaId && tenant.meta_access_token) {
              const media = await downloadMetaMedia(mediaId, tenant.meta_access_token);
              if (media) {
                const ext = media.mimeType.includes('png') ? '.png' : media.mimeType.includes('gif') ? '.gif' : '.jpg';
                const key = `hotel/${tenant.id}/maintenance/${Date.now()}${ext}`;
                try {
                  photoUrl = await uploadToR2(key, media.buffer, media.mimeType);
                  console.log(`[Meta] ✅ Media → R2: ${photoUrl}`);
                } catch (r2Err: any) {
                  console.error('[Meta] R2 upload failed:', r2Err.message);
                }
              }
            }

            const combined = await bufferMessage(tenant.id, customerPhone, textToAgent);
            if (combined === null) continue; // another message reset the timer

            const history = getSession(customerPhone);
            let reply = '';
            try {
              reply = await withTimeout(
                runHotelAgent(combined, history, customerPhone, tenant.id, photoUrl, mediaMime || null),
                15_000,
              );
            } catch (agentErr: any) {
              console.error('[Meta] Hotel agent error:', agentErr.message);
              reply = "Sorry, I'm having a technical issue. Please try again in a moment.";
            }

            if (!reply) continue; // blocked number or silent mode
            updateSession(customerPhone, combined, reply);

            let hotelDelivered = true;
            try {
              await sendWhatsAppMessage(customerPhone, reply, tenant);
              console.log(`[Meta] ✅ Reply sent to ${customerPhone}`);
            } catch (sendErr: any) {
              hotelDelivered = false;
              console.error('[Meta] Hotel send failed:', sendErr.message);
            }
            if (!hotelDelivered && tenant.email_fallback_enabled && tenant.notification_email) {
              try {
                await sendEmailFallback({
                  toEmail:           tenant.notification_email,
                  tenantName:        tenant.name || 'Hotel',
                  guestPhone:        customerPhone,
                  guestName,
                  guestMessage:      textToAgent,
                  aiReply:           reply,
                  whatsappDelivered: false,
                });
              } catch (emailErr: any) {
                console.error('[Meta] Hotel email fallback failed:', emailErr.message);
              }
            }
            continue;
          }

          // ── All other tenant types ────────────────────────────────────────────
          const history = getSession(customerPhone);
          let reply = '';
          let shopToolsUsed: string[] = [];

          // Cancel any pending reminder — customer sent a new message
          if (tenantType === 'shop') cancelOrderReminder(tenant.id, customerPhone);

          try {
            if (tenantType === 'skedai') {
              reply = await withTimeout(runSkedAIAgent(textToAgent, customerPhone, tenant.id), 15_000);
            } else if (tenantType === 'shop') {
              const agentResult = await withTimeout(runShopAgent(textToAgent, customerPhone, tenant.id), 15_000);
              reply = agentResult.reply;
              shopToolsUsed = agentResult.toolsUsed;
            } else if (tenantType === 'art_event') {
              reply = await withTimeout(runArtEventAgent(textToAgent, history, customerPhone, tenant.id), 15_000);
            } else if (tenantType === 'art_class') {
              reply = await withTimeout(runArtClassAgent(textToAgent, history, customerPhone, tenant.id), 15_000);
            } else if (tenantType === 'restaurant') {
              reply = await withTimeout(runRestaurantAgent(textToAgent, history, customerPhone, tenant.id), 15_000);
            } else {
              reply = await withTimeout(runBookingAgent(textToAgent, history, customerPhone, tenant.id), 15_000);
            }
          } catch (agentErr: any) {
            console.error(`[Meta] Agent error (${tenantType}):`, agentErr.message);
            reply = "Sorry, I'm having a technical issue. Please try again in a moment.";
          }

          if (!reply) continue;

          if (tenantType !== 'skedai' && tenantType !== 'shop') {
            updateSession(customerPhone, textToAgent, reply);
          }

          let waDelivered = true;
          try {
            await sendWhatsAppMessage(customerPhone, reply, tenant);
            console.log(`[Meta] ✅ Reply sent to ${customerPhone}`);
          } catch (sendErr: any) {
            waDelivered = false;
            console.error('[Meta] Send failed:', sendErr.message);
          }

          if (!waDelivered && tenant.email_fallback_enabled && tenant.notification_email) {
            try {
              await sendEmailFallback({
                toEmail:           tenant.notification_email,
                tenantName:        tenant.name || 'Tenant',
                guestPhone:        customerPhone,
                guestName,
                guestMessage:      textToAgent,
                aiReply:           reply,
                whatsappDelivered: false,
              });
            } catch (emailErr: any) {
              console.error('[Meta] Email fallback failed:', emailErr.message);
            }
          }

          // Schedule reminder for active shop ordering conversations
          if (tenantType === 'shop' && reply) {
            scheduleOrderReminder(tenant.id, customerPhone, async () => {
              const { reply: reminderReply } = await runShopAgent(REMINDER_PROMPT, customerPhone, tenant.id, undefined, true);
              if (!reminderReply) return;
              await sendWhatsAppMessage(customerPhone, reminderReply, tenant);
            });
          }
        }
      }
    }
  } catch (err: any) {
    alertError(err, 'metaWebhook');
    console.error('[Meta webhook] Unhandled error:', err.message);
  }
});

export default metaRouter;
