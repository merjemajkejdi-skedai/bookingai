import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { requireAuth, resolveTenantId } from '../middleware/auth.js';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';
import { sendInstagramMessage } from '../channels/instagram.js';
import { sendMessengerMessage } from '../channels/messenger.js';
import { appendAirbnbStaffMessage } from '../airbnb/session.js';

export const airbnbRouter = Router();

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, status = 400) =>
  res.status(status).json({ success: false, error: msg });

// ═══════════════════════════════════════════════════════════════════════════
// LISTINGS
// ═══════════════════════════════════════════════════════════════════════════

airbnbRouter.get('/listings', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll('SELECT * FROM airbnb_listings WHERE tenant_id = ? ORDER BY created_at ASC', tenantId);
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.post('/listings', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, address, config } = req.body;
  if (!name || !address) return err(res, 'name and address are required');
  try {
    const id = crypto.randomUUID();
    const configJson = typeof config === 'object' ? JSON.stringify(config ?? {}) : (config ?? '{}');
    await dbRun(
      `INSERT INTO airbnb_listings (id, tenant_id, name, address, config) VALUES (?,?,?,?,?)`,
      id, tenantId, name, address, configJson,
    );
    const row = await dbGet('SELECT * FROM airbnb_listings WHERE id = ?', id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.put('/listings/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, address, config, is_active } = req.body;
  try {
    const configJson = config !== undefined
      ? (typeof config === 'object' ? JSON.stringify(config) : config)
      : undefined;
    await dbRun(
      `UPDATE airbnb_listings SET
         name = COALESCE(?, name),
         address = COALESCE(?, address),
         config = COALESCE(?, config),
         is_active = COALESCE(?, is_active),
         updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      name ?? null, address ?? null, configJson ?? null, is_active ?? null, req.params.id, tenantId,
    );
    const row = await dbGet('SELECT * FROM airbnb_listings WHERE id = ?', req.params.id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.delete('/listings/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun('DELETE FROM airbnb_listings WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// FAQS (scoped to a listing)
// ═══════════════════════════════════════════════════════════════════════════

airbnbRouter.get('/faqs', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const listingId = req.query.listingId as string;
  if (!listingId) return err(res, 'listingId is required');
  try {
    const rows = await dbAll(
      'SELECT * FROM airbnb_faqs WHERE tenant_id = ? AND listing_id = ? ORDER BY category, question',
      tenantId, listingId,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.post('/faqs', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { listing_id, question, answer, category } = req.body;
  if (!listing_id || !question || !answer) return err(res, 'listing_id, question and answer are required');
  try {
    const listing = await dbGet('SELECT id FROM airbnb_listings WHERE id = ? AND tenant_id = ?', listing_id, tenantId);
    if (!listing) return err(res, 'Listing not found', 404);

    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO airbnb_faqs (id, tenant_id, listing_id, category, question, answer) VALUES (?,?,?,?,?,?)`,
      id, tenantId, listing_id, category ?? null, question, answer,
    );
    const row = await dbGet('SELECT * FROM airbnb_faqs WHERE id = ?', id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.put('/faqs/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { question, answer, category } = req.body;
  try {
    await dbRun(
      `UPDATE airbnb_faqs SET
         question = COALESCE(?, question),
         answer = COALESCE(?, answer),
         category = ?,
         updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      question ?? null, answer ?? null, category ?? null, req.params.id, tenantId,
    );
    const row = await dbGet('SELECT * FROM airbnb_faqs WHERE id = ?', req.params.id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.delete('/faqs/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun('DELETE FROM airbnb_faqs WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// REQUESTS
// ═══════════════════════════════════════════════════════════════════════════

airbnbRouter.get('/requests', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const status = (req.query.status as string) || 'open';
  const listingId = (req.query.listingId as string) || '';
  const resolvedAfter  = (req.query.resolvedAfter  as string) || '';
  const resolvedBefore = (req.query.resolvedBefore as string) || '';
  try {
    let sql = `SELECT r.*, l.name as listing_name FROM airbnb_requests r
       JOIN airbnb_listings l ON l.id = r.listing_id
       WHERE r.tenant_id = ?`;
    const params: any[] = [tenantId];

    if (listingId) { sql += ' AND r.listing_id = ?'; params.push(listingId); }

    if (status !== 'all') { sql += ' AND r.status = ?'; params.push(status); }
    if (status === 'resolved') {
      if (resolvedAfter)  { sql += ' AND r.resolved_at >= ?'; params.push(resolvedAfter); }
      if (resolvedBefore) { sql += ' AND r.resolved_at <= ?'; params.push(resolvedBefore); }
      sql += ' ORDER BY r.resolved_at DESC';
    } else {
      sql += ` ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at DESC`;
    }

    const rows = await dbAll(sql, ...params);
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.patch('/requests/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { status } = req.body;
  if (!status) return err(res, 'status is required');
  try {
    const sets = ['status = ?'];
    const params: any[] = [status];
    if (status === 'resolved') sets.push('resolved_at = NOW()');
    params.push(req.params.id, tenantId);
    await dbRun(`UPDATE airbnb_requests SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, ...params);
    const row = await dbGet(
      `SELECT r.*, l.name as listing_name FROM airbnb_requests r
       JOIN airbnb_listings l ON l.id = r.listing_id WHERE r.id = ?`,
      req.params.id,
    );
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATIONS
// ═══════════════════════════════════════════════════════════════════════════

airbnbRouter.get('/conversations', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      `SELECT c.id, c.tenant_id, c.listing_id, l.name as listing_name, c.channel, c.channel_user_id,
              c.ai_paused_until, c.updated_at, c.created_at
       FROM airbnb_conversations c
       LEFT JOIN airbnb_listings l ON l.id = c.listing_id
       WHERE c.tenant_id = ?
       ORDER BY c.updated_at DESC`,
      tenantId,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.get('/conversations/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const row = await dbGet(
      `SELECT c.*, l.name as listing_name FROM airbnb_conversations c
       LEFT JOIN airbnb_listings l ON l.id = c.listing_id
       WHERE c.id = ? AND c.tenant_id = ?`,
      req.params.id, tenantId,
    );
    if (!row) return err(res, 'Conversation not found', 404);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.post('/conversations/:id/reply', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { message } = req.body;
  if (!message) return err(res, 'message is required');
  try {
    const conv = await dbGet(
      'SELECT * FROM airbnb_conversations WHERE id = ? AND tenant_id = ?',
      req.params.id, tenantId,
    ) as any;
    if (!conv) return err(res, 'Conversation not found', 404);

    const tenant = await dbGet('SELECT * FROM tenants WHERE id = ?', tenantId) as any;
    const channel = (conv.channel || 'whatsapp').toLowerCase();

    if (channel === 'whatsapp') {
      await sendWhatsAppMessage(conv.channel_user_id, message, tenant);
    } else if (channel === 'instagram') {
      const accessToken = (tenant?.ig_access_token || '') as string;
      if (accessToken) await sendInstagramMessage(conv.channel_user_id, message, accessToken);
    } else if (channel === 'messenger' || channel === 'facebook') {
      const encryptedToken = (tenant?.messenger_access_token_encrypted || '') as string;
      if (encryptedToken && tenant?.messenger_page_id) {
        await sendMessengerMessage(tenant.messenger_page_id, conv.channel_user_id, message, encryptedToken);
      }
    }

    await appendAirbnbStaffMessage(conv.id, message);
    ok(res, { sent: true });
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.post('/conversations/:id/takeover', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const minutes = req.body.minutes || 60;
  try {
    const until = new Date(Date.now() + minutes * 60_000).toISOString();
    await dbRun(
      'UPDATE airbnb_conversations SET ai_paused_until = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?',
      until, req.params.id, tenantId,
    );
    ok(res, { paused_until: until });
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.post('/conversations/:id/resume', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun(
      'UPDATE airbnb_conversations SET ai_paused_until = NULL, updated_at = NOW() WHERE id = ? AND tenant_id = ?',
      req.params.id, tenantId,
    );
    ok(res, { resumed: true });
  } catch (e: any) { err(res, e.message, 500); }
});
