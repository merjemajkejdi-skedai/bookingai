// General business side of human escalation: context for the shared escalation core, and the prompt override.
// Only reached when the tenant enabled escalation (see getEscalationState in generalBusiness/agent.ts).
import { isPg, query } from '../db/database.js';
import { escalateFromToolInput, escalationToolResult } from '../escalation/alert.js';

async function rows(sql: string, params: unknown[]): Promise<any[]> {
  return (await query(sql, params)) as any[];
}

export async function gbConversationId(tenantId: string, guestPhone: string): Promise<string | null> {
  const [r] = await rows(`SELECT id FROM gb_conversations WHERE tenant_id = ? AND guest_phone = ? LIMIT 1`, [tenantId, guestPhone]);
  return r?.id ? String(r.id) : null;
}

// The base prompt's rules 4 and 5 tell the model to "offer to connect them with the team, or create a request via
// create_request so a human follows up". Appending the escalation rules after them leaves two contradictory
// instructions, which for the hotel agent meant only 4 of 12 unanswerable questions escalated. While escalation is
// active these two rules are replaced instead.
const RULES_START = "4. When you don't have the specific answer:";
const RULES_END = "6. Match your tone's confidence";
const RULES_ESCALATION = `4. When you don't have the specific answer to a customer's question (human check is ON for this business):
   - Do NOT guess or generalize from "how businesses usually work"
   - Call escalate_to_staff (kind "question") with a clear standalone summary of the question. This REPLACES creating a request for it: do NOT call create_request for an unanswered question.
   - Then tell the customer, in their language, that you need a moment to check with your colleagues. This is the one case where you may say you are checking. Never say a request was created.
5. If genuinely uncertain whether something is accurate, do the same: use escalate_to_staff instead of guessing.
`;

/** Swaps rules 4 and 5 for the escalation version. Unchanged if they can't be found. */
export function withGbEscalationRules(prompt: string): string {
  const start = prompt.indexOf(RULES_START);
  const end = prompt.indexOf(RULES_END);
  if (start < 0 || end <= start) return prompt;
  return prompt.slice(0, start) + RULES_ESCALATION + prompt.slice(end);
}

export async function executeGbEscalation(
  input: Record<string, unknown>,
  tenantId: string,
  guestPhone: string,
): Promise<unknown> {
  const unreachable = escalationToolResult({ ok: false, reason: 'send_failed' });
  if (!isPg) return unreachable;

  try {
    const conversationId = await gbConversationId(tenantId, guestPhone);
    if (!conversationId) return unreachable;

    const [conv] = await rows(`SELECT guest_name FROM gb_conversations WHERE id = ?`, [conversationId]);

    let dept: any = null;
    if (typeof input.department === 'string' && input.department.trim()) {
      [dept] = await rows(
        `SELECT id, name, escalation_number FROM gb_departments
         WHERE tenant_id = ? AND is_active = true AND LOWER(name) = LOWER(?) LIMIT 1`,
        [tenantId, input.department.trim()],
      );
    }

    const [cfg] = await rows(`SELECT business_name FROM gb_business_config WHERE tenant_id = ?`, [tenantId]);
    const [tenant] = await rows(`SELECT name FROM tenants WHERE id = ?`, [tenantId]);

    return await escalateFromToolInput({
      tenantId,
      conversationId,
      input,
      businessName: cfg?.business_name || tenant?.name || 'Business',
      guestName: conv?.guest_name || (typeof input.guest_name === 'string' ? input.guest_name.trim() : '') || null,
      contextBits: [dept?.name ?? null],
      department: dept ? { id: String(dept.id), escalation_number: dept.escalation_number ?? null } : null,
    });
  } catch (e: any) {
    console.error('[GB escalation] failed — agent will fall back to a normal request:', e.message);
    return unreachable;
  }
}
