// SkedAI side of the escalation timeout fallback: alerts the owner about the unanswered sales question, exactly like a
// new sales lead, so "I've passed your question to our team" is true.
import { query } from '../db/database.js';
import { notifySalesLead } from './notify.js';
import type { FallbackRow } from '../escalation/fallback.js';

export async function createSkedaiFallbackRequest(row: FallbackRow): Promise<void> {
  const [conv] = (await query(
    `SELECT guest_phone FROM skedai_conversations WHERE id = ? AND tenant_id = ?`,
    [row.conversation_id, row.tenant_id],
  )) as any[];
  if (!conv) throw new Error('conversation not found');

  const [cfg] = (await query(`SELECT forward_phone FROM skedai_config WHERE tenant_id = ?`, [row.tenant_id])) as any[];
  const owner = cfg?.forward_phone || process.env.SKEDAI_OWNER_PHONE;
  // notifySalesLead silently does nothing without an owner number; telling the customer the team was told would be false.
  if (!owner) throw new Error('no owner phone configured (skedai_config.forward_phone / SKEDAI_OWNER_PHONE)');

  await notifySalesLead(
    conv.guest_phone,
    row.guest_question,
    'Unanswered question — no staff reply in time',
    undefined,
    cfg?.forward_phone || undefined,
  );
}
