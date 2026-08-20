import { Router, type Request, type Response } from 'express';
import twilio from 'twilio';
import { getSession, updateSession } from './sessions.js';
import { runBookingAgent } from '../modules/booking/agent.js';
import { runArtEventAgent } from '../modules/art_event/agent.js';
import { runArtClassAgent } from '../modules/art_class/agent.js';
import { runRestaurantAgent } from '../modules/restaurant/agent.js';
import { runHotelAgent } from '../hotel/agent.js';
import { runSkedAIAgent } from '../skedai/agent.js';
import { runShopAgent } from '../shop/agent.js';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { sendWhatsAppMessage } from './twilio.js';
import { logMessage } from './messageLog.js';
import { alertError } from '../utils/errorMonitor.js';
import { getConversationsTable } from '../utils/conversationsTable.js';

export const whatsappRouter = Router();

const MessagingResponse = twilio.twiml.MessagingResponse;

// ---------------------------------------------------------------------------
// Hotel message buffer — combines rapid successive messages before processing
// ---------------------------------------------------------------------------
const messageBuffer = new Map<string, {
  messages: string[];
  timer:    ReturnType<typeof setTimeout>;
  resolve:  (msg: string) => void;
}>();

/**
 * Waits 5 seconds before passing the message to the agent.
 * If another message from the same guest arrives within the window,
 * the timer resets and the messages are combined.
 * Returns null for the 2nd+ caller — only the first awaiter processes.
 */
export async function bufferMessage(
  tenantId:    string,
  guestPhone:  string,
  messageText: string,
): Promise<string | null> {
  const key = `${tenantId}:${guestPhone}`;

  if (messageBuffer.has(key)) {
    const existing = messageBuffer.get(key)!;
    clearTimeout(existing.timer);

    // Dedup: skip if identical to last message
    const last = existing.messages[existing.messages.length - 1];
    if (messageText !== last) {
      existing.messages.push(messageText);
    }

    // Reset timer — original resolve handles final processing
    const timer = setTimeout(() => {
      const combined = existing.messages.join('\n');
      messageBuffer.delete(key);
      existing.resolve(combined);
    }, 5000);

    existing.timer = timer;
    return null; // let the original awaiter process the combined message
  }

  return new Promise((resolve) => {
    const messages = [messageText];

    const timer = setTimeout(() => {
      const combined = messages.join('\n');
      messageBuffer.delete(key);
      resolve(combined);
    }, 5000);

    messageBuffer.set(key, { messages, timer, resolve });
  });
}

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}
async function dbRun(sql: string, ...p: unknown[]) {
  if (isPg) return queryRun(sql, p);
  prepare(sql).run(...p);
}

// ---------------------------------------------------------------------------
// Persist a conversation exchange to the tenant-type-specific table
// ---------------------------------------------------------------------------
import crypto from 'crypto';

