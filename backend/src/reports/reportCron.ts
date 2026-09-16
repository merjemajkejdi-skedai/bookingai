// reportCron.ts — daily scheduled job that sends automated owner performance
// report emails to tenants who have opted in (report_frequency = 'weekly' |
// 'monthly'; default 'off' for every tenant, so this is a strict no-op until
// an owner explicitly configures it in the admin panel). One tenant's
// failure never blocks another — see the per-tenant try/catch below,
// mirroring conversations/archiveCron.ts.
//
// report_day_of_week convention: 1 = Monday .. 7 = Sunday (ISO weekday).
import cron from 'node-cron';
import { randomUUID } from 'crypto';
import { isPg, query, queryOne, queryRun } from '../db/database.js';
import { computeReportStats } from './computeReportStats.js';
import { sendOwnerReportEmail } from './sendOwnerReport.js';

const TZ = { timezone: 'Europe/Tirane' };

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isoWeekday(d: Date): number {
  return ((d.getUTCDay() + 6) % 7) + 1; // 1=Mon..7=Sun
}

function weeklyPeriod(today: Date): { periodStart: Date; periodEnd: Date } {
  const periodEnd = startOfUtcDay(today);
  const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { periodStart, periodEnd };
}

// Full previous calendar month, regardless of the configured send-day —
// e.g. run on any day in October, the period is [Sep 1, Oct 1).
function monthlyPeriod(today: Date): { periodStart: Date; periodEnd: Date } {
  const periodEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const periodStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return { periodStart, periodEnd };
}

async function findDueTenants(today: Date): Promise<any[]> {
  const weekday = isoWeekday(today);
  const dayOfMonth = today.getUTCDate();

  return query(
    `SELECT id, name, type, owner_email, report_frequency, report_day_of_week, report_day_of_month
     FROM tenants
     WHERE deleted_at IS NULL
       AND owner_email IS NOT NULL AND owner_email <> ''
       AND (
         (report_frequency = 'weekly'  AND report_day_of_week  = ?)
         OR
         (report_frequency = 'monthly' AND report_day_of_month = ?)
       )`,
    [weekday, dayOfMonth],
  ) as Promise<any[]>;
}

/**
 * Computes stats, sends the email, and logs the outcome for a single tenant.
 * Shared by the daily cron (automated, deduped via owner_report_log's
 * UNIQUE(tenant_id, period_start, period_end)) and the manual send-now
 * admin endpoint (bypasses the dedupe by upserting instead of skipping).
 */
async function sendAndLog(
  tenant: { id: string; name: string; type: string; owner_email: string },
  frequency: 'weekly' | 'monthly' | 'custom',
  periodStart: Date,
  periodEnd: Date,
  manual: boolean,
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  const periodStartStr = periodStart.toISOString().slice(0, 10);
  const periodEndStr   = periodEnd.toISOString().slice(0, 10);

  if (!manual) {
    const existing = await queryOne(
      `SELECT id FROM owner_report_log WHERE tenant_id = ? AND period_start = ? AND period_end = ?`,
      [tenant.id, periodStartStr, periodEndStr],
    );
    if (existing) return { success: false, skipped: true };
  }

  const stats = await computeReportStats(tenant.id, tenant.type, periodStart, periodEnd);
  const result = await sendOwnerReportEmail(tenant, stats, frequency);

  if (manual) {
    await queryRun(
      `INSERT INTO owner_report_log
         (id, tenant_id, period_start, period_end, frequency, recipient_email, status, error_message, manual)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, true)
       ON CONFLICT (tenant_id, period_start, period_end)
       DO UPDATE SET sent_at = NOW(), recipient_email = EXCLUDED.recipient_email,
                     status = EXCLUDED.status, error_message = EXCLUDED.error_message, manual = true`,
      [randomUUID(), tenant.id, periodStartStr, periodEndStr, frequency, tenant.owner_email,
       result.success ? 'sent' : 'failed', result.error ?? null],
    );
  } else {
    await queryRun(
      `INSERT INTO owner_report_log
         (id, tenant_id, period_start, period_end, frequency, recipient_email, status, error_message, manual)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, false)`,
      [randomUUID(), tenant.id, periodStartStr, periodEndStr, frequency, tenant.owner_email,
       result.success ? 'sent' : 'failed', result.error ?? null],
    );
  }

  if (result.success) {
    await queryRun(`UPDATE tenants SET last_report_sent_at = NOW() WHERE id = ?`, [tenant.id]);
  }

  return result;
}

export async function sendDueOwnerReports(now: Date = new Date()): Promise<void> {
  if (!isPg) return; // report job only runs against the Postgres (production) DB

  let tenants: any[] = [];
  try {
    tenants = await findDueTenants(now);
  } catch (e: any) {
    console.error('[OwnerReport] Tenant lookup failed:', e.message);
    return;
  }

  if (tenants.length === 0) return;
  console.log(`[OwnerReport] ${tenants.length} tenant(s) due for a report today`);

  for (const tenant of tenants) {
    try {
      const frequency: 'weekly' | 'monthly' = tenant.report_frequency === 'monthly' ? 'monthly' : 'weekly';
      const { periodStart, periodEnd } = frequency === 'monthly' ? monthlyPeriod(now) : weeklyPeriod(now);

      const result = await sendAndLog(tenant, frequency, periodStart, periodEnd, false);
      if (result.skipped) {
        console.log(`[OwnerReport] Skipping tenant ${tenant.id} — already sent for this period`);
      }
    } catch (e: any) {
      console.error(`[OwnerReport] Failed for tenant ${tenant.id}:`, e.message);
    }
  }
}

/** Manual "send now" — always sends and upserts the log row, bypassing the dedupe. */
export async function sendManualOwnerReport(
  tenant: { id: string; name: string; type: string; owner_email: string },
  periodDays: number,
): Promise<{ success: boolean; error?: string }> {
  const periodEnd = startOfUtcDay(new Date());
  const periodStart = new Date(periodEnd.getTime() - Math.max(1, periodDays) * 24 * 60 * 60 * 1000);
  return sendAndLog(tenant, 'custom', periodStart, periodEnd, true);
}

export function startReportCron(): void {
  // 08:00 Europe/Tirane — after the archive job (04:00), ahead of business hours
  cron.schedule('0 8 * * *', () => {
    console.log('[OwnerReport] Running daily owner report check...');
    sendDueOwnerReports().catch(e => console.error('[OwnerReport] Uncaught:', e.message));
  }, TZ);
  console.log('[OwnerReport] Daily owner report job scheduled at 08:00 Europe/Tirane');
}
