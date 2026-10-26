// Human-in-the-loop escalation — real dependencies for the relay (stage 4).
import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db/database.js';
import { getConversationsTable } from '../utils/conversationsTable.js';
import { getModelForTenant } from '../utils/modelForTenant.js';
import {
  createRelay, buildComposePrompt, COMPOSE_SYSTEM, COMPOSE_STRICT_ADDENDUM,
  type RelayDeps, type RelayContext, type RelayMessage, type RelayOutcome, type ComposeInput,
} from './relay.js';
import { deliverToGuest, appendRelayedToHistory } from './relayDeliver.js';

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

async function rows(sql: string, params: unknown[]): Promise<any[]> {
  return (await query(sql, params)) as any[];
}

function parseMessages(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(String(raw || '[]')); } catch { return []; }
}

/**
 * Loads an escalation together with its guest conversation and tenant.
 * requireAnswer: the relay needs the staff answer; the timeout fallback has none (staff never replied).
 */
export async function loadContext(escalationId: string, requireAnswer: boolean): Promise<RelayContext | null> {
  const [esc] = await rows(
    `SELECT id, tenant_id, tenant_type, conversation_id, kind, guest_question, staff_answer
     FROM staff_escalations WHERE id = ?`,
    [escalationId],
  );
  if (!esc || (requireAnswer && !esc.staff_answer)) return null;

  const table = getConversationsTable(esc.tenant_type);
  const [conv] = await rows(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?`, [esc.conversation_id, esc.tenant_id]);
  const [tenant] = await rows(`SELECT * FROM tenants WHERE id = ?`, [esc.tenant_id]);
  if (!conv || !tenant) return null;

  const recent: RelayMessage[] = parseMessages(conv.messages)
    .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-6)
    .map(m => ({ role: m.role, content: m.content }));

  return {
    escalation: {
      id: String(esc.id), tenant_id: esc.tenant_id, tenant_type: esc.tenant_type,
      conversation_id: esc.conversation_id, kind: esc.kind,
      guest_question: esc.guest_question, staff_answer: esc.staff_answer ?? '',
    },
    tenant,
    conversation: {
      id: String(conv.id),
      guestId: conv.guest_phone ?? conv.channel_user_id,   // airbnb conversations have no guest_phone
      channel: conv.channel || 'whatsapp',
      channelUserId: conv.channel_user_id ?? null,
      guestName: conv.guest_name ?? null,
      recent,
    },
  };
}

const realDeps: RelayDeps = {
  load: id => loadContext(id, true),

  async compose(i: ComposeInput): Promise<string | null> {
    const response = await client.messages.create({
      model: await getModelForTenant(i.tenantId),
      max_tokens: 500,
      system: COMPOSE_SYSTEM + (i.strict ? COMPOSE_STRICT_ADDENDUM : ''),
      messages: [{ role: 'user', content: buildComposePrompt(i) }],
    });
    const block = response.content.find(b => b.type === 'text');
    const text = block && block.type === 'text' ? block.text.trim() : '';
    return text.replace(/^["“]|["”]$/g, '').trim() || null;
  },

  deliver: deliverToGuest,
  appendHistory: appendRelayedToHistory,

  async save(escalationId, guestReply, error) {
    await query(
      `UPDATE staff_escalations SET guest_reply = ?, relay_error = ? WHERE id = ? RETURNING id`,
      [guestReply, error, escalationId],
    );
  },
};

const relay = createRelay(realDeps);

/** Never throws: any failure becomes { ok: false } so the caller can tell the staff member. */
export async function relayAnswerToGuest(escalationId: string): Promise<RelayOutcome> {
  try {
    return await relay(escalationId);
  } catch (e: any) {
    console.error('[Escalation relay] unexpected failure:', e.message);
    try { await realDeps.save(escalationId, null, `relay_crashed: ${e.message}`); } catch { /* best effort */ }
    return { ok: false, error: `relay_crashed: ${e.message}` };
  }
}
