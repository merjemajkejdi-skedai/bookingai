// ---------------------------------------------------------------------------
// adminAnalytics.ts — Cost analytics endpoints (admin only)
// All routes require requireAuth + requireAdmin middleware.
// ---------------------------------------------------------------------------
import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { isPg, query, queryOne, queryRun, prepare } from '../db/database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

export const adminAnalyticsRouter = Router();

// All routes under this router are admin-only
adminAnalyticsRouter.use(requireAuth, requireAdmin);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function dbAll(sql: string, params: unknown[] = []) {
  return isPg ? query(sql, params) : prepare(sql).all(...params);
}

async function dbGet(sql: string, params: unknown[] = []) {
  return isPg ? queryOne(sql, params) : prepare(sql).get(...params);
}

async function dbRun(sql: string, params: unknown[] = []) {
  if (isPg) return queryRun(sql, params);
  prepare(sql).run(...params);
}

/** Validates 'YYYY-MM'. Returns null if malformed. */
function parseMonthParam(month: unknown): string | null {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return null;
  return month;
}

/**
 * Commissionable flag history — addendum to Cost Analysis v2.
 * On first view of a given month for a tenant, snapshot that tenant's CURRENT
 * is_commissionable/commission_rate into commissionable_status_log for that
 * month. Never overwrites an existing row — once a month has a snapshot
 * (whether from an earlier view or an explicit PATCH), it's locked to that
 * value regardless of what the tenant's live settings become later.
 */
async function ensureCommissionableSnapshots(rows: any[], periodMonth: string): Promise<void> {
  for (const row of rows) {
    const existing = await dbGet(
      `SELECT id FROM commissionable_status_log WHERE tenant_id = ? AND period_month = ?`,
      [row.tenant_id, periodMonth],
    );
    if (!existing) {
      await dbRun(
        `INSERT INTO commissionable_status_log (id, tenant_id, period_month, is_commissionable, commission_rate)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, period_month) DO NOTHING`,
        [crypto.randomUUID(), row.tenant_id, periodMonth,
         isPg ? !!row.is_commissionable : (row.is_commissionable ? 1 : 0),
         row.commission_rate],
      ).catch((e: any) => console.warn('[commissionable snapshot] skipped:', e.message));
    }
  }
}

/**
 * Returns a WHERE-clause fragment (no leading WHERE) for message_log.created_at.
 * The table alias 'ml' is used to qualify the column.
 *
 * PG note: created_at is stored as TEXT so we cast it to timestamptz before
 * comparing against NOW() which returns timestamptz.
 *
 * period='month' filters by calendar-month boundaries using the `month` query
 * param ('YYYY-MM') instead of a rolling window. Falls back to 'all' if the
 * month param is missing/malformed, rather than erroring — this is a report
 * page, not a critical path.
 */
function periodWhere(period: string, alias = 'ml', month?: string): string {
  if (period === 'month' && month) {
    const [y, m] = month.split('-').map(Number);
    if (isPg) {
      return `(${alias}.created_at)::timestamptz >= make_date(${y},${m},1)::timestamptz
              AND (${alias}.created_at)::timestamptz < (make_date(${y},${m},1) + INTERVAL '1 month')::timestamptz`;
    } else {
      const nextY = m === 12 ? y + 1 : y;
      const nextM = m === 12 ? 1 : m + 1;
      const start = `${y}-${String(m).padStart(2, '0')}-01`;
      const end   = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
      return `${alias}.created_at >= '${start}' AND ${alias}.created_at < '${end}'`;
    }
  }
  if (isPg) {
    if (period === '1d')  return `(${alias}.created_at)::timestamptz >= NOW() - INTERVAL '1 day'`;
    if (period === '7d')  return `(${alias}.created_at)::timestamptz >= NOW() - INTERVAL '7 days'`;
    if (period === '30d') return `(${alias}.created_at)::timestamptz >= NOW() - INTERVAL '30 days'`;
    return '1=1'; // all time
  } else {
    if (period === '1d')  return `${alias}.created_at >= datetime('now', '-1 day')`;
    if (period === '7d')  return `${alias}.created_at >= datetime('now', '-7 days')`;
    if (period === '30d') return `${alias}.created_at >= datetime('now', '-30 days')`;
    return '1=1'; // all time
  }
}

