// healthAlertEngine.ts — diffs the six health checks' findings against the
// open rows in health_alert_log and drives the state machine:
//   new issue        -> insert status='open', send alert email, set email_sent_at
//   still failing     -> update last_seen_at only (never resend — one email per
//                        issue until it clears)
//   no longer detected -> status='resolved', resolved_at=NOW(), optional
//                        "resolved" follow-up email
// Critical issues email immediately on first detection; warnings are
// dashboard-only. Reuses the same lazy-Resend-singleton pattern already used
// by utils/errorMonitor.ts and reports/sendOwnerReport.ts.
import { randomUUID } from 'crypto';
import { Resend } from 'resend';
import { isPg, query, queryOne, queryRun } from '../db/database.js';
import { runAllHealthChecks, type HealthFinding } from './healthChecks.js';

const ALERT_EMAIL = 'Merjemajkejdi@gmail.com';
const FROM_EMAIL  = 'SkedAI Health <alerts@skedai.net>';

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

interface OpenAlertRow {
  id: string;
  check_type: string;
  tenant_id: string | null;
  severity: string;
  message: string;
}

// health_alert_log's unique index is scoped to tenant_id IS NOT NULL (Postgres
// doesn't treat NULLs as equal for uniqueness), so platform-wide checks
// (tenant_id IS NULL) are deduped here in application code instead — at most
// one open row per (check_type, severity) with a NULL tenant_id.
function findMatch(open: OpenAlertRow[], f: HealthFinding): OpenAlertRow | undefined {
  return open.find(o =>
    o.check_type === f.checkType &&
    o.severity === f.severity &&
    (f.tenantId === null ? o.tenant_id === null : o.tenant_id === f.tenantId),
  );
}

async function sendAlertEmail(f: HealthFinding, kind: 'new' | 'resolved'): Promise<Date | null> {
  try {
    const subject = kind === 'new'
      ? `[SkedAI Health] ${f.severity.toUpperCase()}: ${f.checkType}`
      : `[SkedAI Health] RESOLVED: ${f.checkType}`;
    const color = kind === 'new' ? '#cc0000' : '#16a34a';
    const heading = kind === 'new' ? '🚨 Health check failing' : '✅ Health check resolved';
    const html = `
<h2 style="color:${color}">${heading}</h2>
<table border="1" cellpadding="6" style="border-collapse:collapse;font-family:monospace">
  <tr><td><b>Time</b></td><td>${new Date().toISOString()}</td></tr>
  <tr><td><b>Check</b></td><td>${f.checkType}</td></tr>
  <tr><td><b>Severity</b></td><td>${f.severity}</td></tr>
  <tr><td><b>Tenant</b></td><td>${f.tenantId ?? 'platform-wide'}</td></tr>
  <tr><td><b>Message</b></td><td>${f.message}</td></tr>
</table>
`;
    await getResend().emails.send({ from: FROM_EMAIL, to: ALERT_EMAIL, subject, html });
    return new Date();
  } catch (e: any) {
    console.warn('[Health] Alert email failed:', e.message);
    return null;
  }
}

export async function runHealthCheckCycle(): Promise<void> {
  if (!isPg) return; // health monitoring only runs against the Postgres (production) DB

  let findings: HealthFinding[] = [];
  try {
    findings = await runAllHealthChecks();
  } catch (e: any) {
    console.error('[Health] runAllHealthChecks failed:', e.message);
    return;
  }

  let openRows: OpenAlertRow[] = [];
  try {
    openRows = await query(
      `SELECT id, check_type, tenant_id, severity, message FROM health_alert_log WHERE status = 'open'`,
    ) as unknown as OpenAlertRow[];
  } catch (e: any) {
    console.error('[Health] Failed to load open health_alert_log rows:', e.message);
    return;
  }

  const matchedIds = new Set<string>();

  // New or still-open issues
  for (const f of findings) {
    const existing = findMatch(openRows, f);

    if (existing) {
      matchedIds.add(existing.id);
      try {
        await queryRun(
          `UPDATE health_alert_log SET last_seen_at = NOW(), message = ? WHERE id = ?`,
          [f.message, existing.id],
        );
      } catch (e: any) {
        console.warn('[Health] Failed to update last_seen_at:', e.message);
      }
      continue;
    }

    // New issue — insert as open, then email if critical.
    const id = randomUUID();
    try {
      await queryRun(
        `INSERT INTO health_alert_log (id, check_type, tenant_id, severity, message, status)
         VALUES (?, ?, ?, ?, ?, 'open')`,
        [id, f.checkType, f.tenantId, f.severity, f.message],
      );
    } catch (e: any) {
      console.warn('[Health] Failed to insert new health alert:', e.message);
      continue;
    }

    if (f.severity === 'critical') {
      const sentAt = await sendAlertEmail(f, 'new');
      if (sentAt) {
        await queryRun(`UPDATE health_alert_log SET email_sent_at = ? WHERE id = ?`, [sentAt.toISOString(), id])
          .catch((e: any) => console.warn('[Health] Failed to set email_sent_at:', e.message));
      }
    }
  }

  // Anything still open but no longer detected -> resolved
  const noLongerDetected = openRows.filter(o => !matchedIds.has(o.id));
  for (const row of noLongerDetected) {
    try {
      await queryRun(
        `UPDATE health_alert_log SET status = 'resolved', resolved_at = NOW() WHERE id = ?`,
        [row.id],
      );
    } catch (e: any) {
      console.warn('[Health] Failed to resolve alert:', e.message);
      continue;
    }

    // Only send a "resolved" follow-up for issues that originally emailed —
    // silence after a critical alert is ambiguous otherwise.
    if (row.severity === 'critical') {
      await sendAlertEmail(
        { checkType: row.check_type, tenantId: row.tenant_id, severity: row.severity as any, message: row.message },
        'resolved',
      );
    }
  }

  if (findings.length > 0 || noLongerDetected.length > 0) {
    console.log(`[Health] Cycle complete — ${findings.length} active finding(s), ${noLongerDetected.length} resolved`);
  }
}

export async function manuallyResolveAlert(id: string): Promise<boolean> {
  const row = await queryOne(`SELECT id FROM health_alert_log WHERE id = ? AND status = 'open'`, [id]);
  if (!row) return false;
  await queryRun(`UPDATE health_alert_log SET status = 'resolved', resolved_at = NOW() WHERE id = ?`, [id]);
  return true;
}
