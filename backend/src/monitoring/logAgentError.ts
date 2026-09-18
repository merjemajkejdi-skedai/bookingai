// logAgentError.ts — shared writer for agent_error_log, called from every
// place an "agent error/timeout" console.error already fires (webhook.ts,
// metaWebhook.ts, and each agent's own internal catch in hotel/agent.ts,
// shop/agent.ts, generalBusiness/agent.ts). Logs exist for humans; this
// exists so the health-check job can query error rate per tenant, since
// logs aren't queryable. Fire-and-forget — never throws, never blocks the
// guest-facing error path it's called alongside.
import crypto from 'crypto';
import { isPg, queryRun } from '../db/database.js';

export function logAgentError(tenantId: string, tenantType: string, errorMessage: string): void {
  if (!isPg) return;
  queryRun(
    `INSERT INTO agent_error_log (id, tenant_id, tenant_type, error_message) VALUES (?, ?, ?, ?)`,
    [crypto.randomUUID(), tenantId, tenantType, errorMessage?.slice(0, 2000) ?? 'unknown error'],
  ).catch((e: any) => console.warn('[agent_error_log] write failed:', e.message));
}
