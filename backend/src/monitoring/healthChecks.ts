// healthChecks.ts — the six read-only checks behind the internal system health
// page (see healthAlertEngine.ts / healthCron.ts). Every check is a cheap
// read query against data already being written by existing features; this
// file writes nothing. Purely additive monitoring — never touches tenant
// runtime behaviour.
import { isPg, query, queryOne } from '../db/database.js';
import { getConversationsTable } from '../utils/conversationsTable.js';

export type HealthSeverity = 'critical' | 'warning';

export interface HealthFinding {
  checkType: string;
  tenantId:  string | null;
  severity:  HealthSeverity;
  message:   string;
}

// Same mapping used by conversations/archiveCron.ts — shop_conversations has
// no last_guest_message_at column, so updated_at is the safe proxy there
// (guest+assistant turn written together, no staff-manual-reply feature).
const HAS_LAST_GUEST_MESSAGE_AT: Record<string, boolean> = {
  hotel_conversations: true,
  shop_conversations: false,
  gb_conversations: true,
  art_class_conversations: true,
};

const QUIET_TENANT_TYPES = ['hotel', 'shop', 'general_business', 'art_class'];

// ── 1.1 Email channel health ────────────────────────────────────────────────
// Poll loop runs every 2 minutes (channels/email/worker.ts). Warning if the
// loop itself appears to have died for an account (last_checked_at more than
// 2x the poll interval old); critical if the account is actively failing.
export async function checkEmailHealth(): Promise<HealthFinding[]> {
  const findings: HealthFinding[] = [];
  const rows = await query(
    `SELECT ea.tenant_id, ea.email_address, ea.consecutive_failures, ea.last_checked_at, t.name AS tenant_name
     FROM tenant_email_accounts ea
     JOIN tenants t ON t.id = ea.tenant_id
     WHERE ea.is_enabled = true AND t.deleted_at IS NULL`,
  ) as any[];

  const POLL_INTERVAL_MIN = 2;

  for (const row of rows) {
    const label = `${row.tenant_name} (${row.email_address})`;
    if (Number(row.consecutive_failures) >= 3) {
      findings.push({
        checkType: 'email_health',
        tenantId: row.tenant_id,
        severity: 'critical',
        message: `Email account ${label} has failed ${row.consecutive_failures} consecutive times`,
      });
      continue;
    }
    if (row.last_checked_at) {
      const ageMin = (Date.now() - new Date(row.last_checked_at).getTime()) / 60000;
      if (ageMin > POLL_INTERVAL_MIN * 2) {
        findings.push({
          checkType: 'email_health',
          tenantId: row.tenant_id,
          severity: 'warning',
          message: `Email account ${label} hasn't been checked in ${Math.round(ageMin)} minutes — the poll loop may have stopped`,
        });
      }
    }
  }
  return findings;
}

// ── 1.2 WhatsApp provider health ────────────────────────────────────────────
// Critical if the last 5 consecutive outbound sends for a tenant+provider
// all failed. Only looks at (tenant, provider) pairs with recent activity.
export async function checkWhatsAppHealth(): Promise<HealthFinding[]> {
  const findings: HealthFinding[] = [];
  const pairs = await query(
    `SELECT DISTINCT wsl.tenant_id, wsl.provider, t.name AS tenant_name
     FROM whatsapp_send_log wsl
     JOIN tenants t ON t.id = wsl.tenant_id
     WHERE wsl.created_at > NOW() - INTERVAL '24 hours' AND t.deleted_at IS NULL`,
  ) as any[];

  for (const pair of pairs) {
    const recent = await query(
      `SELECT success FROM whatsapp_send_log
       WHERE tenant_id = ? AND provider = ?
       ORDER BY created_at DESC LIMIT 5`,
      [pair.tenant_id, pair.provider],
    ) as any[];

    if (recent.length === 5 && recent.every(r => !r.success)) {
      findings.push({
        checkType: 'whatsapp_health',
        tenantId: pair.tenant_id,
        severity: 'critical',
        message: `${pair.tenant_name}: last 5 outbound WhatsApp sends via ${pair.provider} all failed`,
      });
    }
  }
  return findings;
}

