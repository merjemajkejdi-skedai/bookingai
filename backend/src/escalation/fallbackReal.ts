// Human-in-the-loop escalation — real dependencies for the timeout fallback (stage 6).
import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db/database.js';
import { getModelForTenant } from '../utils/modelForTenant.js';
import { createFallback, NOTICE_SYSTEM, buildNoticePrompt, chooseNotice, type FallbackDeps, type FallbackRow } from './fallback.js';
import { loadContext } from './relayReal.js';
import { deliverToGuest, appendRelayedToHistory } from './relayDeliver.js';
import { createHotelFallbackRequest } from '../hotel/escalationFallback.js';

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

async function composeNotice(row: FallbackRow, recent: { role: string; content: string }[]): Promise<string | null> {
  try {
    const response = await client.messages.create({
      model: await getModelForTenant(row.tenant_id),
      max_tokens: 200,
      system: NOTICE_SYSTEM,
      messages: [{ role: 'user', content: buildNoticePrompt(row.guest_question, recent) }],
    });
    const block = response.content.find(b => b.type === 'text');
    return block && block.type === 'text' ? block.text : null;
  } catch (e: any) {
    console.warn('[Escalation fallback] could not write the guest note, using the default:', e.message);
    return null;
  }
}

const realDeps: FallbackDeps = {
  async createRequest(row) {
    if (row.tenant_type === 'hotel') return createHotelFallbackRequest(row);
    throw new Error(`no normal-request fallback for tenant type ${row.tenant_type} yet`);
  },

  async notifyGuest(row) {
    const ctx = await loadContext(row.id, false);
    if (!ctx) throw new Error('conversation not found');
    const sources = [row.guest_question, ...ctx.conversation.recent.map(m => m.content)];
    const text = chooseNotice(await composeNotice(row, ctx.conversation.recent), sources);
    await deliverToGuest(ctx, text);
    try { await appendRelayedToHistory(ctx, text); }
    catch (e: any) { console.warn('[Escalation fallback] note sent, but not stored in conversation history:', e.message); }
  },

  async recordError(escalationId, error) {
    await query(`UPDATE staff_escalations SET fallback_error = ? WHERE id = ? RETURNING id`, [error, escalationId]);
  },
};

export const runFallback = createFallback(realDeps);
