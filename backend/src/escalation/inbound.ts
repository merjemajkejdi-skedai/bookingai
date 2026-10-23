// Human-in-the-loop escalation — inbound staff replies (stage 2).
//
// Called by every WhatsApp inbound path (Twilio, both Meta handlers) right after the
// tenant is resolved and BEFORE any guest handling, blocklist or agent. Returns true
// when the message was a staff message and has been fully dealt with.
//
// Zero-impact guarantee: returns false immediately unless the tenant has
// human_escalation_enabled, and returns false (old behavior) on any error.
import { isPg, prepare, query, queryOne } from '../db/database.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';
import { normalizeEscalationNumber, listEscalationNumbers } from './config.js';

export interface EscalationRow {
  id: string;
  tenant_id: string;
  status: string;
  staff_number: string;
  alert_code: string;
}

export interface StaffInboundInput {
  tenant: any;                        // full tenants row
  from: string;                       // sender in any WhatsApp format
  text: string;
  quotedMessageId?: string | null;    // Meta: message.context.id · Twilio: OriginalRepliedMessageSid
  messageId?: string | null;          // provider id of this inbound message (dedupe on webhook retries)
}

export interface InboundDeps {
  listNumbers(tenant: any): Promise<string[]>;
  findByQuotedId(tenantId: string, staffNumber: string, quotedId: string): Promise<EscalationRow | null>;
  findByCode(tenantId: string, staffNumber: string, code: string): Promise<EscalationRow | null>;
  /** Atomically waiting|timed_out -> answered. False if another request got there first. */
  recordAnswer(id: string, answer: string): Promise<boolean>;
  isExistingStaffNumber(tenant: any, e164: string): Promise<boolean>;
  send(tenant: any, toE164: string, text: string): Promise<void>;
}

export const HINT_MESSAGE = 'Please reply directly to the alert message so I know which guest this is for.';
export const ALREADY_HANDLED_MESSAGE = 'This one has already been handled — thank you.';

/** "355697990681" (Meta) / "whatsapp:+355…" (Twilio) / "+355…" -> "+355…" or null. */
export function toE164(raw: string): string | null {
  if (!raw) return null;
  const stripped = raw.trim().replace(/^whatsapp:/i, '').replace(/[\s\-().]/g, '');
  return normalizeEscalationNumber(/^\d{7,15}$/.test(stripped) ? `+${stripped}` : stripped);
}

