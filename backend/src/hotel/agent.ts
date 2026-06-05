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
  mediaUrl:  string | null = null,  // photo sent by guest (Twilio MediaUrl0)
  mediaMime: string | null = null,  // MIME type e.g. "image/jpeg"
): Promise<string> {

  // Safety guard — ensure the message is never empty so Claude never
  // receives an empty user content block (Anthropic returns 400 if it does)
  const safeMessage = customerMessage.trim()
    || (mediaUrl ? '[Guest sent a photo]' : '[Empty message]');

  // ── PAUSE CHECK — must be first (before staff handler, survey, everything) ─
  // Staff can pause AI per conversation via the dashboard. While paused,
  // the agent returns '' so the webhook sends nothing.
  try {
    const pausedRow = await dbGet(
      `SELECT ai_paused_until FROM hotel_conversations
       WHERE tenant_id = ? AND guest_phone = ? LIMIT 1`,
      tenantId, customerPhone,
    ) as any;

    if (pausedRow?.ai_paused_until && new Date(pausedRow.ai_paused_until) > new Date()) {
      console.log(`[Hotel] ⏸ AI paused for ${customerPhone} until ${pausedRow.ai_paused_until}`);
      return ''; // webhook guard `if (!reply) return;` prevents sending
    }
  } catch (e: any) {
    console.warn('[Hotel] pause check failed:', e.message);
  }

  // ── GUARD 1: Staff / blocked numbers ─────────────────────────────────────
  // Numbers on the hotel_blocked_numbers list are staff. Route their messages
  // to the staff handler (status updates, notes) instead of the guest AI.
  // Return '' so webhook sends nothing — staffHandler sends its own reply.
  try {
    const normalised = customerPhone.startsWith('whatsapp:')
      ? customerPhone : `whatsapp:${customerPhone}`;

    const blocked = await dbAll(
      `SELECT * FROM hotel_blocked_numbers
       WHERE tenant_id = ? AND (phone = ? OR phone = ?)`,
      tenantId, customerPhone, normalised,
    ) as any[];

    if (blocked.length > 0) {
      const staffMember = blocked[0] as any;
      console.log(`[Hotel] 📱 Staff message from ${staffMember.staff_name || staffMember.phone} — routing to staff handler`);
      try {
        const { handleStaffMessage } = await import('./staffHandler.js');
        await handleStaffMessage({
          message:   safeMessage,
          staffPhone: customerPhone,
          staffName:  staffMember.staff_name ?? null,
          staffRole:  staffMember.staff_role  ?? null,
          tenantId,
        });
      } catch (e: any) {
        console.error('[Hotel] Staff handler error:', e.message);
      }
      return ''; // staffHandler handles the WhatsApp reply
    }
  } catch (e: any) {
    console.warn('[Hotel] blocklist check failed:', e.message);
  }

  // ── Load config + history (needed for both survey detection and main loop) ──
  const [tenantRow, hotelConfig, hotelHistory] = await Promise.all([
    dbGet('SELECT id, name, whatsapp_number, provider, twilio_account_sid, twilio_auth_token FROM tenants WHERE id = ?', tenantId),
    dbGet('SELECT * FROM hotel_config WHERE tenant_id = ?', tenantId),
    getHotelHistory(tenantId, customerPhone),
  ]);

  // ── SURVEY REPLY DETECTION ───────────────────────────────────────────────
  // If this guest has a pending survey (checked_out, survey_sent, no score yet),
  // intercept numeric replies. Non-numeric replies get ONE nudge, then we fall
  // through so Claude can answer their actual question normally.
  try {
    const surveyGuest = await dbGet(
      `SELECT * FROM hotel_guest_stays
       WHERE tenant_id = ? AND guest_phone = ?
         AND status = 'checked_out' AND survey_sent = 1 AND survey_score IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      tenantId, customerPhone,
    ) as any;

    if (surveyGuest) {
      const score = extractRating(safeMessage);
      if (score !== null) {
        console.log(`[Hotel] 📋 Survey reply ${score}/10 from ${customerPhone}`);
        return await processSurveyReply(score, surveyGuest, tenantId, customerPhone);
      }

      // Non-numeric message — check if we've already nudged them
      const NUDGE = 'Thank you! Could you please reply with a number between 1 and 10 to rate your stay? 😊';
      const alreadyNudged = hotelHistory.some(
        m => m.role === 'assistant' && m.content.includes('reply with a number between 1 and 10'),
      );

      if (!alreadyNudged) {
        console.log(`[Hotel] 📋 Sending survey nudge to ${customerPhone}`);
        // Save nudge to history so we don't repeat it next message
        await saveHotelConversation(tenantId, customerPhone, safeMessage, NUDGE, null);
        return NUDGE;
      }

      // Already nudged — fall through to the normal Claude agent so the
      // guest's actual question gets answered
      console.log(`[Hotel] 📋 Survey pending but already nudged — passing to agent`);
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

  // Build Anthropic messages from hotel history (strip ts — not part of API format)
  const anthropicHistory: Anthropic.MessageParam[] = hotelHistory
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  // If the guest sent a photo, append context so Claude knows the URL and can
  // pass it directly to create_request without making up a value
  let userMessageContent = safeMessage;
  if (mediaUrl) {
    userMessageContent = `${safeMessage}\n\n[Guest also sent a photo: ${mediaUrl} (${mediaMime || 'image'})]`;
  }

  const messages: Anthropic.MessageParam[] = [
    ...anthropicHistory,
    { role: 'user', content: userMessageContent },
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
        const msgMatch = safeMessage.match(/\b(\d{2,4})\b/);
        if (msgMatch) roomNumber = msgMatch[1];
      } else {
        roomNumber = roomMatch[1];
      }
    } catch { /* best-effort */ }

    // Send any menu files that were returned by the get_menu tool
    try {
      const { sendWhatsAppMedia } = await import('../whatsapp/twilio.js');
      for (const msg of messages) {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          for (const block of msg.content as any[]) {
            if (block.type === 'tool_result') {
              try {
                const result = JSON.parse(block.content as string);
                if (result.found && Array.isArray(result.menus)) {
                  for (const menu of result.menus) {
                    if (menu.has_file && menu.file_url) {
                      await sendWhatsAppMedia(
                        customerPhone,
                        menu.file_url,
                        menu.file_type === 'pdf' ? `Here is our ${menu.name} 📄` : '',
                        tenantRow,
                      );
                    }
                  }
                }
              } catch { /* ignore parse errors */ }
            }
          }
        }
      }
    } catch (e: any) {
      console.warn('[Hotel] menu file send failed:', e.message);
    }

    await saveHotelConversation(tenantId, customerPhone, safeMessage, reply, roomNumber);

    return reply;
  }
}
