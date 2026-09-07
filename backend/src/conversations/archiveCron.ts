// ---------------------------------------------------------------------------
// archiveCron.ts — daily auto-archive of inactive conversations
//
// A conversation with no inbound OR outbound message for `archive_after_days`
// (per-tenant setting, default 30) gets archived_at = NOW(), archived_by = 'auto'.
// Archiving is purely a visibility flag — it never touches AI behaviour,
// message history, or any other conversation data. A new guest message
// auto-unarchives the conversation (handled at message-ingestion time, not here).
//
// 'skedai' (the internal support tenant) is intentionally excluded.
// ---------------------------------------------------------------------------
import cron from 'node-cron';
import { isPg, query } from '../db/database.js';
import { getConversationsTable } from '../utils/conversationsTable.js';

const TZ = { timezone: 'Europe/Tirane' };

// Tenant types that support conversations and participate in auto-archive.
const ARCHIVABLE_TENANT_TYPES = ['hotel', 'shop', 'general_business', 'art_class'];

// shop_conversations has no last_guest_message_at column — fall back to
// updated_at alone (which already reflects the last message of any kind,
// since the guest+assistant turn is written together at the end of the
// shop agent's run).
const HAS_LAST_GUEST_MESSAGE_AT: Record<string, boolean> = {
  hotel_conversations: true,
  shop_conversations: false,
  gb_conversations: true,
  art_class_conversations: true,
};

export async function autoArchiveConversations(): Promise<void> {
  if (!isPg) return; // archive job only runs against the Postgres (production) DB

  let tenants: any[] = [];
  try {
    tenants = await query(
      `SELECT id, type, archive_after_days FROM tenants
       WHERE deleted_at IS NULL AND type = ANY(?)`,
      [ARCHIVABLE_TENANT_TYPES],
    ) as any[];
  } catch (e: any) {
    console.error('[Archive] Tenant query failed:', e.message);
    return;
  }

  let totalArchived = 0;

  for (const tenant of tenants) {
    const table = getConversationsTable(tenant.type);
    const days = Math.max(1, Number(tenant.archive_after_days) || 30);
    const hasLastGuestCol = HAS_LAST_GUEST_MESSAGE_AT[table] ?? false;

    // updated_at / last_guest_message_at are stored as TEXT (ISO strings) —
    // cast to timestamptz for the comparison. The trailing `updated_at < cutoff`
    // guard ensures a conversation with ANY recent activity (guest OR staff/AI
    // outbound) is never archived, even if last_guest_message_at looks stale.
    const sql = hasLastGuestCol
      ? `UPDATE ${table}
         SET archived_at = NOW(), archived_by = 'auto'
         WHERE tenant_id = ?
           AND archived_at IS NULL
           AND (
             (last_guest_message_at IS NOT NULL AND last_guest_message_at::timestamptz < NOW() - make_interval(days => ?))
             OR (last_guest_message_at IS NULL AND updated_at::timestamptz < NOW() - make_interval(days => ?))
           )
           AND updated_at::timestamptz < NOW() - make_interval(days => ?)
         RETURNING id`
      : `UPDATE ${table}
         SET archived_at = NOW(), archived_by = 'auto'
         WHERE tenant_id = ?
           AND archived_at IS NULL
           AND updated_at::timestamptz < NOW() - make_interval(days => ?)
         RETURNING id`;
    const params = hasLastGuestCol
      ? [tenant.id, days, days, days]
      : [tenant.id, days];

    try {
      const result = await query(sql, params) as any[];
      if (result.length > 0) {
        console.log(`[Archive] Tenant ${tenant.id} (${tenant.type}): archived ${result.length} conversation(s)`);
        totalArchived += result.length;
      }
    } catch (e: any) {
      console.warn(`[Archive] Tenant ${tenant.id} (${table}) failed:`, e.message);
    }
  }

  console.log(`[Archive] Daily job complete — ${totalArchived} conversation(s) archived across ${tenants.length} tenant(s) checked`);
}

export function startArchiveCron(): void {
  // 04:00 Europe/Tirane — outside peak traffic hours
  cron.schedule('0 4 * * *', () => {
    console.log('[Archive] Running daily conversation auto-archive...');
    autoArchiveConversations().catch(e => console.error('[Archive] Uncaught:', e.message));
  }, TZ);
  console.log('[Archive] Daily conversation auto-archive scheduled at 04:00 Europe/Tirane');
}
