// Human-in-the-loop escalation — real dependencies for the timeout fallback (stage 6).
import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db/database.js';
import { getModelForTenant } from '../utils/modelForTenant.js';
import { createFallback, NOTICE_SYSTEM, SHOP_NOTICE_SYSTEM, buildNoticePrompt, chooseNotice, buildShopNotice, type FallbackDeps, type FallbackRow } from './fallback.js';
import { loadContext } from './relayReal.js';
import { deliverToGuest, appendRelayedToHistory } from './relayDeliver.js';
import { createHotelFallbackRequest } from '../hotel/escalationFallback.js';
import { createGbFallbackRequest } from '../generalBusiness/escalationFallback.js';
import { createAirbnbFallbackRequest } from '../airbnb/escalationFallback.js';

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

async function composeNotice(row: FallbackRow, recent: { role: string; content: string }[], system: string = NOTICE_SYSTEM): Promise<string | null> {
  try {
    const response = await client.messages.create({
      model: await getModelForTenant(row.tenant_id),
      max_tokens: 200,
      system,
      messages: [{ role: 'user', content: buildNoticePrompt(row.guest_question, recent) }],
    });
    const block = response.content.find(b => b.type === 'text');
    return block && block.type === 'text' ? block.text : null;
  } catch (e: any) {
    console.warn('[Escalation fallback] could not write the guest note, using the default:', e.message);
    return null;
  }
}

// Shop: the note sends the customer to the shop, with the shop's own contact details added by code (never by the model).
async function shopNoticeText(row: FallbackRow, recent: { role: string; content: string }[], sources: string[]): Promise<string> {
  const [cfg] = (await query(`SELECT phone, instagram_url, website_url FROM shop_config WHERE tenant_id = ?`, [row.tenant_id])) as any[];
  const contactLines = [
    cfg?.phone && `📱 ${cfg.phone}`,
    cfg?.instagram_url && `Instagram: ${cfg.instagram_url}`,
    cfg?.website_url && `Website: ${cfg.website_url}`,
  ].filter(Boolean) as string[];
  return buildShopNotice(await composeNotice(row, recent, SHOP_NOTICE_SYSTEM), sources, contactLines);
}

const realDeps: FallbackDeps = {
  async createRequest(row) {
    if (row.tenant_type === 'hotel') return createHotelFallbackRequest(row);
    if (row.tenant_type === 'general_business') return createGbFallbackRequest(row);
    if (row.tenant_type === 'airbnb') return createAirbnbFallbackRequest(row);
    // Shops have no request concept: today an unanswerable question is logged as a content gap by the agent
    // (log_unanswered_question, already done at escalation time) and the customer is sent to the shop. Nothing to create.
    if (row.tenant_type === 'shop') return;
    throw new Error(`no normal-request fallback for tenant type ${row.tenant_type} yet`);
  },

  async notifyGuest(row) {
    const ctx = await loadContext(row.id, false);
    if (!ctx) throw new Error('conversation not found');
    const sources = [row.guest_question, ...ctx.conversation.recent.map(m => m.content)];
    const text = row.tenant_type === 'shop'
      ? await shopNoticeText(row, ctx.conversation.recent, sources)
      : chooseNotice(await composeNotice(row, ctx.conversation.recent), sources);
    await deliverToGuest(ctx, text);
    try { await appendRelayedToHistory(ctx, text); }
    catch (e: any) { console.warn('[Escalation fallback] note sent, but not stored in conversation history:', e.message); }
  },

  async recordError(escalationId, error) {
    await query(`UPDATE staff_escalations SET fallback_error = ? WHERE id = ? RETURNING id`, [error, escalationId]);
  },
};

export const runFallback = createFallback(realDeps);