async function persistConversation(
  table: string,
  tenantId: string,
  phone: string,
  userMessage: string,
  assistantReply: string,
  guestName?: string,
): Promise<void> {
  const now = new Date().toISOString();
  try {
    const existing = await dbGet(
      `SELECT id, messages FROM ${table} WHERE tenant_id = ? AND guest_phone = ?`,
      tenantId, phone,
    ) as any;

    const parseMessages = (raw: any): any[] => {
      if (Array.isArray(raw)) return raw;
      try { return JSON.parse(raw || '[]'); } catch { return []; }
    };

    const prev = parseMessages(existing?.messages);
    const updated = [
      ...prev,
      { role: 'user',      content: userMessage,    ts: now },
      { role: 'assistant', content: assistantReply, ts: now },
    ].slice(-30);

    if (existing) {
      await dbRun(
        `UPDATE ${table}
         SET messages = ?, last_message = ?, updated_at = ?, last_guest_message_at = ?,
             guest_name = COALESCE(?, guest_name)
         WHERE tenant_id = ? AND guest_phone = ?`,
        JSON.stringify(updated), now, now, now, guestName ?? null, tenantId, phone,
      );
    } else {
      const id = crypto.randomUUID();
      await dbRun(
        `INSERT INTO ${table}
           (id, tenant_id, guest_phone, guest_name, messages, last_message, channel, updated_at, last_guest_message_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        id, tenantId, phone, guestName ?? null, JSON.stringify(updated), now, 'whatsapp', now, now,
      );
    }
  } catch (e: any) {
    console.warn(`[Conversations] DB persist failed for ${table}:`, e.message);
  }
}

async function persistGuestMessage(
  table: string,
  tenantId: string,
  phone: string,
  userMessage: string,
  guestName?: string,
): Promise<void> {
  const now = new Date().toISOString();
  try {
    const existing = await dbGet(
      `SELECT id, messages FROM ${table} WHERE tenant_id = ? AND guest_phone = ?`,
      tenantId, phone,
    ) as any;

    const parseMessages = (raw: any): any[] => {
      if (Array.isArray(raw)) return raw;
      try { return JSON.parse(raw || '[]'); } catch { return []; }
    };

    const prev = parseMessages(existing?.messages);
    const last = prev[prev.length - 1];
    if (last?.role === 'user' && last.content === userMessage) return;

    const updated = [
      ...prev,
      { role: 'user', content: userMessage, ts: now },
    ].slice(-30);

    if (existing) {
      await dbRun(
        `UPDATE ${table}
         SET messages = ?, last_message = ?, updated_at = ?, last_guest_message_at = ?,
             guest_name = COALESCE(?, guest_name)
         WHERE tenant_id = ? AND guest_phone = ?`,
        JSON.stringify(updated), now, now, now, guestName ?? null, tenantId, phone,
      );
    } else {
      const id = crypto.randomUUID();
      await dbRun(
        `INSERT INTO ${table}
           (id, tenant_id, guest_phone, guest_name, messages, last_message, channel, updated_at, last_guest_message_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        id, tenantId, phone, guestName ?? null, JSON.stringify(updated), now, 'whatsapp', now, now,
      );
    }
  } catch (e: any) {
    console.warn(`[Conversations] Guest message persist failed for ${table}:`, e.message);
  }
}

// ---------------------------------------------------------------------------
// Shop order reminder — in-memory tracker for incomplete WhatsApp orders
// ---------------------------------------------------------------------------
interface ReminderEntry {
  timer:    ReturnType<typeof setTimeout>;
  tenantId: string;
  phone:    string;
  reminded: boolean;
}

const orderReminderMap = new Map<string, ReminderEntry>();

async function checkRecentOrder(tenantId: string, phone: string): Promise<boolean> {
  const sql = isPg
    ? `SELECT id FROM shop_orders WHERE tenant_id = ? AND guest_phone = ? AND created_at >= NOW() - INTERVAL '30 minutes' LIMIT 1`
    : `SELECT id FROM shop_orders WHERE tenant_id = ? AND guest_phone = ? AND created_at >= datetime('now', '-30 minutes') LIMIT 1`;
  const row = await dbGet(sql, tenantId, phone);
  return row != null;
}

async function checkAtNameConfirmStep(tenantId: string, phone: string): Promise<boolean> {
  const conv = await dbGet(
    'SELECT messages FROM shop_conversations WHERE tenant_id = ? AND guest_phone = ?',
    tenantId, phone,
  ) as any;
  if (!conv) return false;
  let msgs: any[];
  try { msgs = JSON.parse(conv.messages || '[]'); } catch { return false; }
  if (!msgs.length) return false;

  const last = msgs[msgs.length - 1];
  // Guest must not have replied after the agent's name-request message
  if (last?.role !== 'assistant') return false;

  const text = (last.content as string || '').toLowerCase();
  // Match common ways the agent asks for a name across supported languages
  const keywords = ['name', 'confirm', 'nome', 'nombre', 'nom', 'emrin', 'emër'];
  return keywords.some(kw => text.includes(kw));
}

export function cancelOrderReminder(tenantId: string, phone: string): void {
  const key = `${tenantId}:${phone}`;
  const existing = orderReminderMap.get(key);
  if (existing && !existing.reminded) {
    clearTimeout(existing.timer);
    orderReminderMap.delete(key);
    console.log(`[Shop reminder] Cancelled for ${phone} — customer replied`);
  }
}

export function scheduleOrderReminder(
  tenantId:     string,
  phone:        string,
  sendReminder: () => Promise<void>,
): void {
  const key = `${tenantId}:${phone}`;
  const existing = orderReminderMap.get(key);

  if (existing?.reminded) return;
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(async () => {
    const hasOrder = await checkRecentOrder(tenantId, phone).catch(() => false);
    if (hasOrder) { orderReminderMap.delete(key); return; }

    const atStep = await checkAtNameConfirmStep(tenantId, phone).catch(() => false);
    if (!atStep) {
      orderReminderMap.delete(key);
      console.log(`[Shop reminder] Skipped for ${phone} — not at name confirmation step`);
      return;
    }

    const entry = orderReminderMap.get(key);
    if (entry) entry.reminded = true;

    try {
      await sendReminder();
      console.log(`[Shop reminder] ✅ Sent to ${phone}`);
    } catch (err: any) {
      console.error(`[Shop reminder] ❌ Failed to send to ${phone}:`, err.message);
    }
  }, 5 * 60 * 1000);

  orderReminderMap.set(key, { timer, tenantId, phone, reminded: false });
}

export const REMINDER_PROMPT =
  "The customer started ordering but hasn't completed their order in the last 5 minutes " +
  "and hasn't replied. Send them ONE short, friendly reminder message saying their order " +
  "isn't confirmed yet and ask them to reply to complete it. Match the language they were " +
  "using. Keep it to 1-2 sentences maximum. Do not list menu items or prices.";

// ---------------------------------------------------------------------------
// Timeout + fallback helpers
// ---------------------------------------------------------------------------

/** Rejects with an error if `promise` does not settle within `ms` milliseconds. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Agent timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Returns the best available fallback message for this tenant.
 * For hotel tenants: reads hotel_config.fallback_message / front_office_phone.
 * All other tenants: generic message.
 */
async function getFallbackMessage(tenant: Record<string, any>): Promise<string> {
  if ((tenant.type || '').toLowerCase() === 'hotel') {
    try {
      const cfg = await dbGet(
        'SELECT fallback_message, front_office_phone FROM hotel_config WHERE tenant_id = ?',
        tenant.id,
      ) as any;
      if (cfg?.fallback_message) return cfg.fallback_message as string;
      if (cfg?.front_office_phone) {
        const clean = String(cfg.front_office_phone).replace(/\D/g, '');
        return `Our assistant is temporarily unavailable. For urgent requests, please contact the front office directly: wa.me/${clean}`;
      }
    } catch { /* ignore — fall through to generic */ }
  }
  return "Sorry, I'm having a technical issue. Please try again in a moment.";
}

// ---------------------------------------------------------------------------
// Resolve which tenant owns this WhatsApp business number.
// Returns the full tenant row so provider / meta fields are available.
// ---------------------------------------------------------------------------
async function resolveTenant(toNumber: string): Promise<Record<string, any> | null> {
  // Accept both "whatsapp:+355..." and "+355..." — match whichever format is stored
  const withPrefix    = toNumber.startsWith('whatsapp:') ? toNumber : `whatsapp:${toNumber}`;
  const withoutPrefix = toNumber.replace('whatsapp:', '').trim();

  try {
    const tenant = await dbGet(
      'SELECT * FROM tenants WHERE (whatsapp_number = ? OR whatsapp_number = ?) AND is_active = 1 LIMIT 1',
      withPrefix,
      withoutPrefix,
    ) as any;
    if (tenant) return tenant;
  } catch (e: any) {
    console.warn('⚠️  whatsapp_number lookup failed:', e.message);
  }

  const fallbackId = process.env.TENANT_ID || 'tenant-demo-001';
  try {
    const fallback = await dbGet('SELECT * FROM tenants WHERE id = ?', fallbackId) as any;
    if (fallback) return fallback;
  } catch (e: any) {
    console.warn('⚠️  TENANT_ID fallback lookup failed:', e.message);
  }

  console.warn('⚠️  No tenant row found — running agent with fallback id:', fallbackId);
  return { id: fallbackId, type: 'barbershop', provider: 'twilio' };
}

// ---------------------------------------------------------------------------
// Dispatch to the right module agent based on tenant type
// ---------------------------------------------------------------------------
async function runAgent(
  message: string,
  history: ReturnType<typeof getSession>,
  phone: string,
  tenantId: string,
  tenantType: string,
): Promise<string> {
  if (tenantType === 'hotel')            return runHotelAgent(message, history, phone, tenantId);
  if (tenantType === 'art_class')        return runArtClassAgent(message, history, phone, tenantId);
  if (tenantType === 'art_event')        return runArtEventAgent(message, history, phone, tenantId);
  if (tenantType === 'restaurant')       return runRestaurantAgent(message, history, phone, tenantId);
  // happy_ POS tenants use the POS app — WhatsApp is an optional bolt-on, never route to a generic agent
  if (tenantType.startsWith('happy_')) return '';
  return runBookingAgent(message, history, phone, tenantId);
}

// ---------------------------------------------------------------------------
// handleMetaWebhook — handles incoming messages from Meta Cloud API
// ---------------------------------------------------------------------------
async function handleMetaWebhook(req: Request, res: Response) {
  // Always acknowledge Meta immediately with 200
  res.sendStatus(200);

  try {
    const entry     = req.body?.entry?.[0];
    const change    = entry?.changes?.[0];
    const value     = change?.value;

    // Ignore non-message events (status updates, read receipts, etc.)
    if (!value?.messages?.length) return;

    const message    = value.messages[0];
    const from       = message.from;        // e.g. "355697990681" (no + prefix)
    const body       = message.text?.body;
    const phoneNumId = value.metadata?.phone_number_id;

    if (!body || !phoneNumId) return;

    console.log(`[Meta] 📨 Message from +${from} to phoneNumberId ${phoneNumId}`);

    // Look up tenant by meta_phone_number_id
    const tenant = await dbGet(
      'SELECT * FROM tenants WHERE meta_phone_number_id = ? AND is_active = 1 LIMIT 1',
      phoneNumId,
    ) as any;

    if (!tenant) {
      console.warn(`[Meta] No tenant found for phoneNumberId ${phoneNumId}`);
      return;
    }

    // Log inbound (fire-and-forget)
    logMessage(tenant.id, 'inbound', 'meta');

    const customerPhone = `+${from}`;
    const tenantType    = (tenant.type || '').toLowerCase();

    console.log(`[Meta] 🏪 Tenant: ${tenant.id} (type: ${tenantType})`);

    let reply = '';

    if (tenantType === 'skedai') {
      // Pause check
      const pausedRow = await dbGet(
        'SELECT ai_paused_until FROM skedai_conversations WHERE tenant_id = ? AND guest_phone = ? LIMIT 1',
        tenant.id, customerPhone,
      ) as any;
      if (pausedRow?.ai_paused_until && new Date(pausedRow.ai_paused_until) > new Date()) {
        const contactName = (value as any).contacts?.[0]?.profile?.name;
        persistGuestMessage('skedai_conversations', tenant.id, customerPhone, body, contactName || undefined);
        return;
      }

      try {
        reply = await withTimeout(runSkedAIAgent(body, customerPhone, tenant.id), 15_000);
      } catch (agentErr: any) {
        console.error('[Meta] ❌ SkedAI agent error/timeout:', agentErr?.message ?? agentErr);
        const fallback = await getFallbackMessage(tenant);
        await sendWhatsAppMessage(customerPhone, fallback, tenant)
          .catch((e: any) => console.error('[Meta] fallback send failed:', e.message));
        return;
      }
    } else if (tenantType === 'shop') {
      cancelOrderReminder(tenant.id, customerPhone);
      let shopToolsUsed: string[] = [];
      try {
        const agentResult = await withTimeout(runShopAgent(body, customerPhone, tenant.id), 15_000);
        reply = agentResult.reply;
        shopToolsUsed = agentResult.toolsUsed;
      } catch (agentErr: any) {
        console.error('[Meta] ❌ Shop agent error/timeout:', agentErr?.message ?? agentErr);
        const fallback = await getFallbackMessage(tenant);
        await sendWhatsAppMessage(customerPhone, fallback, tenant)
          .catch((e: any) => console.error('[Meta] fallback send failed:', e.message));
        return;
      }
      if (reply) {
        scheduleOrderReminder(tenant.id, customerPhone, async () => {
          const { reply: reminderReply } = await runShopAgent(REMINDER_PROMPT, customerPhone, tenant.id, undefined, true);
          if (!reminderReply) return;
          await sendWhatsAppMessage(customerPhone, reminderReply, tenant);
          const conv = await dbGet('SELECT messages FROM shop_conversations WHERE tenant_id = ? AND guest_phone = ?', tenant.id, customerPhone) as any;
          const msgs: any[] = (() => { try { return JSON.parse(conv?.messages || '[]'); } catch { return []; } })();
          await dbRun('UPDATE shop_conversations SET messages = ?, updated_at = ? WHERE tenant_id = ? AND guest_phone = ?',
            JSON.stringify([...msgs, { role: 'assistant', content: reminderReply }].slice(-40)), new Date().toISOString(), tenant.id, customerPhone);
        });
      }
    } else {
      // Art class pause check
      if (tenantType === 'art_class') {
        const pausedRow = await dbGet(
          'SELECT ai_paused_until FROM art_class_conversations WHERE tenant_id = ? AND guest_phone = ? LIMIT 1',
          tenant.id, customerPhone,
        ) as any;
        if (pausedRow?.ai_paused_until && new Date(pausedRow.ai_paused_until) > new Date()) {
          const contactName = (value as any).contacts?.[0]?.profile?.name;
          persistGuestMessage('art_class_conversations', tenant.id, customerPhone, body, contactName || undefined);
          return;
        }
      }

      const history = getSession(customerPhone);
      try {
        reply = await withTimeout(
          runAgent(body, history, customerPhone, tenant.id, tenantType),
          15_000,
        );
      } catch (agentErr: any) {
        console.error('[Meta] ❌ Agent error/timeout:', agentErr?.message ?? agentErr);
        const fallback = await getFallbackMessage(tenant);
        await sendWhatsAppMessage(customerPhone, fallback, tenant)
          .catch((e: any) => console.error('[Meta] fallback send failed:', e.message));
        return;
      }
      if (reply) updateSession(customerPhone, body, reply);
    }

    if (reply) {
      // Persist to per-tenant-type table
      const contactName = (value as any).contacts?.[0]?.profile?.name;
      if (tenantType === 'skedai') {
        persistConversation('skedai_conversations', tenant.id, customerPhone, body, reply, contactName || undefined);
      } else if (tenantType === 'art_class') {
        persistConversation('art_class_conversations', tenant.id, customerPhone, body, reply, contactName || undefined);
      }

      let waDelivered = true;
      try {
        await sendWhatsAppMessage(customerPhone, reply, tenant);
        console.log(`[Meta] ✅ Reply sent to +${from}`);
      } catch (waErr: any) {
        waDelivered = false;
        console.error(`[Meta] ❌ WhatsApp send failed:`, waErr.message);
      }

      if (!waDelivered && tenant.email_fallback_enabled && tenant.notification_email) {
        try {
          const { sendEmailFallback } = await import('../utils/emailFallback.js');
          await sendEmailFallback({
            toEmail:           tenant.notification_email,
            tenantName:        tenant.name || 'Hotel',
            guestPhone:        `+${from}`,
            guestName:         contactName || undefined,
            guestMessage:      body,
            aiReply:           reply,
            whatsappDelivered: false,
          });
        } catch (emailErr: any) {
          console.error('[Meta][Email fallback] Failed:', emailErr.message);
        }
      }
    }
  } catch (err) {
    console.error('[Meta webhook error]', err);
  }
}

// ---------------------------------------------------------------------------
// GET /webhook — Meta verification (hub.mode=subscribe) OR health check
// ---------------------------------------------------------------------------
whatsappRouter.get('/webhook', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode']         as string;
  const token     = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge']    as string;

  if (mode === 'subscribe') {
    if (token === process.env.META_VERIFY_TOKEN) {
      console.log('[Meta] ✅ Webhook verified successfully');
      return res.status(200).send(challenge);
    }
    console.warn('[Meta] ❌ Webhook verification failed — token mismatch');
    return res.sendStatus(403);
  }

  // Twilio / health check — just return 200
  res.sendStatus(200);
});

