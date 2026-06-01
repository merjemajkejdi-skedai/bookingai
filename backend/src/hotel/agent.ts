import Anthropic from '@anthropic-ai/sdk';
import { hotelTools, executeHotelTool } from './tools.js';
import { buildHotelSystemPrompt } from './prompts.js';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { getHotelHistory, saveHotelConversation } from './session.js';

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}
async function dbAll(sql: string, ...p: unknown[]) {
  return isPg ? query(sql, p) : prepare(sql).all(...p);
}
async function dbRun(sql: string, ...p: unknown[]) {
  if (isPg) return queryRun(sql, p);
  prepare(sql).run(...p);
}

// ---------------------------------------------------------------------------
// Survey helpers
// ---------------------------------------------------------------------------

/** Extract a 1-10 rating from a guest reply. Returns null if unparseable. */
function extractRating(message: string): number | null {
  const cleaned = message.trim().replace(/[^0-9]/g, '');
  if (cleaned) {
    const n = parseInt(cleaned, 10);
    if (n >= 1 && n <= 10) return n;
  }
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  return words[message.toLowerCase().trim()] ?? null;
}

/**
 * Process a confirmed survey rating reply.
 * Saves score, sends the right message, alerts manager for low scores.
 * Returns the reply string to send to the guest.
 */
