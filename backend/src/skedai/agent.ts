// SkedAI agent — handles sales and support conversations on a dedicated WhatsApp number.
// Returns a reply string; the webhook handles sending it back to the customer.

import Anthropic from '@anthropic-ai/sdk';
import { format } from 'date-fns';
import { getSession, saveSession } from './session.js';
import {
  INTENT_DETECTION_PROMPT,
  SUPPORT_SYSTEM_PROMPT,
  SALES_SYSTEM_PROMPT,
} from './prompts.js';
import {
  notifySupportRequest,
  notifySalesLead,
  type ServiceStatus,
} from './notify.js';

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const MODEL   = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// ── Health checks ─────────────────────────────────────────────────────────────
const HEALTH_CHECKS: Array<{
  service: string;
  url: string;
  headers?: Record<string, string>;
  parse: (r: Response) => Promise<string>;
}> = [
  {
    service: 'Railway (backend)',
    url: process.env.RAILWAY_HEALTH_URL || 'https://bookingai-production-8d5d.up.railway.app/health',
    parse: async (r) => {
      try { const d = await r.json(); return d.status === 'ok' ? 'ok' : 'degraded'; }
      catch { return r.ok ? 'ok' : `http ${r.status}`; }
    },
  },
  {
    service: 'Vercel (dashboard)',
    url: process.env.VERCEL_HEALTH_URL || 'https://app.skedai.net',
    parse: async (r) => r.ok ? 'ok' : `http ${r.status}`,
  },
  {
    service: 'Twilio',
    url: `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}.json`,
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
      ).toString('base64')}`,
    },
    parse: async (r) => r.ok ? 'ok' : `http ${r.status}`,
  },
];

async function runHealthChecks(): Promise<ServiceStatus[]> {
  const results = await Promise.allSettled(
    HEALTH_CHECKS.map(async (check) => {
      try {
        const r = await fetch(check.url, {
          headers: check.headers || {},
          signal: AbortSignal.timeout(5000),
        });
        const status = await check.parse(r);
        return { service: check.service, status, ok: status === 'ok' };
      } catch {
        return { service: check.service, status: 'unreachable', ok: false };
      }
    })
  );
  return results.map(r =>
    r.status === 'fulfilled' ? r.value : { service: 'unknown', status: 'error', ok: false }
  );
}

// ── Intent detection ──────────────────────────────────────────────────────────
async function detectIntent(message: string): Promise<'support' | 'sales' | 'other'> {
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 10,
      system: INTENT_DETECTION_PROMPT,
      messages: [{ role: 'user', content: message }],
    });
    const text = (response.content.find(b => b.type === 'text') as any)?.text?.trim().toLowerCase() || 'other';
    if (text.includes('support')) return 'support';
    if (text.includes('sales'))   return 'sales';
  } catch (e: any) {
    console.warn('[SkedAI] Intent detection failed:', e.message);
  }
  return 'other';
}

// ── Conversation runner ───────────────────────────────────────────────────────
async function runConversation(
  systemPrompt: string,
  history: Anthropic.MessageParam[],
  newMessage: string,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: newMessage },
  ];
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages,
  });
  const textBlock = response.content.find(b => b.type === 'text') as any;
  return textBlock?.text || "Thanks for reaching out! Our team will be with you shortly.";
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function runSkedAIAgent(
  message: string,
  phone: string,
  _tenantId: string,
): Promise<string> {
  const now = format(new Date(), "EEEE d MMMM yyyy, HH:mm");
  console.log(`[SkedAI] ${now} — message from ${phone}: "${message.slice(0, 80)}"`);

  try {
    const session = await getSession(phone);
    const isFirstMessage = session.messages.length === 0;

    // Determine or recall route
    let route = session.route;
    if (!route) {
      route = await detectIntent(message);
      console.log(`[SkedAI] Intent → ${route}`);
    }

    // Build Anthropic history from session
    const history: Anthropic.MessageParam[] = session.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    let reply = '';

    if (route === 'support') {
      // Health checks + agent response in parallel
      const [healthResults, agentReply] = await Promise.all([
        runHealthChecks(),
        runConversation(SUPPORT_SYSTEM_PROMPT, history, message),
      ]);
      reply = agentReply;
      await notifySupportRequest(phone, message, healthResults);

    } else if (route === 'sales') {
      reply = await runConversation(SALES_SYSTEM_PROMPT, history, message);

      // Notify on first message (new lead)
      if (isFirstMessage) {
        await notifySalesLead(phone, message, 'new inquiry');
      }

      // Extra notification when demo is requested
      const demoKeywords = ['demo', 'demonstrate', 'show me', 'try it', 'test', 'book a demo', 'schedule'];
      if (demoKeywords.some(k => message.toLowerCase().includes(k))) {
        await notifySalesLead(phone, message, 'demo request');
      }

    } else {
      // Unclear intent — gentle re-orientation, reset route so next message re-detects
      reply = "Hi! I'm the SkedAI assistant. I can help you with a support issue or tell you about SkedAI. What can I help you with?";
      route = null;
    }

    // Persist session
    await saveSession(phone, {
      route,
      messages: [
        ...session.messages,
        { role: 'user',      content: message, ts: new Date().toISOString() },
        { role: 'assistant', content: reply,   ts: new Date().toISOString() },
      ],
    });

    return reply;

  } catch (err: any) {
    console.error('[SkedAI Agent Error]', err?.message ?? err);
    return "Sorry, I'm having a moment. Please try again or email support@skedai.net";
  }
}
