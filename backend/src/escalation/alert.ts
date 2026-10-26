// Human-in-the-loop escalation — creating an escalation and alerting staff (stage 3).
// Shared by every tenant type's agent. Nothing here runs unless the tenant enabled escalation.
import type Anthropic from '@anthropic-ai/sdk';
import { isPg, query } from '../db/database.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';
import {
  ESCALATION_TENANT_TYPES, listEscalationNumbers, normalizeEscalationNumber,
} from './config.js';

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Department number wins; otherwise the tenant default. */
export function resolveStaffNumber(departmentNumber: unknown, tenantDefault: unknown): string | null {
  return normalizeEscalationNumber(departmentNumber) ?? normalizeEscalationNumber(tenantDefault);
}

/** One short code per open escalation, e.g. "A12". */
export function generateAlertCode(random: () => number = Math.random): string {
  const letter = String.fromCharCode(65 + Math.floor(random() * 26));
  const num = 10 + Math.floor(random() * 90);
  return `${letter}${num}`;
}

/** Keeps the staff alert free of guest phone numbers even if the model pasted one in. */
export function scrubQuestion(raw: string): string {
  return raw
    .replace(/\+?\d[\d\s\-().]{6,}\d/g, m => (m.replace(/\D/g, '').length >= 8 ? '[number removed]' : m))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export interface AlertContext {
  businessName: string;
  contextBits?: Array<string | null | undefined>;   // e.g. ["Room 204"] or ["Listing: Sea View"] or ["Housekeeping"]
  guestName?: string | null;
  question: string;
  code: string;
}

export function buildAlertMessage(a: AlertContext): string {
  const where = [a.businessName, ...(a.contextBits ?? [])].filter(Boolean).join(', ');
  const lines = [`Guest question (${where})`];
  if (a.guestName && a.guestName.trim()) lines.push(`Guest: ${a.guestName.trim()}`);
  lines.push(`"${scrubQuestion(a.question)}"`, '', 'Reply to this message with your answer.', `Ref #${a.code}`);
  return lines.join('\n');
}

// ── Escalation creation ───────────────────────────────────────────────────────

export interface EscalateParams {
  tenantId: string;
  conversationId: string;
  kind: 'question' | 'request';
  questionSummary: string;
  departmentId?: string | null;
  departmentNumber?: string | null;     // that department's escalation_number, if any
  alert: Omit<AlertContext, 'question' | 'code'>;
}

export type EscalateResult =
  | { ok: true; id: string; code: string; staffNumber: string }
  | { ok: false; reason: 'disabled' | 'unsupported' | 'no_number' | 'already_waiting' | 'send_failed'; openQuestion?: string };

export interface InsertRow {
  tenantId: string; tenantType: string; conversationId: string; kind: string; question: string;
  departmentId: string | null; staffNumber: string; code: string; expiresAt: Date;
}

export interface EscalationDeps {
  loadTenant(tenantId: string): Promise<any | null>;
  findOpen(tenantId: string, conversationId: string): Promise<{ id: string; guest_question: string } | null>;
  insert(row: InsertRow): Promise<{ result: 'ok'; id: string } | { result: 'conflict_open' | 'code_taken' }>;
  send(tenant: any, toE164: string, text: string): Promise<string | null>;
  markSent(id: string, messageId: string | null): Promise<void>;
  markFailed(id: string): Promise<void>;
  randomCode(): string;
  now(): Date;
}

export function createEscalator(deps: EscalationDeps) {
  return async function escalate(p: EscalateParams): Promise<EscalateResult> {
    const tenant = await deps.loadTenant(p.tenantId);
    if (!tenant?.human_escalation_enabled) return { ok: false, reason: 'disabled' };
    const type = String(tenant.type || '').toLowerCase();
    if (!(ESCALATION_TENANT_TYPES as readonly string[]).includes(type)) return { ok: false, reason: 'unsupported' };

    const staffNumber = resolveStaffNumber(p.departmentNumber, tenant.human_escalation_number);
    if (!staffNumber) return { ok: false, reason: 'no_number' };

    const open = await deps.findOpen(p.tenantId, p.conversationId);
    if (open) return { ok: false, reason: 'already_waiting', openQuestion: open.guest_question };

    const timeoutMin = Number(tenant.human_escalation_timeout_minutes) || 15;
    const expiresAt = new Date(deps.now().getTime() + timeoutMin * 60_000);
    const question = scrubQuestion(p.questionSummary);

    let id = '';
    let code = '';
    for (let attempt = 0; attempt < 8; attempt++) {
      code = deps.randomCode();
      const r = await deps.insert({
        tenantId: p.tenantId, tenantType: type, conversationId: p.conversationId, kind: p.kind, question,
        departmentId: p.departmentId ?? null, staffNumber, code, expiresAt,
      });
      if (r.result === 'ok') { id = r.id; break; }
      if (r.result === 'conflict_open') {
        const again = await deps.findOpen(p.tenantId, p.conversationId);
        return { ok: false, reason: 'already_waiting', openQuestion: again?.guest_question };
      }
    }
    if (!id) return { ok: false, reason: 'send_failed' };

    try {
      const messageId = await deps.send(tenant, staffNumber, buildAlertMessage({ ...p.alert, question, code }));
      await deps.markSent(id, messageId);
    } catch (e: any) {
      console.error(`[Escalation] alert send failed for tenant ${p.tenantId}:`, e.message);
      await deps.markFailed(id).catch(() => {});
      return { ok: false, reason: 'send_failed' };
    }
    return { ok: true, id, code, staffNumber };
  };
}

const realDeps: EscalationDeps = {
  async loadTenant(tenantId) {
    const rows = await query(`SELECT * FROM tenants WHERE id = ? AND deleted_at IS NULL`, [tenantId]);
    return rows[0] ?? null;
  },
  async findOpen(tenantId, conversationId) {
    const rows = await query(
      `SELECT id, guest_question FROM staff_escalations WHERE tenant_id = ? AND conversation_id = ? AND status = 'waiting' LIMIT 1`,
      [tenantId, conversationId],
    );
    return (rows[0] as any) ?? null;
  },
  async insert(r) {
    try {
      const rows = await query(
        `INSERT INTO staff_escalations
           (tenant_id, tenant_type, conversation_id, kind, guest_question, department_id, staff_number, alert_code, status, expires_at)
         VALUES (?,?,?,?,?,?,?,?, 'waiting', ?) RETURNING id`,
        [r.tenantId, r.tenantType, r.conversationId, r.kind, r.question, r.departmentId, r.staffNumber, r.code, r.expiresAt.toISOString()],
      );
      return { result: 'ok', id: String((rows[0] as any).id) };
    } catch (e: any) {
      if (e?.code === '23505') {
        return { result: String(e.constraint || '').includes('one_open') ? 'conflict_open' : 'code_taken' };
      }
      throw e;
    }
  },
  send: (tenant, to, text) => sendWhatsAppMessage(to, text, tenant),
  async markSent(id, messageId) {
    await query(`UPDATE staff_escalations SET alert_message_id = ? WHERE id = ? RETURNING id`, [messageId, id]);
  },
  async markFailed(id) {
    await query(`UPDATE staff_escalations SET status = 'failed' WHERE id = ? AND status = 'waiting' RETURNING id`, [id]);
  },
  randomCode: () => generateAlertCode(),
  now: () => new Date(),
};

export const escalateToStaff = createEscalator(realDeps);

// ── Agent integration ─────────────────────────────────────────────────────────

export interface EscalationState {
  /** The guest-question text of the escalation already waiting in this conversation, if any. */
  openQuestion: string | null;
}

/**
 * null  = escalation is not in play for this conversation (flag off, unsupported type, or no
 *         staff number anywhere) -> the agent must behave exactly as before.
 * state = escalation is on; openQuestion tells whether one is already waiting.
 * Never throws: any failure means "not in play".
 */
export async function getEscalationState(
  tenantId: string,
  conversationIdOf: () => Promise<string | null>,   // only called once escalation is known to be enabled
): Promise<EscalationState | null> {
  if (!isPg) return null;
  try {
    const rows = await query(
      `SELECT type, human_escalation_enabled, human_escalation_number FROM tenants WHERE id = ? AND deleted_at IS NULL`,
      [tenantId],
    );
    const t = rows[0] as any;
    if (!t?.human_escalation_enabled) return null;
    const type = String(t.type || '').toLowerCase();
    if (!(ESCALATION_TENANT_TYPES as readonly string[]).includes(type)) return null;
    if ((await listEscalationNumbers(tenantId, type, t.human_escalation_number)).length === 0) return null;

    let openQuestion: string | null = null;
    const conversationId = await conversationIdOf();
    if (conversationId) {
      const open = await query(
        `SELECT guest_question FROM staff_escalations WHERE tenant_id = ? AND conversation_id = ? AND status = 'waiting' LIMIT 1`,
        [tenantId, conversationId],
      );
      openQuestion = (open[0] as any)?.guest_question ?? null;
    }
    return { openQuestion };
  } catch (e: any) {
    console.warn('[Escalation] state lookup failed — behaving as if disabled:', e.message);
    return null;
  }
}

export const escalateToStaffTool: Anthropic.Tool = {
  name: 'escalate_to_staff',
  description:
    "Ask a human colleague when you cannot answer a guest's question from the information you have, or cannot carry out something they ask. " +
    "Use this INSTEAD of creating a request for those cases. The colleague's answer is passed back to the guest automatically. " +
    'After calling it, tell the guest in their own language that you need a moment to check with your colleagues. Never say a request was created.',
  input_schema: {
    type: 'object' as const,
    properties: {
      question_summary: { type: 'string', description: "The guest's question or request as a clear standalone sentence. Never include phone numbers." },
      kind: { type: 'string', enum: ['question', 'request'], description: "'question' = information you don't have; 'request' = something you can't action yourself" },
      department: { type: 'string', description: 'Optional: name of the department this concerns, if clear (e.g. Housekeeping)' },
      room_number: { type: 'string', description: 'Guest room number, if known' },
      guest_name: { type: 'string', description: 'Guest name, if known' },
    },
    required: ['question_summary', 'kind'],
  },
};

// Wording for "who is being asked". Defaults keep the existing hotel / general_business text byte-identical.
const bare = (who: string) => who.replace(/^your /, '');

export const escalationPromptActive = (who = 'your colleagues'): string => `

## CHECKING WITH COLLEAGUES (staff escalation)
When a guest asks something you cannot answer from the information you have, or asks for something you cannot do yourself, do NOT create a request for it. Call escalate_to_staff (kind "question" for information you don't have, kind "request" for something you can't action), then tell the guest, in their language, that you need a moment to check with ${who}. Never say a request was created for this.
Everything you can already handle (housekeeping, maintenance, room service, complaints, etc.) works exactly as before.
If escalate_to_staff says it could not reach staff, fall back to create_request as usual.`;

export const ESCALATION_PROMPT_ACTIVE = escalationPromptActive();

export function escalationPromptPending(openQuestion: string, who = 'your colleagues'): string {
  return `

## PENDING CHECK WITH COLLEAGUES
You are already checking this with ${bare(who)} for this guest: "${openQuestion}".
If the guest repeats it or follows up on it, tell them you are still checking and will come back as soon as you have an answer. Do not create anything new for it.
If they ask something different that you cannot answer, create a normal request with create_request as usual.`;
}

/** What the model is told after calling escalate_to_staff. */
export function escalationToolResult(r: EscalateResult, who = 'your colleagues'): Record<string, unknown> {
  if (r.ok) {
    return {
      escalated: true,
      instruction: `Tell the guest briefly, in their language, that you need a moment to check this with ${who}. Do not say a request was created.`,
    };
  }
  if (r.reason === 'already_waiting') {
    return {
      escalated: false,
      already_waiting: true,
      pending_question: r.openQuestion ?? null,
      instruction: `A check with ${bare(who)} is already in progress for this guest. If they are repeating or following up on it, tell them you are still checking. If it is a different thing you cannot answer, use create_request as usual.`,
    };
  }
  return {
    escalated: false,
    instruction: "Staff could not be reached this way. Handle it with create_request as you normally would (use request_type 'other' for a question you cannot answer).",
  };
}

/**
 * Shared tool handler for agents other than the hotel: validates the model's tool input, hands over to the
 * escalation core, and returns what the model should be told. The agent supplies the context it knows.
 */
export async function escalateFromToolInput(p: {
  tenantId: string;
  conversationId: string;
  input: Record<string, unknown>;
  businessName: string;
  guestName?: string | null;
  contextBits?: Array<string | null | undefined>;
  department?: { id: string; escalation_number?: string | null } | null;
  who?: string;
}): Promise<Record<string, unknown>> {
  const summary = typeof p.input.question_summary === 'string' ? p.input.question_summary.trim() : '';
  if (!summary) return escalationToolResult({ ok: false, reason: 'send_failed' }, p.who);
  const result = await escalateToStaff({
    tenantId: p.tenantId,
    conversationId: p.conversationId,
    kind: p.input.kind === 'request' ? 'request' : 'question',
    questionSummary: summary,
    departmentId: p.department?.id ?? null,
    departmentNumber: p.department?.escalation_number ?? null,
    alert: { businessName: p.businessName, contextBits: p.contextBits, guestName: p.guestName ?? null },
  });
  return escalationToolResult(result, p.who);
}
