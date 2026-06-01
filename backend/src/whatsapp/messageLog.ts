// ---------------------------------------------------------------------------
// messageLog.ts — fire-and-forget message logging for cost analytics
// Never throws; uses .catch() only so it never breaks the delivery path.
// ---------------------------------------------------------------------------
import { isPg, queryRun, prepare } from '../db/database.js';

export function logMessage(
  tenantId: string,
  direction: 'inbound' | 'outbound',
  provider: 'twilio' | 'meta',
): void {
  const id  = crypto.randomUUID();
  const sql = 'INSERT INTO message_log (id, tenant_id, direction, provider) VALUES (?, ?, ?, ?)';

  if (isPg) {
    queryRun(sql, [id, tenantId, direction, provider])
      .catch((e: any) => console.warn('[message_log]', e.message));
  } else {
    try {
      prepare(sql).run(id, tenantId, direction, provider);
    } catch (e: any) {
      console.warn('[message_log]', e.message);
    }
  }
}
