import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { requireAuth, resolveTenantId } from '../middleware/auth.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';

export const shopRouter = Router();

async function dbAll(sql: string, ...p: unknown[]) { return (isPg ? query(sql, p) : prepare(sql).all(...p)) as any[]; }
async function dbGet(sql: string, ...p: unknown[]) { return (isPg ? queryOne(sql, p) : prepare(sql).get(...p)) as any; }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'shop');

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); cb(null, UPLOAD_DIR); },
    filename: (_, file, cb) => { cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`); },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => { cb(null, file.mimetype.startsWith('image/')); },
});

function baseUrl(): string {
  return process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.VITE_API_URL || 'http://localhost:3001';
}

// ── Config ─────────────────────────────────────────────────────────────────────

shopRouter.get('/config', requireAuth, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    let cfg = await dbGet(`SELECT * FROM shop_config WHERE tenant_id = ?`, tenantId);
    if (!cfg) {
      const id = crypto.randomUUID();
      await dbRun(`INSERT INTO shop_config (id, tenant_id) VALUES (?,?)`, id, tenantId);
      cfg = { id, tenant_id: tenantId, estimated_pickup_minutes: 15, pickup_mode: 'estimated', agent_personality: 'friendly' };
    }
    res.json({ success: true, data: cfg });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.put('/config', requireAuth, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const {
      shop_name, opening_hours, estimated_pickup_minutes, pickup_mode, agent_personality,
      fallback_message, fallback_backup_number, fallback_after_attempts,
      address, instagram_url, facebook_url, tiktok_url, website_url, phone,
    } = req.body;
    const exists = await dbGet(`SELECT id FROM shop_config WHERE tenant_id = ?`, tenantId);
    if (exists) {
      await dbRun(
        `UPDATE shop_config SET shop_name=?,opening_hours=?,estimated_pickup_minutes=?,pickup_mode=?,agent_personality=?,fallback_message=?,fallback_backup_number=?,fallback_after_attempts=?,address=?,instagram_url=?,facebook_url=?,tiktok_url=?,website_url=?,phone=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?`,
        shop_name, opening_hours, estimated_pickup_minutes, pickup_mode, agent_personality, fallback_message, fallback_backup_number, fallback_after_attempts, address, instagram_url, facebook_url, tiktok_url, website_url, phone, tenantId,
      );
    } else {
      await dbRun(
        `INSERT INTO shop_config (id,tenant_id,shop_name,opening_hours,estimated_pickup_minutes,pickup_mode,agent_personality,fallback_message,fallback_backup_number,fallback_after_attempts,address,instagram_url,facebook_url,tiktok_url,website_url,phone) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        crypto.randomUUID(), tenantId, shop_name, opening_hours, estimated_pickup_minutes, pickup_mode, agent_personality, fallback_message, fallback_backup_number, fallback_after_attempts, address, instagram_url, facebook_url, tiktok_url, website_url, phone,
      );
    }
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Categories ─────────────────────────────────────────────────────────────────

