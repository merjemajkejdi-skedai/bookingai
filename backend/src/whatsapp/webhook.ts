import { Router, type Request, type Response } from 'express';
import twilio from 'twilio';
import { getSession, updateSession } from './sessions.js';
import { runBookingAgent } from '../modules/booking/agent.js';
import { runArtEventAgent } from '../modules/art_event/agent.js';
import { runArtClassAgent } from '../modules/art_class/agent.js';
import { isPg, prepare, query, queryOne } from '../db/database.js';

export const whatsappRouter = Router();

const MessagingResponse = twilio.twiml.MessagingResponse;

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}

// ---------------------------------------------------------------------------
// Resolve which tenant owns this WhatsApp business number.
// Twilio sends `To` as the business's number (e.g. "whatsapp:+14155238886").
// We match that against tenants.whatsapp_number.
// Falls back to TENANT_ID env var for single-tenant / dev setups.
// ---------------------------------------------------------------------------
async function resolveTenant(toNumber: string): Promise<{ id: string; type: string } | null> {
  const normalized = toNumber.replace('whatsapp:', '').trim();

  // Try to match by whatsapp_number (column may not exist on older DBs — catch gracefully)
  try {
    const tenant = await dbGet(
      'SELECT id, type FROM tenants WHERE whatsapp_number = ? AND is_active = 1 LIMIT 1',
      normalized
    ) as any;
    if (tenant) return { id: tenant.id, type: (tenant.type || '').toLowerCase() };
  } catch (e: any) {
    console.warn('⚠️  whatsapp_number lookup failed (column may be missing):', e.message);
  }

  // Fall back to TENANT_ID env var (single-tenant / dev setups)
  const fallbackId = process.env.TENANT_ID;
  if (fallbackId) {
    try {
      const fallback = await dbGet('SELECT id, type FROM tenants WHERE id = ?', fallbackId) as any;
      if (fallback) return { id: fallback.id, type: (fallback.type || '').toLowerCase() };
    } catch (e: any) {
      console.warn('⚠️  TENANT_ID fallback lookup failed:', e.message);
    }
  }

  return null;
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
  if (tenantType === 'art_class') {
    return runArtClassAgent(message, history, phone, tenantId);
  }
  if (tenantType === 'art_event') {
    return runArtEventAgent(message, history, phone, tenantId);
  }
  return runBookingAgent(message, history, phone, tenantId);
}

// ---------------------------------------------------------------------------
// POST /webhook — inbound WhatsApp message from Twilio
// ---------------------------------------------------------------------------
whatsappRouter.post('/webhook', async (req: Request, res: Response) => {
  console.log('\n--- WEBHOOK HIT ---');
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('-------------------');

  const { Body, From, To, ProfileName } = req.body as {
    Body: string;
    From: string;
    To: string;
    ProfileName: string;
  };

  const phone = From?.replace('whatsapp:', '') ?? 'unknown';
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

    console.log(`🏪 Tenant: ${tenant.id} (type: ${tenant.type})`);

    const history = getSession(phone);
    const reply = await runAgent(messageText, history, phone, tenant.id, tenant.type);
    updateSession(phone, messageText, reply);

    console.log(`🤖 Agent reply: "${reply.slice(0, 120)}"`);

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886',
      to: From,
      body: reply,
    });

    console.log(`✅ Reply sent to ${phone}`);
  } catch (err: any) {
    console.error('❌ Agent error:', err?.message ?? err);
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886',
        to: From,
        body: "Sorry, I'm having a technical issue. Please try again in a moment.",
      });
    } catch (sendErr: any) {
      console.error('❌ Failed to send error message:', sendErr?.message);
    }
  }
});

// ---------------------------------------------------------------------------
// GET /webhook — Twilio webhook verification
// ---------------------------------------------------------------------------
whatsappRouter.get('/webhook', (_req: Request, res: Response) => {
  res.sendStatus(200);
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
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const msg = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886',
      to: `whatsapp:${to}`,
      body: message,
    });
    res.json({ success: true, sid: msg.sid });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
