// Shop side of human escalation: context for the shared escalation core, the prompt override, and a safe history append.
// Only reached when the tenant enabled escalation (see getEscalationState in shop/agent.ts).
import { isPg, query } from '../db/database.js';
import { escalateFromToolInput, escalationToolResult } from '../escalation/alert.js';

async function rows(sql: string, params: unknown[]): Promise<any[]> {
  return (await query(sql, params)) as any[];
}

export async function shopConversationId(tenantId: string, guestPhone: string): Promise<string | null> {
  const [r] = await rows(`SELECT id FROM shop_conversations WHERE tenant_id = ? AND guest_phone = ? LIMIT 1`, [tenantId, guestPhone]);
  return r?.id ? String(r.id) : null;
}

// The shop prompt's rule 4 tells the model to "point them to contact the shop directly". Appending the escalation
// rules after it leaves two contradictory instructions, so while escalation is active rule 4 is replaced instead.
const RULE_START = "4. When you don't have the specific answer:";
const RULE_END = "5. Match your tone's confidence";
const RULE_ESCALATION = `4. When you don't have the specific answer (human check is ON for this shop):
   - Do NOT guess or generalize from "how shops usually work"
   - Call escalate_to_staff (kind "question") with a clear standalone summary of the question. This REPLACES telling the customer to contact the shop directly: do NOT send them away for an unanswered question.
   - Then tell the customer, in their language, that you need a moment to check with your colleagues. This is the one case where you may say you are checking. Never say a request was created.
`;

/** Swaps rule 4 for the escalation version. Unchanged if it can't be found. */
export function withShopEscalationRule(prompt: string): string {
  const start = prompt.indexOf(RULE_START);
  const end = prompt.indexOf(RULE_END);
  if (start < 0 || end <= start) return prompt;
  return prompt.slice(0, start) + RULE_ESCALATION + prompt.slice(end);
}

export async function executeShopEscalation(
  input: Record<string, unknown>,
  tenantId: string,
  guestPhone: string,
): Promise<unknown> {
  const unreachable = escalationToolResult({ ok: false, reason: 'send_failed' });
  if (!isPg) return unreachable;

  try {
    const conversationId = await shopConversationId(tenantId, guestPhone);
    if (!conversationId) return unreachable;

    const [cfg] = await rows(`SELECT shop_name FROM shop_config WHERE tenant_id = ?`, [tenantId]);
    const [tenant] = await rows(`SELECT name FROM tenants WHERE id = ?`, [tenantId]);

    return await escalateFromToolInput({
      tenantId,
      conversationId,
      input,
      businessName: cfg?.shop_name || tenant?.name || 'Shop',
      guestName: typeof input.guest_name === 'string' && input.guest_name.trim() ? input.guest_name.trim() : null,
    });
  } catch (e: any) {
    console.error('[Shop escalation] failed — agent will fall back to its normal answer:', e.message);
    return unreachable;
  }
}

// Shop keeps its history as a JSON string in shop_conversations.messages and reloads it from the DB every turn
// (no in-memory session), so a plain read-append-write is enough. Mirrors the agent's own 40-message cap.
export async function appendShopAssistantMessage(opts: { tenantId: string; conversationId: string; content: string }): Promise<void> {
  const { tenantId, conversationId, content } = opts;
  const [row] = await rows(`SELECT messages FROM shop_conversations WHERE id = ? AND tenant_id = ?`, [conversationId, tenantId]);
  if (!row) throw new Error('conversation not found');

  let prev: any[] = [];
  try { prev = Array.isArray(row.messages) ? row.messages : JSON.parse(row.messages || '[]'); } catch { prev = []; }
  const updated = [...prev, { role: 'assistant', content }].slice(-40);

  await rows(
    `UPDATE shop_conversations SET messages = ?, updated_at = ? WHERE id = ? AND tenant_id = ? RETURNING id`,
    [JSON.stringify(updated), new Date().toISOString(), conversationId, tenantId],
  );
}
