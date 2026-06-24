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
      manual_orders_enabled,
    } = req.body;
    const manualEnabled = manual_orders_enabled ? 1 : 0;
    const exists = await dbGet(`SELECT id FROM shop_config WHERE tenant_id = ?`, tenantId);
    if (exists) {
      await dbRun(
        `UPDATE shop_config SET shop_name=?,opening_hours=?,estimated_pickup_minutes=?,pickup_mode=?,agent_personality=?,fallback_message=?,fallback_backup_number=?,fallback_after_attempts=?,manual_orders_enabled=?,address=?,instagram_url=?,facebook_url=?,tiktok_url=?,website_url=?,phone=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?`,
        shop_name, opening_hours, estimated_pickup_minutes, pickup_mode, agent_personality, fallback_message, fallback_backup_number, fallback_after_attempts, manualEnabled, address, instagram_url, facebook_url, tiktok_url, website_url, phone, tenantId,
      );
    } else {
      await dbRun(
        `INSERT INTO shop_config (id,tenant_id,shop_name,opening_hours,estimated_pickup_minutes,pickup_mode,agent_personality,fallback_message,fallback_backup_number,fallback_after_attempts,manual_orders_enabled,address,instagram_url,facebook_url,tiktok_url,website_url,phone) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        crypto.randomUUID(), tenantId, shop_name, opening_hours, estimated_pickup_minutes, pickup_mode, agent_personality, fallback_message, fallback_backup_number, fallback_after_attempts, manualEnabled, address, instagram_url, facebook_url, tiktok_url, website_url, phone,
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
    const { status, is_paid } = req.body as { status?: string; is_paid?: boolean };
    const order = await dbGet(`SELECT * FROM shop_orders WHERE id=? AND tenant_id=?`, req.params.id, tenantId);
    if (!order) return res.status(404).json({ success: false, error: 'Not found' });

    // Block unpaid manual orders from moving to Picked Up
    if (status === 'picked_up' && order.source === 'manual' && !order.is_paid) {
      return res.status(400).json({ success: false, error: 'Mark order as paid before moving to Picked Up' });
    }

    // Handle is_paid toggle
    if (is_paid !== undefined) {
      const newPaid = is_paid ? 1 : 0;
      if (newPaid && !order.is_paid) {
        await dbRun(`UPDATE shop_orders SET is_paid=?, paid_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`, newPaid, req.params.id, tenantId);
      } else {
        await dbRun(`UPDATE shop_orders SET is_paid=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`, newPaid, req.params.id, tenantId);
      }
    }

    // Handle status change
    if (status) {
      const tsCol: Record<string, string> = {
        in_progress: 'in_progress_at', done: 'done_at', picked_up: 'picked_up_at', cancelled: 'cancelled_at',
      };
      const ts = tsCol[status];
      if (ts) {
        await dbRun(`UPDATE shop_orders SET status=?, ${ts}=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`, status, req.params.id, tenantId);
      } else {
        await dbRun(`UPDATE shop_orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`, status, req.params.id, tenantId);
      }

      // Notify guest when order is ready (skip manual orders without a phone)
      if (status === 'done' && order.guest_phone) {
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
    }

    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Manual Order Creation ──────────────────────────────────────────────────────

shopRouter.post('/orders/manual', requireAuth, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);

    const cfg = await dbGet(`SELECT manual_orders_enabled FROM shop_config WHERE tenant_id=?`, tenantId);
    if (!cfg?.manual_orders_enabled) {
      return res.status(403).json({ success: false, error: 'Manual orders are not enabled for this shop' });
    }

    const { items, pickup_name, guest_phone, notes } = req.body as {
      items: { item_id: string; quantity: number }[];
      pickup_name?: string; guest_phone?: string; notes?: string;
    };
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one item is required' });
    }

    // Load menu items — dual-DB IN clause
    const itemIds: string[] = items.map((i) => i.item_id);
    const ph = itemIds.map(() => '?').join(',');
    const menuItems = await dbAll(
      `SELECT id, name, price, currency, stock_type, stock_limit, stock_used FROM shop_menu_items WHERE tenant_id=? AND id IN (${ph}) AND is_active=1`,
      tenantId, ...itemIds,
    );
    const itemMap = new Map(menuItems.map((i: any) => [i.id, i]));

    // Validate stock
    const outOfStock: string[] = [];
    for (const oi of items) {
      const mi = itemMap.get(oi.item_id);
      if (!mi) { outOfStock.push(oi.item_id); continue; }
      if ((mi as any).stock_type !== 'unlimited') {
        const remaining = ((mi as any).stock_limit || 0) - ((mi as any).stock_used || 0);
        if (remaining < oi.quantity) outOfStock.push((mi as any).name);
      }
    }
    if (outOfStock.length > 0) {
      return res.status(400).json({ success: false, error: 'Some items are out of stock', out_of_stock: outOfStock });
    }

    // Calculate total & build order lines
    let total = 0;
    const orderLines = items.map((oi) => {
      const mi = itemMap.get(oi.item_id) as any;
      const subtotal = parseFloat(mi.price) * oi.quantity;
      total += subtotal;
      return { item_id: oi.item_id, item_name: mi.name, item_price: parseFloat(mi.price), quantity: oi.quantity, subtotal, currency: mi.currency };
    });

    // Next order number for today — use JS date string to avoid text=date cast error in PG
    const today = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
    const numRows = await dbAll(
      `SELECT COALESCE(MAX(order_number), 0) + 1 AS next_num FROM shop_orders WHERE tenant_id=? AND order_date=?`,
      tenantId, today,
    );
    const orderNumber = (numRows[0] as any)?.next_num || 1;

    // Create order — manual orders start as in_progress
    const orderId = crypto.randomUUID();
    const now = new Date().toISOString();
    const currency = orderLines[0]?.currency || 'ALL';
    await dbRun(
      `INSERT INTO shop_orders (id,tenant_id,order_number,order_date,guest_phone,pickup_name,status,total_price,currency,notes,source,in_progress_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,'in_progress',?,?,?,'manual',CURRENT_TIMESTAMP,?,?)`,
      orderId, tenantId, orderNumber, today, guest_phone || null, pickup_name || null, total, currency, notes || null, now, now,
    );

    // Insert order items
    for (const line of orderLines) {
      await dbRun(
        `INSERT INTO shop_order_items (id,order_id,tenant_id,item_id,item_name,item_price,quantity,subtotal) VALUES (?,?,?,?,?,?,?,?)`,
        crypto.randomUUID(), orderId, tenantId, line.item_id, line.item_name, line.item_price, line.quantity, line.subtotal,
      );
    }

    // Decrement stock
    for (const line of orderLines) {
      await dbRun(
        `UPDATE shop_menu_items SET stock_used = stock_used + ?, updated_at = CURRENT_TIMESTAMP WHERE id=? AND stock_type != 'unlimited'`,
        line.quantity, line.item_id,
      );
    }

    console.log(`[Shop] Manual order #${orderNumber} created by staff`);
    res.json({ success: true, data: { order_id: orderId, order_number: orderNumber, total, status: 'in_progress' } });
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

// ── Reports ────────────────────────────────────────────────────────────────────

function shopDateFilter(period: string, alias = 'so'): string {
  const col = alias ? `${alias}.created_at` : 'created_at';
  if (isPg) {
    // created_at is stored as TEXT — cast to timestamptz for PG comparisons
    const ts = `(${col})::timestamptz`;
    switch (period) {
      case 'today': return `DATE(${ts}) = CURRENT_DATE`;
      case '7d':    return `${ts} >= NOW() - INTERVAL '7 days'`;
      case 'ytd':   return `DATE_TRUNC('year', ${ts}) = DATE_TRUNC('year', NOW())`;
      default:      return `${ts} >= NOW() - INTERVAL '30 days'`;
    }
  }
  switch (period) {
    case 'today': return `DATE(${col}) = DATE('now')`;
    case '7d':    return `${col} >= datetime('now', '-7 days')`;
    case 'ytd':   return `strftime('%Y', ${col}) = strftime('%Y', 'now')`;
    default:      return `${col} >= datetime('now', '-30 days')`;
  }
}

shopRouter.get('/reports/summary', requireAuth, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const period = String(req.query.period || '30d');
    const df = shopDateFilter(period, '');  // no alias — direct shop_orders query

    const overviewRows = await dbAll(`
      SELECT
        COUNT(*)                                                        AS total_orders,
        COUNT(*) FILTER (WHERE status != 'cancelled')                   AS confirmed_orders,
        COUNT(*) FILTER (WHERE status = 'cancelled')                    AS cancelled_orders,
        COALESCE(SUM(total_price) FILTER (WHERE status != 'cancelled'), 0) AS total_revenue,
        COALESCE(AVG(total_price) FILTER (WHERE status != 'cancelled'), 0) AS avg_order_value,
        COUNT(DISTINCT guest_phone)                                     AS unique_customers
      FROM shop_orders
      WHERE tenant_id = ? AND ${df}
    `, tenantId);

    // Repeat customers — computed in app to avoid correlated subquery cross-DB issues
    const custCounts = await dbAll(`
      SELECT guest_phone, COUNT(*) FILTER (WHERE status != 'cancelled') AS cnt
      FROM shop_orders WHERE tenant_id = ? AND ${df}
      GROUP BY guest_phone
    `, tenantId);
    const repeatCustomers = custCounts.filter((c: any) => +c.cnt > 1).length;

    const minutesDiff = isPg
      ? `EXTRACT(EPOCH FROM (done_at::timestamptz - created_at::timestamptz)) / 60`
      : `(julianday(done_at) - julianday(created_at)) * 24 * 60`;
    const speedRows = await dbAll(`
      SELECT
        ROUND(AVG(${minutesDiff})) AS avg_minutes,
        MIN(${minutesDiff})        AS min_minutes,
        MAX(${minutesDiff})        AS max_minutes
      FROM shop_orders
      WHERE tenant_id = ? AND ${df} AND done_at IS NOT NULL AND status != 'cancelled'
    `, tenantId);

    const row = overviewRows[0] || {};
    const total     = +row.total_orders || 0;
    const cancelled = +row.cancelled_orders || 0;
    res.json({
      success: true,
      data: {
        total_orders:        total,
        confirmed_orders:    +row.confirmed_orders || 0,
        cancelled_orders:    cancelled,
        total_revenue:       +row.total_revenue || 0,
        avg_order_value:     +row.avg_order_value || 0,
        unique_customers:    +row.unique_customers || 0,
        repeat_customers:    repeatCustomers,
        cancellation_rate:   total > 0 ? Math.round((cancelled / total) * 100) : 0,
        avg_minutes_to_done: speedRows[0]?.avg_minutes != null ? +speedRows[0].avg_minutes : null,
        min_minutes_to_done: speedRows[0]?.min_minutes != null ? Math.round(+speedRows[0].min_minutes) : null,
        max_minutes_to_done: speedRows[0]?.max_minutes != null ? Math.round(+speedRows[0].max_minutes) : null,
      },
    });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.get('/reports/breakdown', requireAuth, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const period = String(req.query.period || '30d');
    const df     = shopDateFilter(period, '');   // no alias
    const dfSo   = shopDateFilter(period);        // so. alias for join queries

    // PG: created_at is TEXT — must cast before using any date/time function
    const dateExpr = isPg ? `DATE((created_at)::timestamptz)` : `DATE(created_at)`;
    const dowExpr  = isPg ? `EXTRACT(DOW FROM (created_at)::timestamptz)::int` : `CAST(strftime('%w', created_at) AS INTEGER)`;
    const hourExpr = isPg ? `EXTRACT(HOUR FROM (created_at)::timestamptz)::int` : `CAST(strftime('%H', created_at) AS INTEGER)`;

    // 1 — orders per day
    const ordersPerDay = await dbAll(`
      SELECT ${dateExpr} AS day,
        COUNT(*) AS total_orders,
        COUNT(*) FILTER (WHERE status != 'cancelled') AS confirmed,
        COALESCE(SUM(total_price) FILTER (WHERE status != 'cancelled'), 0) AS revenue
      FROM shop_orders WHERE tenant_id = ? AND ${df}
      GROUP BY ${dateExpr} ORDER BY day ASC
    `, tenantId);

    // 2 — orders by day of week
    const ordersByDow = await dbAll(`
      SELECT ${dowExpr} AS day_of_week,
        COUNT(*) FILTER (WHERE status != 'cancelled') AS orders,
        COALESCE(SUM(total_price) FILTER (WHERE status != 'cancelled'), 0) AS revenue
      FROM shop_orders WHERE tenant_id = ? AND ${df}
      GROUP BY day_of_week ORDER BY day_of_week ASC
    `, tenantId);

    // 3 — revenue by category
    const revenueByCategory = await dbAll(`
      SELECT COALESCE(smc.name, 'Uncategorised') AS category,
        COUNT(soi.id) AS items_sold,
        COALESCE(SUM(soi.subtotal), 0) AS revenue
      FROM shop_order_items soi
      JOIN shop_orders so ON so.id = soi.order_id
      LEFT JOIN shop_menu_items smi ON smi.id = soi.item_id
      LEFT JOIN shop_menu_categories smc ON smc.id = smi.category_id
      WHERE soi.tenant_id = ? AND ${dfSo} AND so.status != 'cancelled'
      GROUP BY category ORDER BY revenue DESC
    `, tenantId);

    // 4 — revenue by item (top 10)
    const revenueByItem = await dbAll(`
      SELECT soi.item_name,
        SUM(soi.quantity) AS units_sold,
        COALESCE(SUM(soi.subtotal), 0) AS revenue,
        COUNT(DISTINCT so.id) AS order_count
      FROM shop_order_items soi
      JOIN shop_orders so ON so.id = soi.order_id
      WHERE soi.tenant_id = ? AND ${dfSo} AND so.status != 'cancelled'
      GROUP BY soi.item_name ORDER BY revenue DESC
      LIMIT 10
    `, tenantId);

    // 5 — peak hours
    const ordersByHour = await dbAll(`
      SELECT ${hourExpr} AS hour, COUNT(*) AS orders
      FROM shop_orders WHERE tenant_id = ? AND ${df} AND status != 'cancelled'
      GROUP BY hour ORDER BY hour ASC
    `, tenantId);

    // 6 — avg order value trend per day
    const avgOrderTrend = await dbAll(`
      SELECT ${dateExpr} AS day,
        ROUND(AVG(total_price)) AS avg_value,
        COUNT(*) AS order_count
      FROM shop_orders WHERE tenant_id = ? AND ${df} AND status != 'cancelled'
      GROUP BY ${dateExpr} ORDER BY day ASC
    `, tenantId);

    // 7 — stock depletion (daily stock items only)
    const depletionExpr = isPg
      ? `ROUND((stock_used::numeric / NULLIF(stock_limit,0)) * 100)`
      : `ROUND(CAST(stock_used AS REAL) / NULLIF(stock_limit,0) * 100)`;
    const stockDepletion = await dbAll(`
      SELECT name, stock_limit, stock_used, ${depletionExpr} AS depletion_pct
      FROM shop_menu_items
      WHERE tenant_id = ? AND stock_type = 'daily' AND stock_limit > 0
      ORDER BY depletion_pct DESC
    `, tenantId);

    // 8 — new vs repeat customers
    const custCounts = await dbAll(`
      SELECT guest_phone, COUNT(*) FILTER (WHERE status != 'cancelled') AS cnt
      FROM shop_orders WHERE tenant_id = ? AND ${df}
      GROUP BY guest_phone
    `, tenantId);
    const repeatCustomers = custCounts.filter((c: any) => +c.cnt > 1).length;
    const newCustomers    = custCounts.filter((c: any) => +c.cnt === 1).length;

    // 9 — most cancelled items
    const cancelledItems = await dbAll(`
      SELECT soi.item_name, COUNT(*) AS cancelled_count
      FROM shop_order_items soi
      JOIN shop_orders so ON so.id = soi.order_id
      WHERE soi.tenant_id = ? AND ${dfSo} AND so.status = 'cancelled'
      GROUP BY soi.item_name ORDER BY cancelled_count DESC
      LIMIT 10
    `, tenantId);

    // 10 — speed trend per day
    const minutesDiff = isPg
      ? `EXTRACT(EPOCH FROM (done_at::timestamptz - created_at::timestamptz)) / 60`
      : `(julianday(done_at) - julianday(created_at)) * 24 * 60`;
    const speedTrend = await dbAll(`
      SELECT ${dateExpr} AS day,
        ROUND(AVG(${minutesDiff})) AS avg_minutes
      FROM shop_orders
      WHERE tenant_id = ? AND ${df} AND done_at IS NOT NULL AND status != 'cancelled'
      GROUP BY ${dateExpr} ORDER BY day ASC
    `, tenantId);

    res.json({
      success: true,
      data: {
        orders_per_day:      ordersPerDay,
        orders_by_dow:       ordersByDow,
        revenue_by_category: revenueByCategory,
        revenue_by_item:     revenueByItem,
        orders_by_hour:      ordersByHour,
        avg_order_trend:     avgOrderTrend,
        stock_depletion:     stockDepletion,
        repeat_customers:    repeatCustomers,
        new_customers:       newCustomers,
        cancelled_items:     cancelledItems,
        speed_trend:         speedTrend,
      },
    });
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