// ---------------------------------------------------------------------------
// POST /webhook — inbound WhatsApp message (Twilio or Meta)
// ---------------------------------------------------------------------------
whatsappRouter.post('/webhook', async (req: Request, res: Response) => {
  // ── Detect provider by payload shape ──────────────────────────────────────
  // Meta Cloud API payloads always carry object: 'whatsapp_business_account'
  if (req.body?.object === 'whatsapp_business_account') {
    return handleMetaWebhook(req, res);
  }

  // ── TWILIO handler (unchanged logic) ─────────────────────────────────────
  console.log('\n--- WEBHOOK HIT ---');
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('-------------------');

  const { Body, From, To, ProfileName } = req.body as {
    Body: string; From: string; To: string; ProfileName: string;
  };

  const phone = From?.replace('whatsapp:', '') ?? 'unknown';

  // Extract media metadata first so it can inform the body fallback
  const numMedia    = parseInt(req.body.NumMedia || '0');
  const rawMediaUrl = numMedia > 0 ? (req.body.MediaUrl0         || null) : null;
  const mediaMime   = numMedia > 0 ? (req.body.MediaContentType0 || null) : null;

  // If guest sent only a photo with no text, use a placeholder so Claude
  // never receives an empty user message (Anthropic rejects empty content)
  const rawBody     = (Body ?? '').trim();
  const messageText = rawBody || (rawMediaUrl ? '[Guest sent a photo]' : '');

  console.log(`\n📱 Incoming WhatsApp from ${phone} (${ProfileName}): "${messageText}"${rawMediaUrl ? ' [+photo]' : ''}`);

  // Acknowledge Twilio immediately
  const twiml = new MessagingResponse();
  res.setHeader('Content-Type', 'text/xml');
  res.send(twiml.toString());

  // Skip only if both text and media are absent
  if (!messageText && !rawMediaUrl) {
    console.log('⚠️  Empty message body — skipping agent');
    return;
  }

  try {
    const tenant = await resolveTenant(To ?? '');
    if (!tenant) {
      console.error('❌ No tenant found for WhatsApp number:', To);
      return;
    }

    // Log inbound (fire-and-forget)
    logMessage(tenant.id, 'inbound', (tenant.provider === 'meta' ? 'meta' : 'twilio'));

    // Download Twilio media immediately — protected Twilio URL → public Railway URL.
    // Must happen before the agent so it stores and forwards a publicly accessible URL.
    let mediaUrl: string | null = null;
    if (rawMediaUrl) {
      const { downloadTwilioMedia } = await import('./twilio.js');
      mediaUrl = await downloadTwilioMedia(rawMediaUrl, mediaMime || 'image/jpeg', tenant);
      if (!mediaUrl) console.warn('[Webhook] Media download failed — proceeding without photo');
    }

    const tenantType = (tenant.type || '').toLowerCase();
    console.log(`🏪 Tenant: ${tenant.id} (type: ${tenantType})`);

    // ── SkedAI — dedicated sales & support agent ──────────────────────────
    if (tenantType === 'skedai') {
      // Pause check
      const pausedRow = await dbGet(
        'SELECT ai_paused_until FROM skedai_conversations WHERE tenant_id = ? AND guest_phone = ? LIMIT 1',
        tenant.id, phone,
      ) as any;
      if (pausedRow?.ai_paused_until && new Date(pausedRow.ai_paused_until) > new Date()) {
        console.log(`[SkedAI] ⏸ AI paused for ${phone} — saving guest message only`);
        persistGuestMessage('skedai_conversations', tenant.id, phone, messageText, ProfileName || undefined);
        return;
      }

      let skedReply: string;
      try {
        skedReply = await withTimeout(runSkedAIAgent(messageText, phone, tenant.id), 15_000);
      } catch (agentErr: any) {
        console.error('❌ SkedAI agent error/timeout:', agentErr?.message ?? agentErr);
        const fallback = await getFallbackMessage(tenant);
        await sendWhatsAppMessage(phone, fallback, tenant)
          .catch((e: any) => console.error('❌ SkedAI fallback send failed:', e.message));
        return;
      }
      if (skedReply) {
        let waDelivered = true;
        try {
          await sendWhatsAppMessage(phone, skedReply, tenant);
          console.log(`✅ SkedAI reply sent to ${phone}`);
        } catch (waErr: any) {
          waDelivered = false;
          console.error('❌ SkedAI send failed:', waErr.message);
        }
        persistConversation('skedai_conversations', tenant.id, phone, messageText, skedReply, ProfileName || undefined);
        if (!waDelivered && tenant.email_fallback_enabled && tenant.notification_email) {
          try {
            const { sendEmailFallback } = await import('../utils/emailFallback.js');
            await sendEmailFallback({
              toEmail:           tenant.notification_email,
              tenantName:        tenant.name || 'Tenant',
              guestPhone:        phone,
              guestName:         ProfileName || undefined,
              guestMessage:      messageText,
              aiReply:           skedReply,
              whatsappDelivered: false,
            });
          } catch (emailErr: any) {
            console.error('[Email fallback] SkedAI failed:', emailErr.message);
          }
        }
      }
      return;
    }

    // ── Shop — WhatsApp ordering agent ────────────────────────────────────
    if (tenantType === 'shop') {
      cancelOrderReminder(tenant.id, phone);
      let shopReply = '';
      let shopToolsUsed: string[] = [];
      try {
        const agentResult = await withTimeout(runShopAgent(messageText, phone, tenant.id), 15_000);
        shopReply = agentResult.reply;
        shopToolsUsed = agentResult.toolsUsed;
      } catch (agentErr: any) {
        console.error('❌ Shop agent error/timeout:', agentErr?.message ?? agentErr);
        const fallback = await getFallbackMessage(tenant);
        await sendWhatsAppMessage(phone, fallback, tenant)
          .catch((e: any) => console.error('❌ Shop fallback send failed:', e.message));
        return;
      }
      if (shopReply) {
        let waDelivered = true;
        try {
          await sendWhatsAppMessage(phone, shopReply, tenant);
          console.log(`✅ Shop reply sent to ${phone}`);
        } catch (waErr: any) {
          waDelivered = false;
          console.error('❌ Shop send failed:', waErr.message);
        }
        if (!waDelivered && tenant.email_fallback_enabled && tenant.notification_email) {
          try {
            const { sendEmailFallback } = await import('../utils/emailFallback.js');
            await sendEmailFallback({
              toEmail:           tenant.notification_email,
              tenantName:        tenant.name || 'Tenant',
              guestPhone:        phone,
              guestName:         ProfileName || undefined,
              guestMessage:      messageText,
              aiReply:           shopReply,
              whatsappDelivered: false,
            });
          } catch (emailErr: any) {
            console.error('[Email fallback] Shop failed:', emailErr.message);
          }
        }
        scheduleOrderReminder(tenant.id, phone, async () => {
          const { reply: reminderReply } = await runShopAgent(REMINDER_PROMPT, phone, tenant.id, undefined, true);
          if (!reminderReply) return;
          await sendWhatsAppMessage(phone, reminderReply, tenant);
          const conv = await dbGet('SELECT messages FROM shop_conversations WHERE tenant_id = ? AND guest_phone = ?', tenant.id, phone) as any;
          const msgs: any[] = (() => { try { return JSON.parse(conv?.messages || '[]'); } catch { return []; } })();
          await dbRun('UPDATE shop_conversations SET messages = ?, updated_at = ? WHERE tenant_id = ? AND guest_phone = ?',
            JSON.stringify([...msgs, { role: 'assistant', content: reminderReply }].slice(-40)), new Date().toISOString(), tenant.id, phone);
        });
      }
      return;
    }

    // Art class pause check
    if (tenantType === 'art_class') {
      const pausedRow = await dbGet(
        'SELECT ai_paused_until FROM art_class_conversations WHERE tenant_id = ? AND guest_phone = ? LIMIT 1',
        tenant.id, phone,
      ) as any;
      if (pausedRow?.ai_paused_until && new Date(pausedRow.ai_paused_until) > new Date()) {
        console.log(`[ArtClass] ⏸ AI paused for ${phone} — saving guest message only`);
        persistGuestMessage('art_class_conversations', tenant.id, phone, messageText, ProfileName || undefined);
        return;
      }
    }

    const history = getSession(phone);

    // Hotel: pass media context directly so photos reach the agent
    let reply: string;
    try {
      if (tenantType === 'hotel') {
        // Buffer for 5 s — combines rapid successive messages before processing
        const combined = await bufferMessage(tenant.id, phone, messageText);
        if (combined === null) return; // another message reset the timer; that call will process

        reply = await withTimeout(
          runHotelAgent(combined, history, phone, tenant.id, mediaUrl, mediaMime),
          15_000,
        );
      } else {
        reply = await withTimeout(
          runAgent(messageText, history, phone, tenant.id, tenantType),
          15_000,
        );
      }
    } catch (agentErr: any) {
      console.error('❌ Agent error/timeout:', agentErr?.message ?? agentErr);
      const fallback = await getFallbackMessage(tenant);
      await sendWhatsAppMessage(phone, fallback, tenant)
        .catch((e: any) => console.error('❌ Fallback send failed:', e.message));
      return;
    }

    updateSession(phone, messageText, reply);

    console.log(`🤖 Agent reply: "${reply.slice(0, 120)}"`);

    // Empty reply = hotel silent mode (blocked number) — send nothing
    if (!reply) return;

    // Persist to per-tenant-type conversations table (hotel handles its own via hotel/session.ts)
    if (tenantType === 'art_class') {
      persistConversation('art_class_conversations', tenant.id, phone, messageText, reply, ProfileName || undefined);
    }

    let whatsappDelivered = true;
    try {
      await sendWhatsAppMessage(phone, reply, tenant);
      console.log(`✅ Reply sent to ${phone}`);
    } catch (waErr: any) {
      whatsappDelivered = false;
      console.error('❌ WhatsApp send failed:', waErr.message);
    }

    if (!whatsappDelivered && tenant.email_fallback_enabled && tenant.notification_email) {
      try {
        const { sendEmailFallback } = await import('../utils/emailFallback.js');
        await sendEmailFallback({
          toEmail:           tenant.notification_email,
          tenantName:        tenant.name || 'Hotel',
          guestPhone:        phone,
          guestName:         ProfileName || undefined,
          guestMessage:      messageText,
          aiReply:           reply,
          whatsappDelivered: false,
        });
      } catch (emailErr: any) {
        console.error('[Email fallback] Failed:', emailErr.message);
      }
    }

  } catch (err: any) {
    alertError(err, 'twilioWebhook');
    console.error('❌ Webhook error:', err?.message ?? err);
  }
});

// ---------------------------------------------------------------------------
// POST /send — manual message sending (admin/test utility)
// ---------------------------------------------------------------------------
whatsappRouter.post('/send', async (req: Request, res: Response) => {
  const { to, message } = req.body as { to: string; message: string };
  if (!to || !message) {
    return res.status(400).json({ success: false, error: 'to and message are required' });
  }
  try {
    await sendWhatsAppMessage(to, message);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
