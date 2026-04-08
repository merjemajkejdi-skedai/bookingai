// SkedAI agent — handles sales and support conversations on a dedicated WhatsApp number.
// Returns a reply string; the webhook handles sending it back to the customer.

import Anthropic from '@anthropic-ai/sdk';
import { format } from 'date-fns';
import { isPg, prepare, query, queryOne } from '../db/database.js';
import { getSession, saveSession } from './session.js';
import {
  INTENT_DETECTION_PROMPT,
  buildSupportPrompt,
  buildSalesPrompt,
} from './prompts.js';
import {
  notifySupportRequest,
  notifySalesLead,
  type ServiceStatus,
} from './notify.js';

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}

async function loadConfig(tenantId: string) {
  try {
    const row = await dbGet('SELECT * FROM skedai_config WHERE tenant_id = ?', tenantId) as any;
    if (!row) return null;
    const parse = (v: any, fb: unknown) => { try { return JSON.parse(v || '[]'); } catch { return fb; } };
    return {
      forwardPhone:    row.forward_phone    || '',
      calendlyUrl:     row.calendly_url     || '',
      supportFaq:      parse(row.support_faq,       []),
      healthCheckUrls: parse(row.health_check_urls, []),
      industries:      parse(row.industries,        []),
    };
  } catch { return null; }
}

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const MODEL   = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// ── Health checks (uses DB config + Twilio built-in) ──────────────────────────
async function runHealthChecks(configChecks: Array<{name:string;url:string}>): Promise<ServiceStatus[]> {
  // Merge DB-configured checks with the built-in Twilio check
  const allChecks = [
    ...configChecks.map(c => ({
      service: c.name,
      url: c.url,
      headers: {} as Record<string, string>,
      parse: async (r: Response) => {
        try { const d = await r.json(); return (d.status === 'ok' || d.ok) ? 'ok' : 'degraded'; }
        catch { return r.ok ? 'ok' : `http ${r.status}`; }
      },
    })),
    {
      service: 'Twilio',
      url: `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}.json`,
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
        ).toString('base64')}`,
      } as Record<string, string>,
      parse: async (r: Response) => r.ok ? 'ok' : `http ${r.status}`,
    },
  ];

  const results = await Promise.allSettled(
    allChecks.map(async (check) => {
      try {
        const r = await fetch(check.url, {
          headers: check.headers,
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
  tenantId: string,
): Promise<string> {
  const now = format(new Date(), "EEEE d MMMM yyyy, HH:mm");
  console.log(`[SkedAI] ${now} — message from ${phone}: "${message.slice(0, 80)}"`);

  try {
    // Load DB config (falls back gracefully if table/row not found)
    const config = await loadConfig(tenantId);
    const overridePhone = config?.forwardPhone || '';

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
      const supportPrompt = buildSupportPrompt(config?.supportFaq || []);
      // Health checks + agent response in parallel
      const [healthResults, agentReply] = await Promise.all([
        runHealthChecks(config?.healthCheckUrls || []),
        runConversation(supportPrompt, history, message),
      ]);
      reply = agentReply;
      await notifySupportRequest(phone, message, healthResults, overridePhone);

    } else if (route === 'sales') {
      const salesPrompt = buildSalesPrompt(config?.industries || [], config?.calendlyUrl || '');
      reply = await runConversation(salesPrompt, history, message);

      // Notify on first message (new lead)
      if (isFirstMessage) {
        await notifySalesLead(phone, message, 'new inquiry', undefined, overridePhone);
      }

      // Extra notification when demo is requested
      const demoKeywords = ['demo', 'demonstrate', 'show me', 'try it', 'test', 'book a demo', 'schedule'];
      if (demoKeywords.some(k => message.toLowerCase().includes(k))) {
        await notifySalesLead(phone, message, 'demo request', undefined, overridePhone);
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
