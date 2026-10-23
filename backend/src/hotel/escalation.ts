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
    const [conv] = await rows(`SELECT room_number FROM hotel_conversations WHERE id = ?`, [conversationId]);

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

    const room = stay?.room_number || (typeof input.room_number === 'string' ? input.room_number.trim() : '') || conv?.room_number || null;
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
