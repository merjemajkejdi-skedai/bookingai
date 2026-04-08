import { Router, Request, Response } from 'express';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { requireAuth, resolveTenantId } from '../middleware/auth.js';

export const skedaiRouter = Router();

const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, status = 400) =>
  res.status(status).json({ success: false, error: msg });

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}
async function dbRun(sql: string, ...p: unknown[]) {
  if (isPg) return queryRun(sql, p);
  prepare(sql).run(...p);
}

// Ensure a config row exists for this tenant
async function ensureRow(tenantId: string) {
  const exists = await dbGet('SELECT tenant_id FROM skedai_config WHERE tenant_id = ?', tenantId);
  if (!exists) {
    await dbRun(
      `INSERT INTO skedai_config (tenant_id) VALUES (?)`,
      tenantId,
    );
  }
}

function parseJson(raw: any, fallback: unknown) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw || '[]'); } catch { return fallback; }
}

function mapRow(row: any) {
  return {
    forwardPhone:     row.forward_phone     || '',
    calendlyUrl:      row.calendly_url      || '',
    supportFaq:       parseJson(row.support_faq,       []),
    healthCheckUrls:  parseJson(row.health_check_urls, []),
    industries:       parseJson(row.industries,        []),
  };
}

// ── GET full config ───────────────────────────────────────────────────────────
skedaiRouter.get('/skedai/config', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await ensureRow(tenantId);
    const row = await dbGet('SELECT * FROM skedai_config WHERE tenant_id = ?', tenantId) as any;
    ok(res, mapRow(row));
  } catch (e: any) { err(res, e.message, 500); }
});

// ── PUT admin tab (forward phone + Calendly URL) ───────────────────────────────
skedaiRouter.put('/skedai/config/admin', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { forwardPhone = '', calendlyUrl = '' } = req.body;
  try {
    await ensureRow(tenantId);
    await dbRun(
      'UPDATE skedai_config SET forward_phone = ?, calendly_url = ? WHERE tenant_id = ?',
      forwardPhone, calendlyUrl, tenantId,
    );
    ok(res, { forwardPhone, calendlyUrl });
  } catch (e: any) { err(res, e.message, 500); }
});

// ── PUT support tab (FAQ + health check URLs) ─────────────────────────────────
skedaiRouter.put('/skedai/config/support', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { supportFaq = [], healthCheckUrls = [] } = req.body;
  try {
    await ensureRow(tenantId);
    await dbRun(
      'UPDATE skedai_config SET support_faq = ?, health_check_urls = ? WHERE tenant_id = ?',
      JSON.stringify(supportFaq), JSON.stringify(healthCheckUrls), tenantId,
    );
    ok(res, { supportFaq, healthCheckUrls });
  } catch (e: any) { err(res, e.message, 500); }
});

// ── PUT sales tab (industries + tiers) ───────────────────────────────────────
skedaiRouter.put('/skedai/config/sales', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { industries = [] } = req.body;
  try {
    await ensureRow(tenantId);
    await dbRun(
      'UPDATE skedai_config SET industries = ? WHERE tenant_id = ?',
      JSON.stringify(industries), tenantId,
    );
    ok(res, { industries });
  } catch (e: any) { err(res, e.message, 500); }
});
