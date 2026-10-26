// escalationHealth.ts — 1.7 Human escalation health. Read-only, like the other checks in healthChecks.ts.
// Looks at staff_escalations for problems that would otherwise be invisible: guests left waiting because the
// timeout job stopped, alerts that never reached staff, staff answers that never reached the guest, and
// questions that fell through the fallback. A tenant that never enabled escalation has no rows, so it never
// shows up here.
import { query } from '../db/database.js';
import type { HealthFinding } from './healthChecks.js';

interface Row { tenant_id: string; tenant_name: string }
export interface StuckRow extends Row { n: number | string }
export interface AlertFailedRow extends Row { n: number | string }
export interface RelayFailedRow extends Row { n: number | string }
export interface FallbackFailedRow extends Row { request_failed: number | string; notice_failed: number | string }

const num = (v: number | string | null | undefined) => Number(v) || 0;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function buildEscalationFindings(
  stuck: StuckRow[], alertFailed: AlertFailedRow[], relayFailed: RelayFailedRow[], fallbackFailed: FallbackFailedRow[],
): HealthFinding[] {
  const findings: HealthFinding[] = [];

  for (const r of stuck) {
    const n = num(r.n);
    if (n === 0) continue;
    findings.push({
      checkType: 'escalation_stuck', tenantId: r.tenant_id, severity: 'critical',
      message: `${r.tenant_name}: ${n} guest ${plural(n, 'question is', 'questions are')} still waiting for staff more than 3 minutes past the timeout — the escalation timeout job may have stopped`,
    });
  }

  for (const r of alertFailed) {
    const n = num(r.n);
    if (n === 0) continue;
    findings.push({
      checkType: 'escalation_alert_failed', tenantId: r.tenant_id, severity: 'warning',
      message: `${r.tenant_name}: ${n} staff ${plural(n, 'alert', 'alerts')} failed to send in the last 24h (guests were handled by the normal request). Most common cause: the staff member has not messaged the business number in the last 24 hours`,
    });
  }

  for (const r of relayFailed) {
    const n = num(r.n);
    if (n === 0) continue;
    findings.push({
      checkType: 'escalation_relay_failed', tenantId: r.tenant_id, severity: 'warning',
      message: `${r.tenant_name}: ${n} staff ${plural(n, 'answer', 'answers')} could not be passed to the guest in the last 24h (staff were told to contact the guest directly)`,
    });
  }

  for (const r of fallbackFailed) {
    const requestFailed = num(r.request_failed);
    const noticeFailed = num(r.notice_failed);
    if (requestFailed > 0) {
      findings.push({
        checkType: 'escalation_fallback_failed', tenantId: r.tenant_id, severity: 'critical',
        message: `${r.tenant_name}: ${requestFailed} unanswered guest ${plural(requestFailed, 'question', 'questions')} in the last 24h ended with NO request created and the guest not told — follow up manually`,
      });
    }
    if (noticeFailed > 0) {
      findings.push({
        checkType: 'escalation_fallback_failed', tenantId: r.tenant_id, severity: 'warning',
        message: `${r.tenant_name}: ${noticeFailed} ${plural(noticeFailed, 'request was', 'requests were')} created after a timeout but the guest could not be told in the last 24h`,
      });
    }
  }

  return findings;
}

export async function checkEscalationHealth(): Promise<HealthFinding[]> {
  const stuck = await query(
    `SELECT e.tenant_id, t.name AS tenant_name, COUNT(*) AS n
     FROM staff_escalations e JOIN tenants t ON t.id = e.tenant_id
     WHERE e.status = 'waiting' AND e.expires_at < NOW() - INTERVAL '3 minutes' AND t.deleted_at IS NULL
     GROUP BY e.tenant_id, t.name`,
  ) as any[];

  const alertFailed = await query(
    `SELECT e.tenant_id, t.name AS tenant_name, COUNT(*) AS n
     FROM staff_escalations e JOIN tenants t ON t.id = e.tenant_id
     WHERE (e.status = 'failed' OR e.alert_delivery = 'failed')
       AND e.created_at > NOW() - INTERVAL '24 hours' AND t.deleted_at IS NULL
     GROUP BY e.tenant_id, t.name`,
  ) as any[];

  const relayFailed = await query(
    `SELECT e.tenant_id, t.name AS tenant_name, COUNT(*) AS n
     FROM staff_escalations e JOIN tenants t ON t.id = e.tenant_id
     WHERE e.relay_error IS NOT NULL
       AND e.created_at > NOW() - INTERVAL '24 hours' AND t.deleted_at IS NULL
     GROUP BY e.tenant_id, t.name`,
  ) as any[];

  const fallbackFailed = await query(
    `SELECT e.tenant_id, t.name AS tenant_name,
            COUNT(*) FILTER (WHERE e.fallback_error LIKE 'fallback_request_failed%') AS request_failed,
            COUNT(*) FILTER (WHERE e.fallback_error LIKE 'fallback_notice_failed%')  AS notice_failed
     FROM staff_escalations e JOIN tenants t ON t.id = e.tenant_id
     WHERE e.fallback_error IS NOT NULL
       AND e.created_at > NOW() - INTERVAL '24 hours' AND t.deleted_at IS NULL
     GROUP BY e.tenant_id, t.name`,
  ) as any[];

  return buildEscalationFindings(stuck, alertFailed, relayFailed, fallbackFailed);
}
