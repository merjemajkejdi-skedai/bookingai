import Anthropic from '@anthropic-ai/sdk';
import { airbnbTools, executeAirbnbTool } from './tools.js';
import { buildAirbnbSystemPrompt, buildAirbnbOnboardingPrompt } from './prompts.js';
import {
  getOrCreateConversation,
  getAirbnbHistory,
  saveAirbnbGuestMessage,
  saveAirbnbConversation,
} from './session.js';
import { isPg, prepare, queryOne } from '../db/database.js';
import { alertError } from '../utils/errorMonitor.js';
import { RaceState, sendLateFollowUp } from '../whatsapp/raceState.js';
import { logAgentError } from '../monitoring/logAgentError.js';

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const SONNET_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// ---------------------------------------------------------------------------
// runAirbnbAgent — independent implementation, no shared code with
// runHotelAgent. A host's channels are shared across every listing they own,
// so identity here is (tenant_id, channel, channel_user_id) rather than a
// hotel-style per-property phone number, and the conversation only becomes
// listing-aware once identify_listing resolves a match.
// ---------------------------------------------------------------------------
export async function runAirbnbAgent(
  customerMessage: string,
  _conversationHistory: Anthropic.MessageParam[], // ignored — loaded from DB, same convention as other agents
  channelUserId: string,
  tenantId: string,
  channel: string = 'whatsapp',
  raceState?: RaceState,
): Promise<string> {
  const safeMessage = customerMessage.trim() || '[Empty message]';

  const conv = await getOrCreateConversation(tenantId, channel, channelUserId);

  // Pause check — must be first, mirrors every other agent's takeover guard.
  if (conv.ai_paused_until && new Date(conv.ai_paused_until) > new Date()) {
    console.log(`[Airbnb] ⏸ AI paused for ${channelUserId}`);
    await saveAirbnbGuestMessage(conv.id, safeMessage);
    return '';
  }

  // Save guest message immediately for dashboard visibility.
  await saveAirbnbGuestMessage(conv.id, safeMessage);

  const [tenant, listing, history] = await Promise.all([
    dbGet('SELECT * FROM tenants WHERE id = ?', tenantId),
    conv.listing_id
      ? dbGet('SELECT * FROM airbnb_listings WHERE id = ? AND tenant_id = ?', conv.listing_id, tenantId)
      : Promise.resolve(null),
    getAirbnbHistory(conv.id),
  ]) as [any, any, Awaited<ReturnType<typeof getAirbnbHistory>>];

  const anthropicHistory: Anthropic.MessageParam[] = history
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const messages: Anthropic.MessageParam[] = [
    ...anthropicHistory,
    { role: 'user', content: safeMessage },
  ];

  // No listing identified yet (or it was deleted/deactivated since) — run the
  // narrow onboarding prompt whose only job is to identify the listing.
  const systemPrompt = listing
    ? buildAirbnbSystemPrompt(tenant, listing)
    : buildAirbnbOnboardingPrompt(tenant);

  try {
    while (true) {
      const response = await client.messages.create({
        model: SONNET_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        tools: airbnbTools,
        messages,
      });

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            console.log(`[Airbnb] 🔧 Tool: ${block.name}`, JSON.stringify(block.input).slice(0, 100));
            const result = await executeAirbnbTool(block.name, block.input, tenantId, conv.id);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
          }
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      const textBlock = response.content.find(b => b.type === 'text');
      const reply = textBlock?.type === 'text'
        ? textBlock.text
        : "I'll get the host to follow up with you shortly.";

      await saveAirbnbConversation(conv.id, safeMessage, reply);
      await sendLateFollowUp(raceState, channelUserId, reply);
      return reply;
    }
  } catch (e: any) {
    alertError(e, 'runAirbnbAgent', { tenantId, channelUserId, channel });
    console.error('[Airbnb] Agent error:', e.message);
    logAgentError(tenantId, 'airbnb', e?.message ?? String(e));
    return "Sorry, I'm temporarily unavailable. The host will follow up with you shortly.";
  }
}
