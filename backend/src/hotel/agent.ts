import Anthropic from '@anthropic-ai/sdk';
import { hotelTools, executeHotelTool } from './tools.js';
import { buildHotelSystemPrompt } from './prompts.js';
import { isPg, prepare, queryOne } from '../db/database.js';

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const SONNET_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

async function getCheckedInGuest(tenantId: string, phone: string) {
  return dbGet(
    `SELECT room_number, guest_name, check_in, check_out
     FROM hotel_guest_stays
     WHERE tenant_id = ? AND guest_phone = ? AND status = 'checked_in' LIMIT 1`,
    tenantId, phone,
  ) as Promise<any>;
}

// ---------------------------------------------------------------------------
// runHotelAgent — matches the signature of other module agents so it plugs
// into the existing webhook dispatcher without any structural changes.
// ---------------------------------------------------------------------------
export async function runHotelAgent(
  customerMessage: string,
  conversationHistory: Anthropic.MessageParam[],
  customerPhone: string,
  tenantId: string,
): Promise<string> {
  const [guest, tenantRow] = await Promise.all([
    getCheckedInGuest(tenantId, customerPhone),
    dbGet('SELECT id, name FROM tenants WHERE id = ?', tenantId),
  ]);

  const messages: Anthropic.MessageParam[] = [
    ...conversationHistory,
    { role: 'user', content: customerMessage },
  ];

  const systemPrompt = buildHotelSystemPrompt(tenantRow, guest);

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
    return textBlock?.type === 'text'
      ? textBlock.text
      : 'I will connect you with our reception team right away.';
  }
}