// ── 1.3 Agent error rate ────────────────────────────────────────────────────
// Per-tenant critical at 3+ errors/hour; platform-wide warning above a fixed
// threshold rather than a statistical baseline (refine later if noisy).
const PLATFORM_ERROR_WARNING_THRESHOLD = 10;

export async function checkAgentErrorRate(): Promise<HealthFinding[]> {
  const findings: HealthFinding[] = [];

  const perTenant = await query(
    `SELECT ael.tenant_id, ael.tenant_type, t.name AS tenant_name, COUNT(*) AS error_count
     FROM agent_error_log ael
     JOIN tenants t ON t.id = ael.tenant_id
     WHERE ael.created_at > NOW() - INTERVAL '1 hour' AND t.deleted_at IS NULL
     GROUP BY ael.tenant_id, ael.tenant_type, t.name
     HAVING COUNT(*) >= 3`,
  ) as any[];

  for (const row of perTenant) {
    findings.push({
      checkType: 'agent_error_tenant',
      tenantId: row.tenant_id,
      severity: 'critical',
      message: `${row.tenant_name} (${row.tenant_type}): ${row.error_count} agent errors in the last hour`,
    });
  }

  const platform = await queryOne(
    `SELECT COUNT(*) AS error_count FROM agent_error_log WHERE created_at > NOW() - INTERVAL '1 hour'`,
  ) as any;
  const platformCount = Number(platform?.error_count || 0);
  if (platformCount > PLATFORM_ERROR_WARNING_THRESHOLD) {
    findings.push({
      checkType: 'agent_error_platform',
      tenantId: null,
      severity: 'warning',
      message: `${platformCount} agent errors across all tenants in the last hour (threshold ${PLATFORM_ERROR_WARNING_THRESHOLD})`,
    });
  }

  return findings;
}

// ── 1.4 JWT/auth health ─────────────────────────────────────────────────────
// getJwtSecret() (lib/jwt.ts) records the source it resolved at process
// startup. 'fallback' means JWT_SECRET isn't set in the environment — every
// existing session gets invalidated on the next restart/redeploy.
export async function checkJwtHealth(): Promise<HealthFinding[]> {
  const row = await queryOne(
    `SELECT value FROM system_status WHERE key = 'jwt_secret_source'`,
  ) as any;
  if (row?.value === 'fallback') {
    return [{
      checkType: 'jwt_secret',
      tenantId: null,
      severity: 'critical',
      message: 'JWT_SECRET is not set in the environment — using a generated fallback secret. Sessions will be invalidated on next restart.',
    }];
  }
  return [];
}

// ── 1.5 Quiet tenant detection ──────────────────────────────────────────────
// Informational signal only, scoped to environment='live' tenants — never
// flags test/demo tenants (Grand Hotel, Bloom Matcha test states, etc).
export async function checkQuietTenants(): Promise<HealthFinding[]> {
  const findings: HealthFinding[] = [];

  const tenants = await query(
    `SELECT id, name, type, created_at FROM tenants
     WHERE deleted_at IS NULL AND environment = 'live' AND type = ANY(?)`,
    [QUIET_TENANT_TYPES],
  ) as any[];

  for (const tenant of tenants) {
    // Skip tenants younger than 48h — they may not have received a first
    // message yet, which isn't the same as having gone quiet.
    const ageMs = Date.now() - new Date(tenant.created_at).getTime();
    if (ageMs < 48 * 60 * 60 * 1000) continue;

    const table = getConversationsTable(tenant.type);
    const hasLastGuestCol = HAS_LAST_GUEST_MESSAGE_AT[table] ?? false;
    const activityExpr = hasLastGuestCol ? 'COALESCE(last_guest_message_at, updated_at)' : 'updated_at';

    const row = await queryOne(
      `SELECT MAX(${activityExpr}::timestamptz) AS last_activity FROM ${table} WHERE tenant_id = ?`,
      [tenant.id],
    ) as any;

    const lastActivity = row?.last_activity ? new Date(row.last_activity).getTime() : null;
    if (lastActivity === null || Date.now() - lastActivity > 48 * 60 * 60 * 1000) {
      findings.push({
        checkType: 'quiet_tenant',
        tenantId: tenant.id,
        severity: 'warning',
        message: lastActivity === null
          ? `${tenant.name}: no inbound guest messages recorded yet`
          : `${tenant.name}: no inbound guest messages in the last 48 hours (last: ${new Date(lastActivity).toISOString()})`,
      });
    }
  }

  return findings;
}

