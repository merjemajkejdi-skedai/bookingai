import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { buildShopSystemPrompt } from './prompts.js';
import { shopTools, executeShopTool } from './tools.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

async function dbGet(sql: string, ...p: unknown[]) { return (isPg ? queryOne(sql, p) : prepare(sql).get(...p)) as any; }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

export async function runShopAgent(
  message: string,
  guestPhone: string,
  tenantId: string,
): Promise<string> {
  console.log('[Shop] *** runShopAgent called, tenantId:', tenantId, 'phone:', guestPhone);
  console.log(`[Shop] runShopAgent tenantId=${tenantId} phone=${guestPhone}`);
  console.log('[Shop] tools loaded:', shopTools.map(t => t.name));

  const [config, tenant] = await Promise.all([
    dbGet(`SELECT * FROM shop_config WHERE tenant_id = ?`, tenantId),
    dbGet(`SELECT * FROM tenants WHERE id = ?`, tenantId),
  ]);

  // Load or create conversation record
  let conv = await dbGet(
    `SELECT * FROM shop_conversations WHERE tenant_id = ? AND guest_phone = ?`,
    tenantId, guestPhone,
  );

  if (!conv) {
    const convId = crypto.randomUUID();
    const now = new Date().toISOString();
    await dbRun(
      `INSERT INTO shop_conversations (id, tenant_id, guest_phone, messages, cart, cart_state, created_at, updated_at) VALUES (?,?,?,'[]','[]','idle',?,?)`,
      convId, tenantId, guestPhone, now, now,
    );
    conv = { id: convId, messages: '[]' };
    console.log(`[Shop] created conversation ${convId} for ${guestPhone}`);
  }

  // Parse stored history
  const storedMessages: Array<{ role: string; content: string }> = (() => {
    try { return JSON.parse(conv.messages || '[]'); } catch { return []; }
  })();

  const history: Anthropic.MessageParam[] = storedMessages
    .slice(-10)
    .filter((m: any) => m.content && m.content.trim())
    .map((m: any) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  history.push({ role: 'user', content: message });

  const systemPrompt = buildShopSystemPrompt(tenant, config);
  const messages = [...history];
  let finalReply = '';

  // Agentic tool-use loop
  while (true) {
    console.log('[Shop] calling Claude with', shopTools.length, 'tools, messages:', messages.length);
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      tools: shopTools,
      tool_choice: { type: 'auto' },
      messages,
    });

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        try {
          const result = await executeShopTool(block.name, block.input as any, tenantId, guestPhone);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
        } catch (toolErr: any) {
          console.error(`[Shop] tool ${block.name} threw:`, toolErr.message);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ error: toolErr.message, success: false }),
            is_error: true,
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    for (const block of response.content) {
      if (block.type === 'text') finalReply += block.text;
    }
    break;
  }

  // Persist conversation — keep last 40 messages (~20 turns) to avoid unbounded growth
  const updatedHistory = [
    ...storedMessages,
    { role: 'user', content: message },
    { role: 'assistant', content: finalReply },
  ].slice(-40);

  await dbRun(
    `UPDATE shop_conversations SET messages = ?, updated_at = ? WHERE tenant_id = ? AND guest_phone = ?`,
    JSON.stringify(updatedHistory), new Date().toISOString(), tenantId, guestPhone,
  );

  return finalReply;
}