async function processSurveyReply(
  score: number,
  guest: any,
  tenantId: string,
  customerPhone: string,
): Promise<string> {
  const config = await dbGet('SELECT * FROM hotel_config WHERE tenant_id = ?', tenantId) as any;

  const threshold   = Number(config?.survey_positive_threshold) || 8;
  const reviewUrl   = config?.review_platform_url ?? null;
  const reviewName  = config?.review_platform_name ?? 'Booking.com';
  const positiveMsg = config?.survey_positive_message
    ?? 'We are so glad you enjoyed your stay! It would mean the world to us if you could share your experience online.';
  const negativeMsg = config?.survey_negative_message
    ?? 'We are truly sorry your experience did not meet your expectations. Your feedback is very important to us and we will use it to improve.';

  const isPositive = score >= threshold;
  const now        = new Date().toISOString();

  // Persist score on the stay
  await dbRun(
    `UPDATE hotel_guest_stays
     SET survey_score = ?, survey_replied_at = ?
     WHERE tenant_id = ? AND guest_phone = ? AND status = 'checked_out' AND survey_sent = 1`,
    score, now, tenantId, customerPhone,
  );

  // Save to hotel_reviews — source = 'whatsapp_survey'
  await dbRun(
    `INSERT INTO hotel_reviews
       (id, tenant_id, source, reviewer_name, score, score_max, full_review_text,
        language, status, is_flagged, sentiment_score, flag_reason, owner_notified)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    crypto.randomUUID(), tenantId, 'whatsapp_survey',
    guest.guest_name || 'Guest',
    score, 10,
    `WhatsApp survey: ${score}/10`,
    'en', 'pending',
    isPositive ? 0 : 1,
    score,
    isPositive ? null : `Low survey score: ${score}/10 from ${guest.guest_name ?? 'guest'}`,
    1, // owner_notified = 1 — we handle the alert ourselves below, avoid digest duplicate
  );

  // Build guest reply
  let reply: string;
  if (isPositive) {
    reply = [
      `Thank you so much for your wonderful rating of *${score}/10*! 🌟`,
      ``,
      positiveMsg,
      ``,
      reviewUrl
        ? `👉 Leave us a review on ${reviewName}:\n${reviewUrl}`
        : `We hope to welcome you back very soon!`,
    ].join('\n');
  } else {
    reply = [
      `Thank you for your honest feedback — you rated your stay *${score}/10*.`,
      ``,
      negativeMsg,
      ``,
      `We truly hope to have the opportunity to welcome you back and show you a much better experience. 🙏`,
    ].join('\n');

    // Alert the manager via WhatsApp
    try {
      const tenant = await dbGet('SELECT * FROM tenants WHERE id = ?', tenantId) as any;
      if (tenant?.owner_phone) {
        const { sendWhatsAppMessage } = await import('../whatsapp/twilio.js');
        const alert = [
          `⚠️ *Low satisfaction score*`,
          ``,
          `Guest: ${guest.guest_name ?? 'Unknown'}`,
          `Room: ${guest.room_number ?? 'Unknown'}`,
          `Score: ${score}/10`,
          `Phone: ${customerPhone}`,
          ``,
          `Consider reaching out personally to resolve their concerns.`,
        ].join('\n');
        await sendWhatsAppMessage(tenant.owner_phone, alert, tenant)
          .catch((e: any) => console.error('[Survey] Failed to alert manager:', e.message));
      }
    } catch (e: any) {
      console.warn('[Survey] manager alert failed:', e.message);
    }
  }

  // Log the exchange in hotel_conversations
  await saveHotelConversation(tenantId, customerPhone, String(score), reply, guest.room_number ?? null);

  return reply;
}

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const SONNET_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// ---------------------------------------------------------------------------
// runHotelAgent
// Returns '' (empty string) for blocked numbers or non-guests → webhook
// will detect the empty reply and stay silent (no Twilio message sent).
// ---------------------------------------------------------------------------
export async function runHotelAgent(
  customerMessage: string,
  _conversationHistory: Anthropic.MessageParam[], // ignored — we load from DB
  customerPhone: string,
  tenantId: string,
): Promise<string> {

  // ── GUARD 1: Blocked numbers ──────────────────────────────────────────────
  // Hotel admin can block staff/supplier numbers so the AI stays silent
  try {
    const normalised = customerPhone.startsWith('whatsapp:')
      ? customerPhone : `whatsapp:${customerPhone}`;

    const blocked = await dbAll(
      `SELECT 1 FROM hotel_blocked_numbers
       WHERE tenant_id = ? AND (phone = ? OR phone = ?)`,
      tenantId, customerPhone, normalised,
    ) as any[];

    if (blocked.length > 0) {
      console.log(`[Hotel] 🚫 Blocked number ${customerPhone} — staying silent`);
      return '';
    }
  } catch (e: any) {
    console.warn('[Hotel] blocklist check failed:', e.message);
  }

  // ── SURVEY REPLY DETECTION ───────────────────────────────────────────────
  // Runs BEFORE the main agent loop. If this guest has a pending survey
  // (checked_out, survey_sent, no score yet), intercept and process the reply.
  try {
    const surveyGuest = await dbGet(
      `SELECT * FROM hotel_guest_stays
       WHERE tenant_id = ? AND guest_phone = ?
         AND status = 'checked_out' AND survey_sent = 1 AND survey_score IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      tenantId, customerPhone,
    ) as any;

    if (surveyGuest) {
      const score = extractRating(customerMessage);
      if (score !== null) {
        console.log(`[Hotel] 📋 Survey reply ${score}/10 from ${customerPhone}`);
        return await processSurveyReply(score, surveyGuest, tenantId, customerPhone);
      }
      // Guest replied but not a number — nudge them
      return 'Thank you! Could you please reply with a number between 1 and 10 to rate your stay? 😊';
    }
  } catch (e: any) {
    console.warn('[Hotel] survey detection failed:', e.message);
  }

  // ── GUARD 2: Guest check — temporarily disabled ──────────────────────────
  // To re-enable: uncomment the block below
  /*
  try {
    const anyGuests = await dbAll(
      `SELECT 1 FROM hotel_guest_stays WHERE tenant_id = ? LIMIT 1`,
      tenantId,
    ) as any[];

    if (anyGuests.length > 0) {
      // Hotel has guests loaded — enforce check-in guard
      const normalised = customerPhone.startsWith('+')
        ? customerPhone : `+${customerPhone}`;

      const guest = await dbGet(
        `SELECT id FROM hotel_guest_stays
         WHERE tenant_id = ? AND (guest_phone = ? OR guest_phone = ?)
           AND status = 'checked_in' LIMIT 1`,
        tenantId, customerPhone, normalised,
      ) as any;

      if (!guest) {
        console.log(`[Hotel] 🔕 Non-guest ${customerPhone} — staying silent`);
        return '';
      }
    }
  } catch (e: any) {
    console.warn('[Hotel] guest guard check failed:', e.message);
  }
  */

  // ── Load config + history ─────────────────────────────────────────────────
  const [tenantRow, hotelConfig, hotelHistory] = await Promise.all([
    dbGet('SELECT id, name FROM tenants WHERE id = ?', tenantId),
    dbGet('SELECT * FROM hotel_config WHERE tenant_id = ?', tenantId),
    getHotelHistory(tenantId, customerPhone),
  ]);

  // Build Anthropic messages from hotel history (strip ts — not part of API format)
  const anthropicHistory: Anthropic.MessageParam[] = hotelHistory
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const messages: Anthropic.MessageParam[] = [
    ...anthropicHistory,
    { role: 'user', content: customerMessage },
  ];

  const systemPrompt = buildHotelSystemPrompt(tenantRow, hotelConfig);

  // When message_forward is OFF, the agent only reads FAQ/config — never creates requests
  const messageForward = (hotelConfig as any)?.message_forward !== 0;
  const activeTools    = messageForward
    ? hotelTools
    : hotelTools.filter(t => t.name !== 'create_request');

  // ── Claude tool-use loop ──────────────────────────────────────────────────
  while (true) {
    const response = await client.messages.create({
      model: SONNET_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools: activeTools,
      messages,
    });

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`🏨 Hotel tool: ${block.name}`, JSON.stringify(block.input).slice(0, 100));
          const result = await executeHotelTool(
            block.name,
            block.input as Record<string, unknown>,
            tenantId,
            customerPhone,
          );
          console.log(`✅ Hotel tool result:`, JSON.stringify(result).slice(0, 100));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    const textBlock = response.content.find(b => b.type === 'text');
    const reply = textBlock?.type === 'text'
      ? textBlock.text
      : 'I will connect you with our reception team right away.';

    // ── Persist conversation to DB ──────────────────────────────────────────
    // Try to extract room number from conversation for the inbox display
    let roomNumber: string | null = null;
    try {
      const roomMatch = reply.match(/[Rr]oom\s+(\d+)/);
      if (!roomMatch) {
        const msgMatch = customerMessage.match(/\b(\d{2,4})\b/);
        if (msgMatch) roomNumber = msgMatch[1];
      } else {
        roomNumber = roomMatch[1];
      }
    } catch { /* best-effort */ }

    await saveHotelConversation(tenantId, customerPhone, customerMessage, reply, roomNumber);

    return reply;
  }
}
