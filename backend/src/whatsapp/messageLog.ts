// ---------------------------------------------------------------------------
// messageLog.ts — fire-and-forget message logging for cost analytics
// Never throws; uses .catch() only so it never breaks the delivery path.
// ---------------------------------------------------------------------------
import { isPg, queryRun, prepare } from '../db/database.js';
import { getModelForTenant } from '../utils/modelForTenant.js';

export function logMessage(
  tenantId: string,
  direction: 'inbound' | 'outbound',
  provider: 'twilio' | 'meta',
): void {
  const id  = crypto.randomUUID();
  const sql = 'INSERT INTO message_log (id, tenant_id, direction, provider, model) VALUES (?, ?, ?, ?, ?)';

  // Only an outbound message is an actual agent-generated reply — resolve the
  // same model the agent used, so cost analytics can price this tenant's
  // usage by the model actually in play rather than one flat rate. An inbound
  // log entry predates any agent call and never had a model of its own.
  (async () => {
    const model = direction === 'outbound' ? await getModelForTenant(tenantId) : null;
    if (isPg) {
      await queryRun(sql, [id, tenantId, direction, provider, model]);
    } else {
      prepare(sql).run(id, tenantId, direction, provider, model);
    }
  })().catch((e: any) => console.warn('[message_log]', e.message));
}
