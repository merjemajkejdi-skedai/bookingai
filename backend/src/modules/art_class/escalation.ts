// Art class side of human escalation: context for the shared escalation core, the prompt override, and a safe
// history append. Only reached when the tenant enabled escalation (see runArtClassAgent).
import crypto from 'crypto';
import { isPg, query } from '../../db/database.js';
import { escalateFromToolInput, escalationToolResult, ESCALATION_PROMPT_ACTIVE, escalationPromptPending, type EscalationState } from '../../escalation/alert.js';
import { appendAssistantToSession } from '../../whatsapp/sessions.js';

async function rows(sql: string, params: unknown[]): Promise<any[]> {
  return (await query(sql, params)) as any[];
}

export async function artClassConversationId(tenantId: string, guestPhone: string): Promise<string | null> {
  const [r] = await rows(`SELECT id FROM art_class_conversations WHERE tenant_id = ? AND guest_phone = ? LIMIT 1`, [tenantId, guestPhone]);
  return r?.id ? String(r.id) : null;
}

// Art class conversations are written by the webhook only AFTER the agent has replied, so on a customer's very first
// message there is no row yet for the escalation to point at. Create the empty row the webhook would have created;
// its own save (select-then-update) then finds it and appends the turn as usual.
async function ensureArtClassConversation(tenantId: string, guestPhone: string): Promise<string> {
  const existing = await artClassConversationId(tenantId, guestPhone);
  if (existing) return existing;
  const now = new Date().toISOString();
  await rows(
    `INSERT INTO art_class_conversations (id, tenant_id, guest_phone, messages, last_message, channel, updated_at, last_guest_message_at)
     VALUES (?,?,?,'[]',?,'whatsapp',?,?)
     ON CONFLICT (tenant_id, guest_phone) DO NOTHING RETURNING id`,
    [crypto.randomUUID(), tenantId, guestPhone, now, now, now],
  );
  const id = await artClassConversationId(tenantId, guestPhone);
  if (!id) throw new Error('could not create the conversation');
  return id;
}

// Rule 4 of the studio prompt says to "offer to connect them with the studio owner (get_owner_contact)". Appending the
// escalation rules after it leaves two contradictory instructions, so while escalation is active rule 4 is replaced.
const RULE_START = "4. When you don't have the specific answer to a question:";
const RULE_END = "5. Match your tone's confidence";
const RULE_ESCALATION = `4. When you don't have the specific answer to a question (human check is ON for this studio):
   - Do NOT guess or generalize from "how art studios usually work"
   - Call escalate_to_staff (kind "question") with a clear standalone summary of the question. This REPLACES offering the studio owner's contact for an unanswered question: do NOT send them away.
   - Then tell the customer, in their language, that you need a moment to check with your colleagues. This is the one case where you may say you are checking. Never say a request was created.
   (If the customer explicitly asks to speak to a person, the HUMAN HANDOFF section above still applies.)
`;

/** Swaps rule 4 for the escalation version. Unchanged if it can't be found. */
export function withArtClassEscalationRule(prompt: string): string {
  const start = prompt.indexOf(RULE_START);
  const end = prompt.indexOf(RULE_END);
  if (start < 0 || end <= start) return prompt;
  return prompt.slice(0, start) + RULE_ESCALATION + prompt.slice(end);
}

/** esc === null (escalation not in play) returns the prompt untouched. */
export function applyArtClassEscalation(prompt: string, esc: EscalationState | null): string {
  if (!esc) return prompt;
  if (esc.openQuestion) return prompt + escalationPromptPending(esc.openQuestion);
  return withArtClassEscalationRule(prompt) + ESCALATION_PROMPT_ACTIVE;
}

export async function executeArtClassEscalation(
  input: Record<string, unknown>,
  tenantId: string,
  guestPhone: string,
): Promise<unknown> {
  const unreachable = escalationToolResult({ ok: false, reason: 'send_failed' });
  if (!isPg) return unreachable;

  try {
    const conversationId = await ensureArtClassConversation(tenantId, guestPhone);
    const [conv] = await rows(`SELECT guest_name FROM art_class_conversations WHERE id = ?`, [conversationId]);
    const [tenant] = await rows(`SELECT name FROM tenants WHERE id = ?`, [tenantId]);

    return await escalateFromToolInput({
      tenantId,
      conversationId,
      input,
      businessName: tenant?.name || 'Art studio',
      guestName: conv?.guest_name || (typeof input.guest_name === 'string' && input.guest_name.trim() ? input.guest_name.trim() : null),
    });
  } catch (e: any) {
    console.error('[ArtClass escalation] failed — agent will fall back to its normal answer:', e.message);
    return unreachable;
  }
}

/** Stores a relayed message in the conversation (DB is the source of truth) and in the live in-memory session. */
export async function appendArtClassAssistantMessage(opts: { tenantId: string; conversationId: string; guestPhone: string; content: string }): Promise<void> {
  const { tenantId, conversationId, guestPhone, content } = opts;
  const [row] = await rows(`SELECT messages FROM art_class_conversations WHERE id = ? AND tenant_id = ?`, [conversationId, tenantId]);
  if (!row) throw new Error('conversation not found');

  let prev: any[] = [];
  try { prev = Array.isArray(row.messages) ? row.messages : JSON.parse(row.messages || '[]'); } catch { prev = []; }
  const now = new Date().toISOString();
  const updated = [...prev, { role: 'assistant', content, ts: now }].slice(-30);

  await rows(
    `UPDATE art_class_conversations SET messages = ?, last_message = ?, updated_at = ? WHERE id = ? AND tenant_id = ? RETURNING id`,
    [JSON.stringify(updated), now, now, conversationId, tenantId],
  );
  appendAssistantToSession(guestPhone, content);
}
