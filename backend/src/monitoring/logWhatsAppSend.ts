// logWhatsAppSend.ts — shared writer for whatsapp_send_log, called from
// sendWhatsAppMessage on both the success and failure paths. message_log
// (whatsapp/messageLog.ts) only ever records successful sends and is
// scoped to cost analytics — left untouched. This is a dedicated,
// health-check-only record of outbound send outcomes. Fire-and-forget —
// never throws, never affects message delivery.
import crypto from 'crypto';
import { isPg, queryRun } from '../db/database.js';

export function logWhatsAppSend(
  tenantId: string,
  provider: 'twilio' | 'meta',
  success: boolean,
  errorMessage?: string,
): void {
  if (!isPg) return;
  queryRun(
    `INSERT INTO whatsapp_send_log (id, tenant_id, provider, success, error_message) VALUES (?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), tenantId, provider, success, errorMessage?.slice(0, 2000) ?? null],
  ).catch((e: any) => console.warn('[whatsapp_send_log] write failed:', e.message));
}