// ── 1.6 Report delivery health ──────────────────────────────────────────────
// Missed sends: a tenant due today (per report_frequency/day settings) with
// no owner_report_log row for today's period, well after the 08:00 cron.
// Duplicate sends: more than one send recorded for the same period — the
// duplicate-send bug class from earlier this session.
function isoWeekday(d: Date): number {
  return ((d.getUTCDay() + 6) % 7) + 1; // 1=Mon..7=Sun
}
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function checkReportDelivery(): Promise<HealthFinding[]> {
  const findings: HealthFinding[] = [];
  const now = new Date();

  // Only check for a missed send once the daily 08:00 Tirane cron has had a
  // couple of hours to run, to avoid false positives earlier in the day.
  const tzHour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Tirane', hour: '2-digit', hour12: false }).format(now),
  );
  if (tzHour >= 10) {
    const dueTenants = await query(
      `SELECT id, name, report_frequency, report_day_of_week, report_day_of_month
       FROM tenants
       WHERE deleted_at IS NULL AND owner_email IS NOT NULL AND owner_email <> ''
         AND report_frequency IN ('weekly', 'monthly')`,
    ) as any[];

    const weekday = isoWeekday(now);
    const dayOfMonth = now.getUTCDate();
    const periodEndStr = startOfUtcDay(now).toISOString().slice(0, 10);

    for (const tenant of dueTenants) {
      const dueToday =
        (tenant.report_frequency === 'weekly' && Number(tenant.report_day_of_week) === weekday) ||
        (tenant.report_frequency === 'monthly' && Number(tenant.report_day_of_month) === dayOfMonth);
      if (!dueToday) continue;

      const sent = await queryOne(
        `SELECT id FROM owner_report_log WHERE tenant_id = ? AND period_end = ? AND status = 'sent'`,
        [tenant.id, periodEndStr],
      );
      if (!sent) {
        findings.push({
          checkType: 'report_missed',
          tenantId: tenant.id,
          severity: 'critical',
          message: `${tenant.name}: ${tenant.report_frequency} owner report was due today but no successful send is recorded`,
        });
      }
    }
  }

  const duplicates = await query(
    `SELECT ol.tenant_id, t.name AS tenant_name, ol.period_start, ol.period_end, COUNT(*) AS send_count
     FROM owner_report_log ol
     JOIN tenants t ON t.id = ol.tenant_id
     WHERE ol.sent_at > NOW() - INTERVAL '2 days'
     GROUP BY ol.tenant_id, t.name, ol.period_start, ol.period_end
     HAVING COUNT(*) > 1`,
  ) as any[];

  for (const dup of duplicates) {
    findings.push({
      checkType: 'report_duplicate',
      tenantId: dup.tenant_id,
      severity: 'warning',
      message: `${dup.tenant_name}: ${dup.send_count} report sends recorded for period ${dup.period_start}–${dup.period_end}`,
    });
  }

  return findings;
}

export async function runAllHealthChecks(): Promise<HealthFinding[]> {
  if (!isPg) return [];

  const results: HealthFinding[] = [];
  // Sequential, not parallel — the spec explicitly calls these "cheap read
  // queries" with no need to worry about load.
  for (const check of [
    checkEmailHealth,
    checkWhatsAppHealth,
    checkAgentErrorRate,
    checkJwtHealth,
    checkQuietTenants,
    checkReportDelivery,
  ]) {
    try {
      results.push(...await check());
    } catch (e: any) {
      console.error(`[Health] Check ${check.name} failed:`, e.message);
    }
  }
  return results;
}