// ---------------------------------------------------------------------------
// GET /admin/analytics/messages?period=7d
// GET /admin/analytics/messages?period=month&month=2026-09
// Returns per-tenant message counts broken down by direction and provider,
// plus the per-tenant fields the frontend needs for Twilio/commission/infra
// gating (environment, uses_twilio_flag, provider, monthly_price, commission_rate).
// ---------------------------------------------------------------------------
adminAnalyticsRouter.get('/messages', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || '7d';
    const month  = parseMonthParam(req.query.month) ?? undefined;
    const dateFilter = periodWhere(period, 'ml', month);

    // Build the query — LEFT JOIN includes date filter so tenants with 0 msgs
    // still appear in the result with 0 counts
    const joinCondition = dateFilter === '1=1'
      ? 'ml.tenant_id = t.id'
      : `ml.tenant_id = t.id AND ${dateFilter}`;

    const sql = `
      SELECT
        t.id               AS tenant_id,
        t.name             AS tenant_name,
        t.type             AS tenant_type,
        t.plan             AS plan,
        t.is_active        AS is_active,
        t.provider         AS provider,
        t.environment      AS environment,
        t.uses_twilio_flag AS uses_twilio_flag,
        t.monthly_price    AS monthly_price,
        t.commission_rate  AS commission_rate,
        t.is_commissionable AS is_commissionable,
        COALESCE(SUM(CASE WHEN ml.direction = 'inbound'  THEN 1 ELSE 0 END), 0) AS inbound,
        COALESCE(SUM(CASE WHEN ml.direction = 'outbound' THEN 1 ELSE 0 END), 0) AS outbound,
        COALESCE(COUNT(ml.id), 0)                                                 AS total,
        COALESCE(SUM(CASE WHEN ml.provider = 'twilio' AND ml.direction = 'inbound'  THEN 1 ELSE 0 END), 0) AS twilio_in,
        COALESCE(SUM(CASE WHEN ml.provider = 'twilio' AND ml.direction = 'outbound' THEN 1 ELSE 0 END), 0) AS twilio_out,
        COALESCE(SUM(CASE WHEN ml.provider = 'meta'   AND ml.direction = 'inbound'  THEN 1 ELSE 0 END), 0) AS meta_in,
        COALESCE(SUM(CASE WHEN ml.provider = 'meta'   AND ml.direction = 'outbound' THEN 1 ELSE 0 END), 0) AS meta_out
      FROM tenants t
      LEFT JOIN message_log ml ON ${joinCondition}
      WHERE t.deleted_at IS NULL
      GROUP BY t.id, t.name, t.type, t.plan, t.is_active,
               t.provider, t.environment, t.uses_twilio_flag, t.monthly_price, t.commission_rate, t.is_commissionable
      ORDER BY total DESC
    `;

    const rows = await dbAll(sql, []) as any[];

    // Commissionable history — only meaningful for a specific calendar month.
    // Snapshot-on-first-view, then attach that month's locked values to each row
    // so the frontend uses historical status/rate for past months instead of
    // whatever the tenant's live settings are today.
    if (period === 'month' && month) {
      const periodMonth = `${month}-01`;
      await ensureCommissionableSnapshots(rows, periodMonth);
      const tenantIds = rows.map(r => r.tenant_id);
      const logRows = tenantIds.length
        ? await dbAll(
            `SELECT tenant_id, is_commissionable, commission_rate FROM commissionable_status_log
             WHERE period_month = ? AND tenant_id IN (${tenantIds.map(() => '?').join(',')})`,
            [periodMonth, ...tenantIds],
          ) as any[]
        : [];
      const logByTenant = new Map(logRows.map(l => [l.tenant_id, l]));
      for (const row of rows) {
        const snap = logByTenant.get(row.tenant_id);
        row.snapshot_is_commissionable = snap ? snap.is_commissionable : row.is_commissionable;
        row.snapshot_commission_rate   = snap ? snap.commission_rate   : row.commission_rate;
      }
    }

    res.json({ success: true, data: rows });
  } catch (e: any) {
    console.error('[adminAnalytics/messages]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/analytics/summary?period=7d
// Returns platform-wide aggregate message counts
// ---------------------------------------------------------------------------
adminAnalyticsRouter.get('/summary', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || '7d';
    const month  = parseMonthParam(req.query.month) ?? undefined;
    const dateFilter = periodWhere(period, 'ml', month);

    const sql = `
      SELECT
        COALESCE(COUNT(*), 0)                                                                   AS total_messages,
        COALESCE(SUM(CASE WHEN ml.direction = 'inbound'  THEN 1 ELSE 0 END), 0)               AS total_inbound,
        COALESCE(SUM(CASE WHEN ml.direction = 'outbound' THEN 1 ELSE 0 END), 0)               AS total_outbound,
        COALESCE(SUM(CASE WHEN ml.provider = 'twilio' THEN 1 ELSE 0 END), 0)                  AS twilio_count,
        COALESCE(SUM(CASE WHEN ml.provider = 'meta'   THEN 1 ELSE 0 END), 0)                  AS meta_count,
        COALESCE(SUM(CASE WHEN ml.provider = 'twilio' AND ml.direction = 'inbound'  THEN 1 ELSE 0 END), 0) AS twilio_in,
        COALESCE(SUM(CASE WHEN ml.provider = 'twilio' AND ml.direction = 'outbound' THEN 1 ELSE 0 END), 0) AS twilio_out,
        COALESCE(SUM(CASE WHEN ml.provider = 'meta'   AND ml.direction = 'inbound'  THEN 1 ELSE 0 END), 0) AS meta_in,
        COALESCE(SUM(CASE WHEN ml.provider = 'meta'   AND ml.direction = 'outbound' THEN 1 ELSE 0 END), 0) AS meta_out
      FROM message_log ml
      WHERE ${dateFilter}
    `;

    const row = await dbGet(sql, []);
    res.json({ success: true, data: row ?? {} });
  } catch (e: any) {
    console.error('[adminAnalytics/summary]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/analytics/timeline?period=7d
// Returns day-by-day message counts for charting
// ---------------------------------------------------------------------------
adminAnalyticsRouter.get('/timeline', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || '7d';
    const dateFilter = periodWhere(period, 'ml');

    const sql = `
      SELECT
        ${isPg ? 'DATE((ml.created_at)::timestamptz)' : "DATE(ml.created_at)"} AS date,
        COALESCE(SUM(CASE WHEN ml.direction = 'inbound'  THEN 1 ELSE 0 END), 0) AS inbound,
        COALESCE(SUM(CASE WHEN ml.direction = 'outbound' THEN 1 ELSE 0 END), 0) AS outbound,
        COALESCE(COUNT(*), 0)                                                     AS total
      FROM message_log ml
      WHERE ${dateFilter}
      GROUP BY ${isPg ? 'DATE((ml.created_at)::timestamptz)' : 'DATE(ml.created_at)'}
      ORDER BY date ASC
    `;

    const rows = await dbAll(sql, []);
    res.json({ success: true, data: rows });
  } catch (e: any) {
    console.error('[adminAnalytics/timeline]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------------------------------------------------------------------------
// GET   /admin/analytics/infra-cost?month=2026-09
// PATCH /admin/analytics/infra-cost   { month: '2026-09' | '2026-09-01', amount, notes? }
// Platform-wide General & Infrastructure cost for a calendar month (Railway,
// R2, Resend, domains, etc.) — split evenly across 'live' tenants for the
// commission formula. Missing month → { amount: 0, notes: null } (safe default,
// never blocks the page from rendering).
// ---------------------------------------------------------------------------
function normaliseMonth(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
}

adminAnalyticsRouter.get('/infra-cost', async (req: Request, res: Response) => {
  try {
    const month = normaliseMonth(req.query.month) ?? normaliseMonth(new Date().toISOString().slice(0, 7));
    const row = await dbGet(
      `SELECT period_month, amount, notes FROM platform_monthly_costs WHERE period_month = ?`,
      [month],
    ) as any;
    res.json({ success: true, data: row ?? { period_month: month, amount: 0, notes: null } });
  } catch (e: any) {
    console.error('[adminAnalytics/infra-cost GET]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

adminAnalyticsRouter.patch('/infra-cost', async (req: Request, res: Response) => {
  try {
    const month = normaliseMonth(req.body?.month);
    const amount = Number(req.body?.amount);
    const notes = req.body?.notes ?? null;
    if (!month) return res.status(400).json({ success: false, error: "month is required, format 'YYYY-MM'" });
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ success: false, error: 'amount must be a non-negative number' });

    if (isPg) {
      await dbRun(
        `INSERT INTO platform_monthly_costs (id, period_month, amount, notes)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (period_month) DO UPDATE SET amount = excluded.amount, notes = excluded.notes, updated_at = NOW()`,
        [crypto.randomUUID(), month, amount, notes],
      );
    } else {
      await dbRun(
        `INSERT INTO platform_monthly_costs (id, period_month, amount, notes)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (period_month) DO UPDATE SET amount = excluded.amount, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP`,
        [crypto.randomUUID(), month, amount, notes],
      );
    }

    const row = await dbGet(`SELECT period_month, amount, notes FROM platform_monthly_costs WHERE period_month = ?`, [month]);
    res.json({ success: true, data: row });
  } catch (e: any) {
    console.error('[adminAnalytics/infra-cost PATCH]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/analytics/projection-defaults
// Seeds the Scaling Projection tool with sensible starting values derived
// from 'live' tenants' last-30-days message volume + current infra cost.
// These are starting points for the projection form, not authoritative —
// all projection math runs client-side off whatever the user tweaks them to.
// ---------------------------------------------------------------------------
const PROJECTION_FALLBACK_PRICE = 79;
const CLAUDE_RATE_DEFAULT   = 0.008; // mirrors CostAnalyticsPage.tsx DEFAULTS.claudePerMessage
const TWILIO_RATE_DEFAULT  = 0.005;  // mirrors CostAnalyticsPage.tsx DEFAULTS.twilioInbound/Outbound

adminAnalyticsRouter.get('/projection-defaults', async (_req: Request, res: Response) => {
  try {
    const dateFilter = periodWhere('30d', 'ml');
    const sql = `
      SELECT
        t.monthly_price   AS monthly_price,
        t.commission_rate AS commission_rate,
        COALESCE(COUNT(ml.id), 0) AS total_messages
      FROM tenants t
      LEFT JOIN message_log ml ON ml.tenant_id = t.id AND ${dateFilter}
      WHERE t.deleted_at IS NULL AND t.environment = 'live'
      GROUP BY t.id, t.monthly_price, t.commission_rate
    `;
    const rows = await dbAll(sql, []) as any[];

    const currentMonth = normaliseMonth(new Date().toISOString().slice(0, 7))!;
    const infraRow = await dbGet(
      `SELECT amount FROM platform_monthly_costs WHERE period_month = ?`, [currentMonth],
    ) as any;

    const liveCount = rows.length;
    const avg = (fn: (r: any) => number) => liveCount > 0 ? rows.reduce((s, r) => s + fn(r), 0) / liveCount : 0;

    const avgPrice = liveCount > 0
      ? avg(r => Number(r.monthly_price) || PROJECTION_FALLBACK_PRICE)
      : PROJECTION_FALLBACK_PRICE;
    const avgMessages = avg(r => Number(r.total_messages) || 0);
    const avgCommissionRate = liveCount > 0 ? avg(r => Number(r.commission_rate) || 50) : 50;

    res.json({
      success: true,
      data: {
        avgPrice:            Math.round(avgPrice * 100) / 100,
        avgClaudeCost:       Math.round(avgMessages * CLAUDE_RATE_DEFAULT * 100) / 100,
        avgWhatsappCost:     Math.round(avgMessages * TWILIO_RATE_DEFAULT * 100) / 100,
        currentInfraCost:    Number(infraRow?.amount) || 0,
        currentCommissionRate: Math.round(avgCommissionRate * 100) / 100,
      },
    });
  } catch (e: any) {
    console.error('[adminAnalytics/projection-defaults]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});
