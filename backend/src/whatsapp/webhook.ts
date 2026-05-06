import { Router, type Request, type Response } from 'express';
import twilio from 'twilio';
import { getSession, updateSession } from './sessions.js';
import { runBookingAgent } from '../modules/booking/agent.js';
import { runArtEventAgent } from '../modules/art_event/agent.js';
import { runArtClassAgent } from '../modules/art_class/agent.js';
import { runRestaurantAgent } from '../modules/restaurant/agent.js';
import { runHotelAgent } from '../hotel/agent.js';
import { runSkedAIAgent } from '../skedai/agent.js';
import { isPg, prepare, query, queryOne } from '../db/database.js';
import { sendWhatsAppMessage } from './twilio.js';

export const whatsappRouter = Router();

const MessagingResponse = twilio.twiml.MessagingResponse;

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}

// ---------------------------------------------------------------------------
// Resolve which tenant owns this WhatsApp business number.
// Returns the full tenant row so provider / meta fields are available.
// ---------------------------------------------------------------------------
async function resolveTenant(toNumber: string): Promise<Record<string, any> | null> {
  const normalized = toNumber.replace('whatsapp:', '').trim();

  try {
    const tenant = await dbGet(
      'SELECT * FROM tenants WHERE whatsapp_number = ? AND is_active = 1 LIMIT 1',
      normalized,
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
  if (tenantType === 'hotel')      return runHotelAgent(message, history, phone, tenantId);
  if (tenantType === 'art_class')  return runArtClassAgent(message, history, phone, tenantId);
  if (tenantType === 'art_event')  return runArtEventAgent(message, history, phone, tenantId);
  if (tenantType === 'restaurant') return runRestaurantAgent(message, history, phone, tenantId);
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

    const customerPhone = `+${from}`;
    const tenantType    = (tenant.type || '').toLowerCase();

    console.log(`[Meta] 🏪 Tenant: ${tenant.id} (type: ${tenantType})`);

    let reply = '';

    if (tenantType === 'skedai') {
      reply = await runSkedAIAgent(body, customerPhone, tenant.id);
    } else {
      const history = getSession(customerPhone);
      reply = await runAgent(body, history, customerPhone, tenant.id, tenantType);
      if (reply) updateSession(customerPhone, body, reply);
    }

    if (reply) {
      await sendWhatsAppMessage(customerPhone, reply, tenant);
      console.log(`[Meta] ✅ Reply sent to +${from}`);
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

  const phone       = From?.replace('whatsapp:', '') ?? 'unknown';
  const messageText = (Body ?? '').trim();

  console.log(`\n📱 Incoming WhatsApp from ${phone} (${ProfileName}): "${messageText}"`);

  // Acknowledge Twilio immediately
  const twiml = new MessagingResponse();
  res.setHeader('Content-Type', 'text/xml');
  res.send(twiml.toString());

  if (!messageText) {
    console.log('⚠️  Empty message body — skipping agent');
    return;
  }

  try {
    const tenant = await resolveTenant(To ?? '');
    if (!tenant) {
      console.error('❌ No tenant found for WhatsApp number:', To);
      return;
    }

    const tenantType = (tenant.type || '').toLowerCase();
    console.log(`🏪 Tenant: ${tenant.id} (type: ${tenantType})`);

    // ── SkedAI — dedicated sales & support agent ──────────────────────────
    if (tenantType === 'skedai') {
      const reply = await runSkedAIAgent(messageText, phone, tenant.id);
      if (reply) {
        await sendWhatsAppMessage(phone, reply, tenant);
        console.log(`✅ SkedAI reply sent to ${phone}`);
      }
      return;
    }

    const history = getSession(phone);
    const reply   = await runAgent(messageText, history, phone, tenant.id, tenantType);
    updateSession(phone, messageText, reply);

    console.log(`🤖 Agent reply: "${reply.slice(0, 120)}"`);

    // Empty reply = hotel silent mode (blocked number) — send nothing
    if (!reply) return;

    await sendWhatsAppMessage(phone, reply, tenant);
    console.log(`✅ Reply sent to ${phone}`);

  } catch (err: any) {
    console.error('❌ Agent error:', err?.message ?? err);
    try {
      // Best-effort error message back to user via Twilio env vars
      await sendWhatsAppMessage(From?.replace('whatsapp:', '') ?? '', "Sorry, I'm having a technical issue. Please try again in a moment.");
    } catch (sendErr: any) {
      console.error('❌ Failed to send error message:', sendErr?.message);
    }
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