shopRouter.get('/categories', requireAuth, async (req: any, res: Response) => {
  try {
    const cats = await dbAll(`SELECT * FROM shop_menu_categories WHERE tenant_id = ? ORDER BY sort_order ASC`, resolveTenantId(req));
    res.json({ success: true, data: cats });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.post('/categories', requireAuth, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { name, description, sort_order } = req.body;
    const id = crypto.randomUUID();
    await dbRun(`INSERT INTO shop_menu_categories (id,tenant_id,name,description,sort_order) VALUES (?,?,?,?,?)`, id, tenantId, name, description, sort_order ?? 0);
    res.json({ success: true, data: { id } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.put('/categories/:id', requireAuth, async (req: any, res: Response) => {
  try {
    const { name, description, sort_order, is_active } = req.body;
    await dbRun(
      `UPDATE shop_menu_categories SET name=?,description=?,sort_order=?,is_active=? WHERE id=? AND tenant_id=?`,
      name, description, sort_order ?? 0, is_active !== undefined ? (is_active ? 1 : 0) : 1, req.params.id, resolveTenantId(req),
    );
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.delete('/categories/:id', requireAuth, async (req: any, res: Response) => {
  try {
    await dbRun(`DELETE FROM shop_menu_categories WHERE id=? AND tenant_id=?`, req.params.id, resolveTenantId(req));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Items ──────────────────────────────────────────────────────────────────────

shopRouter.get('/items', requireAuth, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { category_id } = req.query as { category_id?: string };
    let sql = `SELECT i.*, c.name AS category_name FROM shop_menu_items i LEFT JOIN shop_menu_categories c ON i.category_id = c.id WHERE i.tenant_id = ?`;
    const params: unknown[] = [tenantId];
    if (category_id) { sql += ` AND i.category_id = ?`; params.push(category_id); }
    sql += ` ORDER BY i.sort_order ASC`;
    const items = await dbAll(sql, ...params);
    res.json({ success: true, data: items });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.post('/items', requireAuth, upload.single('photo'), async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { name, description, price, currency, category_id, stock_type, stock_limit, sort_order } = req.body;
    const id = crypto.randomUUID();
    const photo_filename = req.file?.filename || null;
    const photo_url = photo_filename ? `${baseUrl()}/uploads/shop/${photo_filename}` : null;
    await dbRun(
      `INSERT INTO shop_menu_items (id,tenant_id,category_id,name,description,price,currency,photo_url,photo_filename,stock_type,stock_limit,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, tenantId, category_id || null, name, description, parseFloat(price), currency || 'ALL', photo_url, photo_filename, stock_type || 'unlimited', stock_limit ? parseInt(stock_limit) : null, sort_order ?? 0,
    );
    res.json({ success: true, data: { id, photo_url } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.put('/items/:id', requireAuth, upload.single('photo'), async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const existing = await dbGet(`SELECT photo_filename FROM shop_menu_items WHERE id=? AND tenant_id=?`, req.params.id, tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Not found' });

    let photo_filename: string | null = existing.photo_filename || null;
    let photo_url: string | null = null;
    if (req.file) {
      if (photo_filename) { const old = path.join(UPLOAD_DIR, photo_filename); if (fs.existsSync(old)) fs.unlinkSync(old); }
      photo_filename = req.file.filename;
      photo_url = `${baseUrl()}/uploads/shop/${photo_filename}`;
    }

    const { name, description, price, currency, category_id, stock_type, stock_limit, stock_used, is_active, sort_order } = req.body;
    await dbRun(
      `UPDATE shop_menu_items SET name=?,description=?,price=?,currency=?,category_id=?,stock_type=?,stock_limit=?,stock_used=?,is_active=?,sort_order=?,photo_url=COALESCE(?,photo_url),photo_filename=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`,
      name, description, parseFloat(price), currency || 'ALL', category_id || null,
      stock_type || 'unlimited', stock_limit !== undefined ? parseInt(stock_limit) : null,
      stock_used !== undefined ? parseInt(stock_used) : undefined,
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
      sort_order ?? 0,
      photo_url, photo_filename,
      req.params.id, tenantId,
    );
    res.json({ success: true, data: { photo_url: photo_url || undefined } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.delete('/items/:id', requireAuth, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const item = await dbGet(`SELECT photo_filename FROM shop_menu_items WHERE id=? AND tenant_id=?`, req.params.id, tenantId);
    if (item?.photo_filename) {
      const fp = path.join(UPLOAD_DIR, item.photo_filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await dbRun(`DELETE FROM shop_menu_items WHERE id=? AND tenant_id=?`, req.params.id, tenantId);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Orders ─────────────────────────────────────────────────────────────────────

shopRouter.get('/orders', requireAuth, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    console.log('[Shop] GET /shop/orders tenantId:', tenantId);
    const { status, date } = req.query as { status?: string; date?: string };
    let sql = `SELECT * FROM shop_orders WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];
    if (status && status !== 'all') { sql += ` AND status = ?`; params.push(status); }
    if (date) { sql += ` AND order_date = ?`; params.push(date); }
    sql += ` ORDER BY created_at DESC`;
    const orders = await dbAll(sql, ...params);

    if (orders.length > 0) {
      const ids = orders.map((o: any) => o.id);
      const ph = ids.map(() => '?').join(',');
      const allItems = await dbAll(`SELECT * FROM shop_order_items WHERE order_id IN (${ph})`, ...ids);
      for (const order of orders) order.items = allItems.filter((i: any) => i.order_id === order.id);
    }

    console.log('[Shop] orders found:', orders.length);
    res.json({ success: true, data: orders });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.patch('/orders/:id', requireAuth, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { status } = req.body as { status: string };
    const order = await dbGet(`SELECT * FROM shop_orders WHERE id=? AND tenant_id=?`, req.params.id, tenantId);
    if (!order) return res.status(404).json({ success: false, error: 'Not found' });

    const tsCol: Record<string, string> = {
      in_progress: 'in_progress_at', done: 'done_at', picked_up: 'picked_up_at', cancelled: 'cancelled_at',
    };
    const ts = tsCol[status];
    if (ts) {
      await dbRun(`UPDATE shop_orders SET status=?, ${ts}=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`, status, req.params.id, tenantId);
    } else {
      await dbRun(`UPDATE shop_orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`, status, req.params.id, tenantId);
    }

    // Notify guest when order is ready
    if (status === 'done') {
      try {
        const tenant = await dbGet(`SELECT * FROM tenants WHERE id=?`, tenantId);
        const cfg = await dbGet(`SELECT shop_name FROM shop_config WHERE tenant_id=?`, tenantId);
        const shopName = cfg?.shop_name || tenant?.name || 'our shop';
        const msg = `✅ Your order #${order.order_number} from ${shopName} is ready for pickup! Please come to the counter.`;
        await sendWhatsAppMessage(order.guest_phone, msg, tenant);
      } catch (e: any) { console.error('[Shop] WA notify failed:', e.message); }
    }

    // Restore stock on cancellation
    if (status === 'cancelled' && order.status !== 'cancelled') {
      const orderItems = await dbAll(`SELECT item_id, quantity FROM shop_order_items WHERE order_id=?`, req.params.id);
      for (const oi of orderItems) {
        const restoreSql = isPg
          ? `UPDATE shop_menu_items SET stock_used = GREATEST(0, stock_used - ?) WHERE id=? AND stock_type != 'unlimited'`
          : `UPDATE shop_menu_items SET stock_used = max(0, stock_used - ?) WHERE id=? AND stock_type != 'unlimited'`;
        await dbRun(restoreSql, oi.quantity, oi.item_id);
      }
    }

    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── FAQ ────────────────────────────────────────────────────────────────────────

shopRouter.get('/faq', requireAuth, async (req: any, res: Response) => {
  try {
    const rows = await dbAll(`SELECT * FROM shop_faq WHERE tenant_id=? ORDER BY sort_order ASC`, resolveTenantId(req));
    res.json({ success: true, data: rows });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.post('/faq', requireAuth, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { question, answer, sort_order } = req.body;
    const id = crypto.randomUUID();
    await dbRun(`INSERT INTO shop_faq (id,tenant_id,question,answer,sort_order) VALUES (?,?,?,?,?)`, id, tenantId, question, answer, sort_order ?? 0);
    res.json({ success: true, data: { id } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.put('/faq/:id', requireAuth, async (req: any, res: Response) => {
  try {
    const { question, answer, sort_order } = req.body;
    await dbRun(`UPDATE shop_faq SET question=?,answer=?,sort_order=? WHERE id=? AND tenant_id=?`, question, answer, sort_order ?? 0, req.params.id, resolveTenantId(req));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.delete('/faq/:id', requireAuth, async (req: any, res: Response) => {
  try {
    await dbRun(`DELETE FROM shop_faq WHERE id=? AND tenant_id=?`, req.params.id, resolveTenantId(req));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Conversations ──────────────────────────────────────────────────────────────

shopRouter.get('/conversations', requireAuth, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    console.log('[Shop] GET /shop/conversations tenantId:', tenantId);
    const rows = await dbAll(
      `SELECT id, guest_phone, cart_state, created_at, updated_at FROM shop_conversations WHERE tenant_id=? ORDER BY updated_at DESC`,
      tenantId,
    );
    console.log('[Shop] conversations found:', rows.length);
    res.json({ success: true, data: rows });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.get('/conversations/:phone', requireAuth, async (req: any, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const conv = await dbGet(`SELECT * FROM shop_conversations WHERE tenant_id=? AND guest_phone=?`, resolveTenantId(req), phone);
    if (!conv) return res.status(404).json({ success: false, error: 'Not found' });
    try { conv.messages = JSON.parse(conv.messages || '[]'); } catch { conv.messages = []; }
    res.json({ success: true, data: conv });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.delete('/conversations/:phone', requireAuth, async (req: any, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const now = new Date().toISOString();
    await dbRun(
      `UPDATE shop_conversations SET messages = '[]', cart = '[]', cart_state = 'idle', updated_at = ? WHERE tenant_id=? AND guest_phone=?`,
      now, resolveTenantId(req), phone,
    );
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// Clear all conversations for this tenant (admin convenience — resets all AI memory)
shopRouter.delete('/conversations', requireAuth, async (req: any, res: Response) => {
  try {
    const now = new Date().toISOString();
    await dbRun(
      `UPDATE shop_conversations SET messages = '[]', cart = '[]', cart_state = 'idle', updated_at = ? WHERE tenant_id=?`,
      now, resolveTenantId(req),
    );
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Analytics ──────────────────────────────────────────────────────────────────

shopRouter.get('/analytics', requireAuth, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const days = Math.min(parseInt(String(req.query.days || '7')), 90);
    const sql = isPg
      ? `SELECT order_date, COUNT(*) AS total_orders, SUM(total_price) AS revenue FROM shop_orders WHERE tenant_id=? AND status != 'cancelled' AND order_date >= CURRENT_DATE - INTERVAL '${days} days' GROUP BY order_date ORDER BY order_date DESC`
      : `SELECT order_date, COUNT(*) AS total_orders, SUM(total_price) AS revenue FROM shop_orders WHERE tenant_id=? AND status != 'cancelled' AND order_date >= date('now','-${days} days') GROUP BY order_date ORDER BY order_date DESC`;
    const rows = await dbAll(sql, tenantId);
    res.json({ success: true, data: rows });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});
