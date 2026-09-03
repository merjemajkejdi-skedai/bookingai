import Anthropic from '@anthropic-ai/sdk';
import { getGbTools, executeGbTool } from './tools.js';
import { buildGbSystemPrompt } from './prompts.js';
import { getGbHistory, saveGbConversation, saveGbGuestMessage } from './session.js';
import { isPg, prepare, queryOne } from '../db/database.js';
import { alertError } from '../utils/errorMonitor.js';

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const SONNET_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

export async function runGbAgent(
  customerMessage: string,
  _conversationHistory: Anthropic.MessageParam[],
  customerPhone: string,
  tenantId: string,
): Promise<string> {
  const safeMessage = customerMessage.trim() || '[Empty message]';

  // Pause check
  try {
    const pausedRow = await dbGet(
      'SELECT ai_paused_until FROM gb_conversations WHERE tenant_id = ? AND guest_phone = ? LIMIT 1',
      tenantId, customerPhone,
    ) as any;
    if (pausedRow?.ai_paused_until && new Date(pausedRow.ai_paused_until) > new Date()) {
      console.log(`[GB] ⏸ AI paused for ${customerPhone}`);
      await saveGbGuestMessage(tenantId, customerPhone, safeMessage);
      return '';
    }
  } catch (e: any) {
    console.warn('[GB] pause check failed:', e.message);
  }

  // Save guest message immediately for dashboard visibility
  await saveGbGuestMessage(tenantId, customerPhone, safeMessage);

  // Load config + history
  const [tenant, config, gbHistory] = await Promise.all([
    dbGet('SELECT * FROM tenants WHERE id = ?', tenantId),
    dbGet('SELECT * FROM gb_business_config WHERE tenant_id = ?', tenantId),
    getGbHistory(tenantId, customerPhone),
  ]);

  const aiEnabled = (config as any)?.ai_enabled !== false && (config as any)?.ai_enabled !== 0;
  if (!aiEnabled) {
    console.log(`[GB] AI disabled for tenant ${tenantId}`);
    return '';
  }

  const menuEnabled = !!(tenant as any)?.menu_enabled;
  const systemPrompt = await buildGbSystemPrompt(tenantId);
  const tools = getGbTools(menuEnabled);

  const anthropicHistory: Anthropic.MessageParam[] = gbHistory
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const messages: Anthropic.MessageParam[] = [
    ...anthropicHistory,
    { role: 'user', content: safeMessage },
  ];

  try {
    while (true) {
      const response = await client.messages.create({
        model: SONNET_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages,
      });

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            console.log(`[GB] 🔧 Tool: ${block.name}`, JSON.stringify(block.input).slice(0, 100));
            const result = await executeGbTool(
              block.name, block.input, tenantId, customerPhone,
            );
            console.log(`[GB] ✅ Result:`, result.slice(0, 100));
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result,
            });
          }
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      const textBlock = response.content.find(b => b.type === 'text');
      const reply = textBlock?.type === 'text'
        ? textBlock.text
        : 'I will connect you with our team right away.';

      await saveGbConversation(tenantId, customerPhone, safeMessage, reply);
      return reply;
    }
  } catch (e: any) {
    alertError(e, 'gbAgent');
    console.error('[GB] Agent error:', e.message);
    const fallbackMsg = (config as any)?.fallback_message
      || 'Sorry, I am temporarily unavailable. Please try again shortly.';
    return fallbackMsg;
  }
}
