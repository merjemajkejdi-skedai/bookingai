// SkedAI side of human escalation: context for the shared escalation core, the sales-prompt override, and a safe
// history append. Only the sales route uses it: the support route already alerts the team on every message.
import crypto from 'crypto';
import { isPg, query } from '../db/database.js';
import {
  escalateFromToolInput, escalationToolResult, escalationPromptActive, escalationPromptPending, type EscalationState,
} from '../escalation/alert.js';
import { maybeSendNewConversationAlert } from './conversationAlert.js';
import { getSession, saveSession } from './session.js';

async function rows(sql: string, params: unknown[]): Promise<any[]> {
  return (await query(sql, params)) as any[];
}

// SkedAI has no create_request tool: when staff can't be reached the agent just says the team will follow up.
const NO_REQUEST_TOOL = true;

export async function skedaiConversationId(tenantId: string, guestPhone: string): Promise<string | null> {
  const [r] = await rows(`SELECT id FROM skedai_conversations WHERE tenant_id = ? AND guest_phone = ? LIMIT 1`, [tenantId, guestPhone]);
  return r?.id ? String(r.id) : null;
}

// The webhook writes the conversation only AFTER the agent has replied, so on a first message there is no row yet for
// the escalation to point at. Create the empty row the webhook would have created — and send the "new conversation"
// alert it would have sent on that insert — so its own save (select-then-update) finds the row and appends the turn.
async function ensureSkedaiConversation(tenantId: string, guestPhone: string): Promise<string> {
  const existing = await skedaiConversationId(tenantId, guestPhone);
  if (existing) return existing;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const inserted = await rows(
    `INSERT INTO skedai_conversations (id, tenant_id, guest_phone, messages, last_message, channel, updated_at, last_guest_message_at)
     VALUES (?,?,?,'[]',?,'whatsapp',?,?)
     ON CONFLICT (tenant_id, guest_phone) DO NOTHING RETURNING id`,
    [id, tenantId, guestPhone, now, now, now],
  );
  if (inserted.length > 0) {
    maybeSendNewConversationAlert(tenantId, { id, channel: 'whatsapp', guestPhone, createdAt: now });
  }
  const final = await skedaiConversationId(tenantId, guestPhone);
  if (!final) throw new Error('could not create the conversation');
  return final;
}

// The sales prompt ends its rules with: 'If asked something you don't know, say "Great question — let me have our
// team answer that properly"'. While escalation is active that single rule is replaced by the escalation behaviour.
const SALES_RULE = `- If asked something you don't know, say "Great question — let me have our team answer that properly"`;
const SALES_RULE_ESCALATION = `- If asked something you don't know, or that the FAQ above does not cover (human check is ON): call escalate_to_staff (kind "question") with a clear standalone summary of the question, then tell the customer, in their language, that you need a moment to check with your colleagues. Never invent an answer and never say a request was created.`;

/** Swaps the "don't know" rule for the escalation version. Unchanged if it can't be found. */
export function withSkedaiEscalationRule(prompt: string): string {
  const at = prompt.indexOf(SALES_RULE);
  if (at < 0) return prompt;
  return prompt.slice(0, at) + SALES_RULE_ESCALATION + prompt.slice(at + SALES_RULE.length);
}

/** esc === null (escalation not in play) returns the prompt untouched. */
export function applySkedaiEscalation(prompt: string, esc: EscalationState | null): string {
  if (!esc) return prompt;
  if (esc.openQuestion) return prompt + escalationPromptPending(esc.openQuestion, undefined, NO_REQUEST_TOOL);
  return withSkedaiEscalationRule(prompt) + escalationPromptActive(undefined, NO_REQUEST_TOOL);
}

export async function executeSkedaiEscalation(
  input: Record<string, unknown>,
  tenantId: string,
  guestPhone: string,
): Promise<unknown> {
  const unreachable = escalationToolResult({ ok: false, reason: 'send_failed' }, undefined, NO_REQUEST_TOOL);
  if (!isPg) return unreachable;

  try {
    const conversationId = await ensureSkedaiConversation(tenantId, guestPhone);
    const [conv] = await rows(`SELECT guest_name FROM skedai_conversations WHERE id = ?`, [conversationId]);

    return await escalateFromToolInput({
      tenantId,
      conversationId,
      input,
      businessName: 'SkedAI',
      guestName: conv?.guest_name || (typeof input.guest_name === 'string' && input.guest_name.trim() ? input.guest_name.trim() : null),
      noRequestTool: NO_REQUEST_TOOL,
    });
  } catch (e: any) {
    console.error('[SkedAI escalation] failed — agent will answer normally:', e.message);
    return unreachable;
  }
}

/** Stores a relayed message in the conversation (DB is the source of truth) and in the live session. */
export async function appendSkedaiAssistantMessage(opts: { tenantId: string; conversationId: string; guestPhone: string; content: string }): Promise<void> {
  const { tenantId, conversationId, guestPhone, content } = opts;
  const [row] = await rows(`SELECT messages FROM skedai_conversations WHERE id = ? AND tenant_id = ?`, [conversationId, tenantId]);
  if (!row) throw new Error('conversation not found');

  let prev: any[] = [];
  try { prev = Array.isArray(row.messages) ? row.messages : JSON.parse(row.messages || '[]'); } catch { prev = []; }
  const now = new Date().toISOString();
  const updated = [...prev, { role: 'assistant', content, ts: now }].slice(-30);

  await rows(
    `UPDATE skedai_conversations SET messages = ?, last_message = ?, updated_at = ? WHERE id = ? AND tenant_id = ? RETURNING id`,
    [JSON.stringify(updated), now, now, conversationId, tenantId],
  );

  // Only into a live session: starting one with an assistant turn would make the API reject the history.
  const session = await getSession(guestPhone);
  if (session.messages.length > 0) {
    session.messages.push({ role: 'assistant', content, ts: now });
    await saveSession(guestPhone, session);
  }
}
