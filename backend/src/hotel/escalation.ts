// Hotel side of human escalation: gathers hotel context for the shared escalation core.
// Only reached when the tenant enabled escalation (see getEscalationState in hotel/agent.ts).
import type Anthropic from '@anthropic-ai/sdk';
import { isPg, query } from '../db/database.js';
import { escalateToStaff, escalationToolResult } from '../escalation/alert.js';

async function rows(sql: string, params: unknown[]): Promise<any[]> {
  return (await query(sql, params)) as any[];
}

export async function hotelConversationId(tenantId: string, guestPhone: string): Promise<string | null> {
  const r = await rows(
    `SELECT id FROM hotel_conversations WHERE tenant_id = ? AND (guest_phone = ? OR channel_user_id = ?) LIMIT 1`,
    [tenantId, guestPhone, guestPhone],
  );
  return r[0]?.id ? String(r[0].id) : null;
}

/** While escalation is on, unanswerable questions go through escalate_to_staff instead of a concierge_question request. */
export function withoutConciergeQuestion(tools: Anthropic.Tool[]): Anthropic.Tool[] {
  return tools.map(t => {
    if (t.name !== 'create_request') return t;
    const props = (t.input_schema as any).properties ?? {};
    const requestType = props.request_type ?? {};
    return {
      ...t,
      input_schema: {
        ...t.input_schema,
        properties: {
          ...props,
          request_type: { ...requestType, enum: (requestType.enum as string[]).filter(e => e !== 'concierge_question') },
        },
      },
    } as Anthropic.Tool;
  });
}

// The base hotel prompt's CASE 2 (unanswered question) tells the model to say "let me check with our team", ask for a
// room number and name, and file a concierge_question request. Appending the escalation rules after it left two
// contradictory instructions: measured with the real model, only 4 of 12 unanswerable questions escalated. Replacing CASE 2
// while escalation is active makes it 12 of 12.
const CASE2_START = '  CASE 2 — UNANSWERED QUESTION';
const CASE2_END = '═══════════════════════════════════════════════\nQUICK LINKS';
const CASE2_ESCALATION = `  CASE 2 — UNANSWERED QUESTION (human check is ON for this hotel)
  (guest asked something requiring specific hotel policy you genuinely don't know)

  → Call escalate_to_staff with kind "question" and a clear standalone summary of what the guest asked. This REPLACES creating a request for it: do NOT call create_request for an unanswered question.
  → Then tell the guest, in their language, that you need a moment to check this with your colleagues. Do NOT ask for their room number or name for this, and never say a request was created.

`;

/** Swaps the base prompt's CASE 2 for the escalation version. Unchanged if CASE 2 can't be found. */
export function withEscalationCase2(prompt: string): string {
  const start = prompt.indexOf(CASE2_START);
  const end = prompt.indexOf(CASE2_END);
  if (start < 0 || end <= start) return prompt;
  return prompt.slice(0, start) + CASE2_ESCALATION + prompt.slice(end);
}

export async function executeHotelEscalation(
  input: Record<string, unknown>,
  tenantId: string,
  guestPhone: string,
): Promise<unknown> {
  const unreachable = escalationToolResult({ ok: false, reason: 'send_failed' });
  if (!isPg) return unreachable;

  try {
    const summary = typeof input.question_summary === 'string' ? input.question_summary.trim() : '';
    if (!summary) return unreachable;
    const kind = input.kind === 'request' ? 'request' : 'question';

    const conversationId = await hotelConversationId(tenantId, guestPhone);
    if (!conversationId) return unreachable;

    const plus = guestPhone.startsWith('+') ? guestPhone : `+${guestPhone}`;
    const [stay] = await rows(
      `SELECT guest_name, room_number FROM hotel_guest_stays
       WHERE tenant_id = ? AND (guest_phone = ? OR guest_phone = ?) AND status = 'checked_in' LIMIT 1`,
      [tenantId, guestPhone, plus],
    );

    let dept: any = null;
    if (typeof input.department === 'string' && input.department.trim()) {
      [dept] = await rows(
        `SELECT id, name, escalation_number FROM hotel_departments
         WHERE tenant_id = ? AND is_active = 1 AND LOWER(name) = LOWER(?) LIMIT 1`,
        [tenantId, input.department.trim()],
      );
    }

    const [cfg] = await rows(`SELECT hotel_name FROM hotel_config WHERE tenant_id = ?`, [tenantId]);
    const [tenant] = await rows(`SELECT name FROM tenants WHERE id = ?`, [tenantId]);

    const room = stay?.room_number || (typeof input.room_number === 'string' ? input.room_number.trim() : '') || null;
    const guestName = stay?.guest_name || (typeof input.guest_name === 'string' ? input.guest_name.trim() : '') || null;

    const result = await escalateToStaff({
      tenantId,
      conversationId,
      kind,
      questionSummary: summary,
      departmentId: dept?.id ? String(dept.id) : null,
      departmentNumber: dept?.escalation_number ?? null,
      alert: {
        businessName: cfg?.hotel_name || tenant?.name || 'Hotel',
        contextBits: [room ? `Room ${room}` : null, dept?.name ?? null],
        guestName,
      },
    });
    return escalationToolResult(result);
  } catch (e: any) {
    console.error('[Hotel escalation] failed — agent will fall back to a normal request:', e.message);
    return unreachable;
  }
}
