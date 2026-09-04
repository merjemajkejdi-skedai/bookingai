// ---------------------------------------------------------------------------
// adminAnalytics.ts — Cost analytics endpoints (admin only)
// All routes require requireAuth + requireAdmin middleware.
// ---------------------------------------------------------------------------
import { Router, type Request, type Response } from 'express';
import { isPg, query, queryOne, prepare } from '../db/database.js';
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

/**
 * Returns a WHERE-clause fragment (no leading WHERE) for message_log.created_at.
 * The table alias 'ml' is used to qualify the column.
 *
 * PG note: created_at is stored as TEXT so we cast it to timestamptz before
 * comparing against NOW() which returns timestamptz.
 */
function periodWhere(period: string, alias = 'ml'): string {
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
// Returns per-tenant message counts broken down by direction and provider
// ---------------------------------------------------------------------------
adminAnalyticsRouter.get('/messages', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || '7d';
    const dateFilter = periodWhere(period, 'ml');

    // Build the query — LEFT JOIN includes date filter so tenants with 0 msgs
    // still appear in the result with 0 counts
    const joinCondition = dateFilter === '1=1'
      ? 'ml.tenant_id = t.id'
      : `ml.tenant_id = t.id AND ${dateFilter}`;

    const sql = `
      SELECT
        t.id         AS tenant_id,
        t.name       AS tenant_name,
        t.type       AS tenant_type,
        t.plan       AS plan,
        t.is_active  AS is_active,
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
      GROUP BY t.id, t.name, t.type, t.plan, t.is_active
      ORDER BY total DESC
    `;

    const rows = await dbAll(sql, []);
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
    const dateFilter = periodWhere(period, 'ml');

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