/** Finds "Ref #A12" / "Ref A12" / "#A12" in a staff reply. Returns the upper-cased code. */
export function extractRefCode(text: string): string | null {
  const m = text.match(/(?:\bref\b\s*#?\s*|#\s*)([A-Za-z]\d{1,4})\b/i);
  return m ? m[1].toUpperCase() : null;
}

const recentMessageIds = new Map<string, number>();
const DEDUPE_MS = 10 * 60 * 1000;
function seenRecently(id: string | null | undefined): boolean {
  if (!id) return false;
  const now = Date.now();
  for (const [k, t] of recentMessageIds) if (now - t > DEDUPE_MS) recentMessageIds.delete(k);
  if (recentMessageIds.has(id)) return true;
  recentMessageIds.set(id, now);
  return false;
}

export function createStaffInterceptor(deps: InboundDeps) {
  // A failed send must never change the outcome: the message is still a staff message.
  const say = async (tenant: any, to: string, text: string) => {
    try { await deps.send(tenant, to, text); }
    catch (e: any) { console.error('[Escalation] could not message staff:', e.message); }
  };

  return async function interceptStaffMessage(input: StaffInboundInput): Promise<boolean> {
    const { tenant } = input;
    if (!tenant?.human_escalation_enabled) return false;

    try {
      const sender = toE164(input.from);
      if (!sender) return false;

      const numbers = await deps.listNumbers(tenant);
      if (!numbers.includes(sender)) return false;

      // Webhook retry of a message we already handled: swallow it silently.
      if (seenRecently(input.messageId)) return true;

      const text = (input.text ?? '').trim();

      let row: EscalationRow | null = null;
      if (input.quotedMessageId) row = await deps.findByQuotedId(tenant.id, sender, input.quotedMessageId);
      if (!row) {
        const code = extractRefCode(text);
        if (code) row = await deps.findByCode(tenant.id, sender, code);
      }

      if (!row) {
        // Numbers that already have a staff flow (hotel status updates, shop order commands)
        // keep working exactly as before.
        if (await deps.isExistingStaffNumber(tenant, sender)) return false;
        await say(tenant, sender, HINT_MESSAGE);
        return true;
      }

      if (row.status !== 'waiting' && row.status !== 'timed_out') {
        await say(tenant, sender, ALREADY_HANDLED_MESSAGE);
        return true;
      }

      if (!text) {
        await say(tenant, sender, HINT_MESSAGE);
        return true;
      }

      const recorded = await deps.recordAnswer(row.id, text);
      if (!recorded) {
        await say(tenant, sender, ALREADY_HANDLED_MESSAGE);
        return true;
      }
      // Stage 4 continues from here: turn the answer into a guest message and relay it.
      return true;
    } catch (e: any) {
      console.error('[Escalation] inbound interception failed — falling back to normal handling:', e.message);
      return false;
    }
  };
}

// ── Real dependencies ─────────────────────────────────────────────────────────

async function dbAll(sql: string, ...p: unknown[]) {
  return (isPg ? query(sql, p) : prepare(sql).all(...p)) as Promise<any[]> | any[];
}
async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}

const realDeps: InboundDeps = {
  listNumbers: (tenant) => listEscalationNumbers(tenant.id, String(tenant.type || '').toLowerCase(), tenant.human_escalation_number),

  async findByQuotedId(tenantId, staffNumber, quotedId) {
    return (await dbGet(
      `SELECT id, tenant_id, status, staff_number, alert_code FROM staff_escalations
       WHERE tenant_id = ? AND alert_message_id = ? AND staff_number = ? LIMIT 1`,
      tenantId, quotedId, staffNumber,
    )) as unknown as EscalationRow | null ?? null;
  },

  async findByCode(tenantId, staffNumber, code) {
    return (await dbGet(
      `SELECT id, tenant_id, status, staff_number, alert_code FROM staff_escalations
       WHERE tenant_id = ? AND alert_code = ? AND staff_number = ? AND status IN ('waiting', 'timed_out')
       ORDER BY created_at DESC LIMIT 1`,
      tenantId, code, staffNumber,
    )) as unknown as EscalationRow | null ?? null;
  },

  async recordAnswer(id, answer) {
    const rows = await dbAll(
      `UPDATE staff_escalations SET staff_answer = ?, status = 'answered', answered_at = now()
       WHERE id = ? AND status IN ('waiting', 'timed_out') RETURNING id`,
      answer, id,
    );
    return Array.isArray(rows) && rows.length > 0;
  },

  async isExistingStaffNumber(tenant, e164) {
    const type = String(tenant.type || '').toLowerCase();
    if (type === 'hotel') {
      const row = await dbGet(
        `SELECT 1 AS found FROM hotel_blocked_numbers WHERE tenant_id = ? AND (phone = ? OR phone = ?) LIMIT 1`,
        tenant.id, e164, `whatsapp:${e164}`,
      );
      return !!row;
    }
    if (type === 'shop') {
      const cfg = await dbGet(
        `SELECT staff_notify_enabled, staff_notify_number FROM shop_config WHERE tenant_id = ?`,
        tenant.id,
      ) as any;
      if (!cfg?.staff_notify_enabled || !cfg?.staff_notify_number) return false;
      const notify = String(cfg.staff_notify_number).replace(/\D/g, '');
      const guest = e164.replace(/\D/g, '');
      return !!notify && (guest === notify || guest.endsWith(notify) || notify.endsWith(guest));
    }
    return false;
  },

  async send(tenant, toE164Number, text) {
    await sendWhatsAppMessage(toE164Number, text, tenant);
  },
};

export const interceptStaffMessage = createStaffInterceptor(realDeps);
