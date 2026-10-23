// Human-in-the-loop escalation — the once-a-minute job (stage 6): expired escalations and failed alerts
// fall back to the normal request. Restart-safe: everything is driven by rows in staff_escalations.
import cron from 'node-cron';
import twilio from 'twilio';
import { isPg, query } from '../db/database.js';
import { createTimeoutJob, classifyTwilioStatus, type FallbackRow, type TimeoutDeps } from './fallback.js';
import { runFallback } from './fallbackReal.js';

async function rows(sql: string, params: unknown[] = []): Promise<any[]> {
  return (await query(sql, params)) as any[];
}

const COLS = 'id, tenant_id, tenant_type, conversation_id, kind, guest_question, department_id';

// Atomic claim: a staff answer arriving at the same moment wins or loses cleanly (status changes once).
async function claimExpired(): Promise<FallbackRow[]> {
  return rows(
    `UPDATE staff_escalations SET status = 'timed_out'
     WHERE status = 'waiting' AND id IN (
       SELECT id FROM staff_escalations
       WHERE status = 'waiting' AND expires_at <= now()
       ORDER BY expires_at LIMIT 25 FOR UPDATE SKIP LOCKED
     )
     RETURNING ${COLS}`,
  );
}

// Twilio accepts free-form messages outside the 24-hour window and only reports the rejection afterwards.
// Looking at a fresh alert's status turns "silently never arrived" into a fast fallback instead of a full wait.
async function claimFailedAlerts(): Promise<FallbackRow[]> {
  const candidates = await rows(
    `SELECT e.id, e.alert_message_id, t.twilio_account_sid, t.twilio_auth_token
     FROM staff_escalations e JOIN tenants t ON t.id = e.tenant_id
     WHERE e.status = 'waiting' AND e.alert_delivery IS NULL AND e.alert_message_id LIKE 'SM%'
       AND e.created_at > now() - interval '15 minutes' AND e.created_at < now() - interval '4 seconds'
     ORDER BY e.created_at LIMIT 25`,
  );

  const failed: FallbackRow[] = [];
  for (const c of candidates) {
    try {
      const accountSid = c.twilio_account_sid || process.env.TWILIO_ACCOUNT_SID;
      const authToken = c.twilio_auth_token || process.env.TWILIO_AUTH_TOKEN;
      const message = await twilio(accountSid, authToken).messages(c.alert_message_id).fetch();
      const verdict = classifyTwilioStatus(message.status);

      if (verdict === 'ok') {
        await rows(`UPDATE staff_escalations SET alert_delivery = 'ok' WHERE id = ? AND alert_delivery IS NULL RETURNING id`, [c.id]);
      } else if (verdict === 'failed') {
        const detail = `twilio ${message.status}${message.errorCode ? ` ${message.errorCode}` : ''}${message.errorMessage ? `: ${message.errorMessage}` : ''}`;
        failed.push(...await rows(
          `UPDATE staff_escalations SET status = 'failed', alert_delivery = 'failed', alert_error = ?
           WHERE id = ? AND status = 'waiting' RETURNING ${COLS}`,
          [detail.slice(0, 300), c.id],
        ));
      }
    } catch (e: any) {
      console.warn(`[Escalation job] could not check alert ${c.id}:`, e.message);
    }
  }
  return failed;
}

const deps: TimeoutDeps = { claimExpired, claimFailedAlerts, fallback: runFallback };
export const runEscalationJob = createTimeoutJob(deps);

let isRunning = false;

export function startEscalationCron(): void {
  if (!isPg) return;   // escalation only exists on Postgres
  cron.schedule('* * * * *', () => {
    if (isRunning) return;   // never overlap two passes
    isRunning = true;
    runEscalationJob()
      .then(r => { if (r.failedAlerts || r.expired) console.log(`[Escalation job] fell back: ${r.failedAlerts} failed alert(s), ${r.expired} timed out`); })
      .catch(e => console.error('[Escalation job] uncaught:', e.message))
      .finally(() => { isRunning = false; });
  });
  console.log('[Escalation] timeout job scheduled every minute');
}
