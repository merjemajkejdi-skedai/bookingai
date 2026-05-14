import Anthropic from '@anthropic-ai/sdk';
import { hotelTools, executeHotelTool } from './tools.js';
import { buildHotelSystemPrompt } from './prompts.js';
import { isPg, prepare, query, queryOne } from '../db/database.js';
import { getHotelHistory, saveHotelConversation } from './session.js';

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}
async function dbAll(sql: string, ...p: unknown[]) {
  return isPg ? query(sql, p) : prepare(sql).all(...p);
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

  // GUARD 2: Guest check — temporarily disabled
  // To re-enable: uncomment the block below
  /*
  try {
    const anyGuests = await dbAll(
      `SELECT 1 FROM hotel_guest_stays WHERE tenant_id = ? LIMIT 1`,
      tenantId,
    ) as any[];

    if (anyGuests.length > 0) {
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

  // ── Claude tool-use loop ──────────────────────────────────────────────────
  while (true) {
    const response = await client.messages.create({
      model: SONNET_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools: hotelTools,
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
