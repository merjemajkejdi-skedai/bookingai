import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
const bcryptHash   = bcrypt.hash.bind(bcrypt);
const bcryptCompare = bcrypt.compare.bind(bcrypt);
import jwt from 'jsonwebtoken';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { resolveTenantId } from '../middleware/auth.js';
import { getJwtSecret } from '../lib/jwt.js';
import { authenticateShopUser, auditLog } from '../middleware/shopAuth.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';
import { fiscalizeOrder, correctInvoice, registerCashDeposit, registerTCR } from '../services/fiscalization.js';
import { getAllMiddlewares } from '../services/fiscal/registry.js';
import { isInventoryEnabled, deductIngredientsForOrder, restoreIngredientsForOrder } from '../services/inventory.js';
import { getCurrentDeliveryTime } from '../services/deliveryTime.js';

export const shopRouter = Router();

async function dbAll(sql: string, ...p: unknown[]) { return (isPg ? query(sql, p) : prepare(sql).all(...p)) as any[]; }
async function dbGet(sql: string, ...p: unknown[]) { return (isPg ? queryOne(sql, p) : prepare(sql).get(...p)) as any; }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

// Accepts either a main-tenant token (shop_owner / super_admin) or a shop sub-user token.
async function authenticateShopOrTenant(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ success: false, error: 'Unauthorised' });
  const token = auth.slice(7);
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as any;
    if (decoded.type === 'shop_user') {
      const user = await dbGet(`SELECT id, tenant_id, is_active, session_version FROM shop_users WHERE id = ?`, decoded.userId);
      if (!user) return res.status(401).json({ success: false, error: 'User not found' });
      if (!user.is_active) return res.status(401).json({ success: false, error: 'Account deactivated' });
      if (Number(user.session_version) !== Number(decoded.sessionVersion)) {
        return res.status(401).json({ success: false, error: 'Session expired — please log in again' });
      }
      req.shopUser = decoded;
      // Compatibility shim so resolveTenantId() still works
      req.user = { userId: decoded.userId, email: decoded.username, role: 'shop_owner' as const, tenantId: decoded.tenantId };
    } else {
      req.user = decoded;
    }
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

// Passes if the caller is a main-tenant admin OR a shop sub-user with admin role.
function requireShopAdmin(req: any, res: any, next: any) {
  if (!req.shopUser) return next(); // main-tenant admin always passes
  if (req.shopUser.role === 'admin') return next();
  return res.status(403).json({ success: false, error: 'Admin role required' });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => { cb(null, file.mimetype.startsWith('image/')); },
});

const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_, file, cb) => { cb(null, file.mimetype === 'application/pdf'); },
});

function baseUrl(): string {
  return process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.VITE_API_URL || 'http://localhost:3001';
}

// ── Config ─────────────────────────────────────────────────────────────────────

shopRouter.get('/config', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    let cfg = await dbGet(`SELECT * FROM shop_config WHERE tenant_id = ?`, tenantId);
    if (!cfg) {
      const id = crypto.randomUUID();
      await dbRun(`INSERT INTO shop_config (id, tenant_id) VALUES (?,?)`, id, tenantId);
      cfg = { id, tenant_id: tenantId, estimated_pickup_minutes: 15, pickup_mode: 'estimated', agent_personality: 'friendly' };
    }
    const tenant = await dbGet(`SELECT shop_photos_enabled FROM tenants WHERE id = ?`, tenantId);
    res.json({ success: true, data: { ...cfg, shop_photos_enabled: tenant?.shop_photos_enabled ?? 0 } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.put('/config', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const {
      shop_name, opening_hours, estimated_pickup_minutes, pickup_mode, agent_personality,
      fallback_message, fallback_backup_number, fallback_after_attempts,
      address, instagram_url, facebook_url, tiktok_url, website_url, phone,
      manual_orders_enabled,
      qr_ordering_enabled, qr_collect_name, qr_collect_table, qr_slug, qr_welcome_message,
      fiscal_enabled, fiscal_api_url, fiscal_username, fiscal_password, fiscal_nuis,
      fiscal_tcr_code, fiscal_busun_code, fiscal_soft_code, fiscal_initial_cash,
      fiscal_default_client, fiscal_environment, fiscal_middleware,
      inventory_enabled, inventory_alert_mode, inventory_alert_time, inventory_alert_whatsapp,
      delivery_threshold_1, delivery_threshold_2,
      delivery_time_1, delivery_time_2, delivery_time_3,
    } = req.body;
    const manualEnabled      = manual_orders_enabled ? 1 : 0;
    const qrEnabled          = qr_ordering_enabled  ? 1 : 0;
    const qrName             = qr_collect_name !== undefined ? (qr_collect_name ? 1 : 0) : 1;
    const qrTable            = qr_collect_table ? 1 : 0;
    const slug               = qr_slug ? String(qr_slug).toLowerCase().trim() || null : null;
    const fiscalEnabledV     = fiscal_enabled ? 1 : 0;
    const inventoryEnabledV  = inventory_enabled ? 1 : 0;
    const inventoryAlertWAV  = inventory_alert_whatsapp ? 1 : 0;
    const exists = await dbGet(`SELECT id FROM shop_config WHERE tenant_id = ?`, tenantId);
    if (exists) {
      await dbRun(
        `UPDATE shop_config SET
           shop_name=?,opening_hours=?,estimated_pickup_minutes=?,pickup_mode=?,agent_personality=?,
           fallback_message=?,fallback_backup_number=?,fallback_after_attempts=?,manual_orders_enabled=?,
           address=?,instagram_url=?,facebook_url=?,tiktok_url=?,website_url=?,phone=?,
           qr_ordering_enabled=?,qr_collect_name=?,qr_collect_table=?,qr_slug=?,qr_welcome_message=?,
           fiscal_enabled=?,fiscal_api_url=?,fiscal_username=?,fiscal_password=?,fiscal_nuis=?,
           fiscal_tcr_code=?,fiscal_busun_code=?,fiscal_soft_code=?,fiscal_initial_cash=?,
           fiscal_default_client=?,fiscal_environment=?,fiscal_middleware=?,
           inventory_enabled=?,inventory_alert_mode=?,inventory_alert_time=?,inventory_alert_whatsapp=?,
           delivery_threshold_1=?,delivery_threshold_2=?,delivery_time_1=?,delivery_time_2=?,delivery_time_3=?,
           updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=?`,
        shop_name, opening_hours, estimated_pickup_minutes, pickup_mode, agent_personality,
        fallback_message, fallback_backup_number, fallback_after_attempts, manualEnabled,
        address, instagram_url, facebook_url, tiktok_url, website_url, phone,
        qrEnabled, qrName, qrTable, slug, qr_welcome_message ?? null,
        fiscalEnabledV, fiscal_api_url ?? null, fiscal_username ?? null, fiscal_password ?? null, fiscal_nuis ?? null,
        fiscal_tcr_code ?? null, fiscal_busun_code ?? null, fiscal_soft_code ?? null, fiscal_initial_cash ?? null,
        fiscal_default_client ?? null, fiscal_environment ?? null, fiscal_middleware ?? 'nexia',
        inventoryEnabledV, inventory_alert_mode ?? 'daily', inventory_alert_time ?? '09:00', inventoryAlertWAV,
        delivery_threshold_1 ?? 5, delivery_threshold_2 ?? 15,
        delivery_time_1 ?? 15, delivery_time_2 ?? 30, delivery_time_3 ?? 45,
        tenantId,
      );
    } else {
      await dbRun(
        `INSERT INTO shop_config
           (id,tenant_id,shop_name,opening_hours,estimated_pickup_minutes,pickup_mode,agent_personality,
            fallback_message,fallback_backup_number,fallback_after_attempts,manual_orders_enabled,
            address,instagram_url,facebook_url,tiktok_url,website_url,phone,
            qr_ordering_enabled,qr_collect_name,qr_collect_table,qr_slug,qr_welcome_message,
            fiscal_enabled,fiscal_api_url,fiscal_username,fiscal_password,fiscal_nuis,
            fiscal_tcr_code,fiscal_busun_code,fiscal_soft_code,fiscal_initial_cash,
            fiscal_default_client,fiscal_environment,fiscal_middleware,
            inventory_enabled,inventory_alert_mode,inventory_alert_time,inventory_alert_whatsapp,
            delivery_threshold_1,delivery_threshold_2,delivery_time_1,delivery_time_2,delivery_time_3)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        crypto.randomUUID(), tenantId, shop_name, opening_hours, estimated_pickup_minutes, pickup_mode, agent_personality,
        fallback_message, fallback_backup_number, fallback_after_attempts, manualEnabled,
        address, instagram_url, facebook_url, tiktok_url, website_url, phone,
        qrEnabled, qrName, qrTable, slug, qr_welcome_message ?? null,
        fiscalEnabledV, fiscal_api_url ?? null, fiscal_username ?? null, fiscal_password ?? null, fiscal_nuis ?? null,
        fiscal_tcr_code ?? null, fiscal_busun_code ?? null, fiscal_soft_code ?? null, fiscal_initial_cash ?? null,
        fiscal_default_client ?? null, fiscal_environment ?? null, fiscal_middleware ?? 'nexia',
        inventoryEnabledV, inventory_alert_mode ?? 'daily', inventory_alert_time ?? '09:00', inventoryAlertWAV,
        delivery_threshold_1 ?? 5, delivery_threshold_2 ?? 15,
        delivery_time_1 ?? 15, delivery_time_2 ?? 30, delivery_time_3 ?? 45,
      );
    }
    res.json({ success: true });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE') || err.code === '23505') {
      return res.status(400).json({ success: false, error: 'That URL slug is already taken by another shop' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Categories ─────────────────────────────────────────────────────────────────

shopRouter.get('/categories', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const cats = await dbAll(`SELECT * FROM shop_menu_categories WHERE tenant_id = ? ORDER BY sort_order ASC`, resolveTenantId(req));
    res.json({ success: true, data: cats });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.post('/categories', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { name, description, sort_order } = req.body;
    const id = crypto.randomUUID();
    await dbRun(`INSERT INTO shop_menu_categories (id,tenant_id,name,description,sort_order) VALUES (?,?,?,?,?)`, id, tenantId, name, description, sort_order ?? 0);
    res.json({ success: true, data: { id } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.put('/categories/:id', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const { name, description, sort_order, is_active } = req.body;
    await dbRun(
      `UPDATE shop_menu_categories SET name=?,description=?,sort_order=?,is_active=? WHERE id=? AND tenant_id=?`,
      name, description, sort_order ?? 0, is_active !== undefined ? (is_active ? 1 : 0) : 1, req.params.id, resolveTenantId(req),
    );
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.delete('/categories/:id', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    await dbRun(`DELETE FROM shop_menu_categories WHERE id=? AND tenant_id=?`, req.params.id, resolveTenantId(req));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Items ──────────────────────────────────────────────────────────────────────

shopRouter.get('/items', authenticateShopOrTenant, async (req: any, res: Response) => {
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

shopRouter.post('/items', authenticateShopOrTenant, upload.single('photo'), async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    console.log('[Photo upload] POST /items — request received, tenantId:', tenantId);
    console.log('[Photo upload] File present:', !!req.file);
    console.log('[Photo upload] File details:', req.file ? {
      originalname: req.file.originalname,
      mimetype:     req.file.mimetype,
      size:         req.file.size,
      hasBuffer:    !!req.file.buffer,
    } : 'NO FILE');
    console.log('[R2] Env check:', {
      endpoint:  !!process.env.R2_ENDPOINT,
      bucket:    !!process.env.R2_BUCKET_NAME,
      publicUrl: !!process.env.R2_PUBLIC_URL,
      accessKey: !!process.env.R2_ACCESS_KEY_ID,
      secretKey: !!process.env.R2_SECRET_ACCESS_KEY,
    });
    let photo_url: string | null = null;
    if (req.file) {
      const tenant = await dbGet(`SELECT shop_photos_enabled FROM tenants WHERE id = ?`, tenantId);
      console.log('[Photo upload] Tenant photos enabled:', tenant?.shop_photos_enabled);
      if (!tenant?.shop_photos_enabled) {
        return res.status(403).json({ success: false, error: 'Photo uploads are disabled for this shop' });
      }
      const { uploadToR2 } = await import('../utils/r2.js');
      const ext = path.extname(req.file.originalname);
      const key = `shop/${tenantId}/menu/${crypto.randomUUID()}${ext}`;
      try {
        photo_url = await uploadToR2(key, req.file.buffer, req.file.mimetype);
        console.log('[R2] Upload success:', photo_url);
      } catch (r2err: any) {
        console.error('[R2] Upload FAILED:', r2err.message);
        console.error('[R2] Full error:', JSON.stringify(r2err, null, 2));
        return res.status(500).json({ error: 'Photo upload failed', details: r2err.message });
      }
    }
    const { name, description, price, currency, category_id, stock_type, stock_limit, sort_order, vat_rate, item_code, unit } = req.body;
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO shop_menu_items (id,tenant_id,category_id,name,description,price,currency,photo_url,photo_filename,stock_type,stock_limit,sort_order,vat_rate,item_code,unit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, tenantId, category_id || null, name, description, parseFloat(price), currency || 'ALL', photo_url, null, stock_type || 'unlimited', stock_limit ? parseInt(stock_limit) : null, sort_order ?? 0, vat_rate || 'VAT_20', item_code || null, unit || 'XPP',
    );
    res.json({ success: true, data: { id, photo_url } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.put('/items/:id', authenticateShopOrTenant, upload.single('photo'), async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    console.log('[Photo upload] PUT /items/:id — request received, item:', req.params.id, 'tenantId:', tenantId);
    console.log('[Photo upload] File present:', !!req.file);
    console.log('[Photo upload] File details:', req.file ? {
      originalname: req.file.originalname,
      mimetype:     req.file.mimetype,
      size:         req.file.size,
      hasBuffer:    !!req.file.buffer,
    } : 'NO FILE');
    console.log('[R2] Env check:', {
      endpoint:  !!process.env.R2_ENDPOINT,
      bucket:    !!process.env.R2_BUCKET_NAME,
      publicUrl: !!process.env.R2_PUBLIC_URL,
      accessKey: !!process.env.R2_ACCESS_KEY_ID,
      secretKey: !!process.env.R2_SECRET_ACCESS_KEY,
    });
    const existing = await dbGet(`SELECT photo_url FROM shop_menu_items WHERE id=? AND tenant_id=?`, req.params.id, tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Not found' });

    let photo_url: string | null = null;
    if (req.file) {
      const tenant = await dbGet(`SELECT shop_photos_enabled FROM tenants WHERE id = ?`, tenantId);
      console.log('[Photo upload] Tenant photos enabled:', tenant?.shop_photos_enabled);
      if (!tenant?.shop_photos_enabled) {
        return res.status(403).json({ success: false, error: 'Photo uploads are disabled for this shop' });
      }
      if (existing.photo_url) {
        const { isR2Url, deleteFromR2 } = await import('../utils/r2.js');
        if (isR2Url(existing.photo_url)) { try { await deleteFromR2(existing.photo_url); } catch { /* ignore */ } }
      }
      const { uploadToR2 } = await import('../utils/r2.js');
      const ext = path.extname(req.file.originalname);
      const key = `shop/${tenantId}/menu/${crypto.randomUUID()}${ext}`;
      try {
        photo_url = await uploadToR2(key, req.file.buffer, req.file.mimetype);
        console.log('[R2] Upload success:', photo_url);
      } catch (r2err: any) {
        console.error('[R2] Upload FAILED:', r2err.message);
        console.error('[R2] Full error:', JSON.stringify(r2err, null, 2));
        return res.status(500).json({ error: 'Photo upload failed', details: r2err.message });
      }
    }

    const { name, description, price, currency, category_id, stock_type, stock_limit, stock_used, is_active, sort_order, vat_rate, item_code, unit } = req.body;
    await dbRun(
      `UPDATE shop_menu_items SET name=?,description=?,price=?,currency=?,category_id=?,stock_type=?,stock_limit=?,stock_used=?,is_active=?,sort_order=?,vat_rate=?,item_code=?,unit=?,photo_url=COALESCE(?,photo_url),photo_filename=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`,
      name, description, parseFloat(price), currency || 'ALL', category_id || null,
      stock_type || 'unlimited', stock_limit !== undefined ? parseInt(stock_limit) : null,
      stock_used !== undefined ? parseInt(stock_used) : undefined,
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
      sort_order ?? 0,
      vat_rate || 'VAT_20', item_code || null, unit || 'XPP',
      photo_url,
      req.params.id, tenantId,
    );
    res.json({ success: true, data: { photo_url: photo_url || undefined } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.delete('/items/:id', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const item = await dbGet(`SELECT photo_url FROM shop_menu_items WHERE id=? AND tenant_id=?`, req.params.id, tenantId);
    if (item?.photo_url) {
      const { isR2Url, deleteFromR2 } = await import('../utils/r2.js');
      if (isR2Url(item.photo_url)) { try { await deleteFromR2(item.photo_url); } catch { /* ignore */ } }
    }
    await dbRun(`DELETE FROM shop_menu_items WHERE id=? AND tenant_id=?`, req.params.id, tenantId);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Orders ─────────────────────────────────────────────────────────────────────

shopRouter.get('/orders', authenticateShopOrTenant, async (req: any, res: Response) => {
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

shopRouter.patch('/orders/:id', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { status, is_paid } = req.body as { status?: string; is_paid?: boolean };
    const order = await dbGet(`SELECT * FROM shop_orders WHERE id=? AND tenant_id=?`, req.params.id, tenantId);
    if (!order) return res.status(404).json({ success: false, error: 'Not found' });
    const prevStatus = order.status;

    // Block unpaid manual orders from moving to Picked Up — only when fiscal is enabled
    if (status === 'picked_up' && order.source === 'manual' && !order.is_paid) {
      const shopCfg = await dbGet(`SELECT fiscal_enabled FROM shop_config WHERE tenant_id=?`, tenantId);
      if (shopCfg?.fiscal_enabled) {
        return res.status(400).json({ success: false, error: 'Mark order as paid before moving to Picked Up' });
      }
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
        // Restore recipe-based inventory
        if (await isInventoryEnabled(tenantId)) {
          await restoreIngredientsForOrder(req.params.id, tenantId).catch(
            (err: any) => console.error('[Inventory] Restore failed:', err.message),
          );
        }
      }

      const actorName = req.shopUser ? `${req.shopUser.name} ${req.shopUser.surname}` : 'Admin';
      await auditLog(tenantId, req.shopUser?.userId || null, actorName, 'order.status_changed', 'order', req.params.id, {
        from: prevStatus, to: status, order_number: order.order_number,
      });
    }

    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Manual Order Creation ──────────────────────────────────────────────────────

shopRouter.post('/orders/manual', authenticateShopOrTenant, async (req: any, res: Response) => {
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

    // Deduct recipe-based inventory
    if (await isInventoryEnabled(tenantId)) {
      await deductIngredientsForOrder(orderId, tenantId, orderLines).catch(
        (err: any) => console.error('[Inventory] Deduct failed:', err.message),
      );
    }

    const actorName = req.shopUser ? `${req.shopUser.name} ${req.shopUser.surname}` : 'Admin';
    await auditLog(tenantId, req.shopUser?.userId || null, actorName, 'order.created_manual', 'order', orderId, {
      order_number: orderNumber, total,
    });
    console.log(`[Shop] Manual order #${orderNumber} created by staff`);
    const deliveryInfo = await getCurrentDeliveryTime(tenantId);
    res.json({ success: true, data: { order_id: orderId, order_number: orderNumber, total, status: 'in_progress', estimated_minutes: deliveryInfo.minutes, delivery_label: deliveryInfo.label } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── FAQ ────────────────────────────────────────────────────────────────────────

shopRouter.get('/faq', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const rows = await dbAll(`SELECT * FROM shop_faq WHERE tenant_id=? ORDER BY sort_order ASC`, resolveTenantId(req));
    res.json({ success: true, data: rows });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.post('/faq', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { question, answer, sort_order } = req.body;
    const id = crypto.randomUUID();
    await dbRun(`INSERT INTO shop_faq (id,tenant_id,question,answer,sort_order) VALUES (?,?,?,?,?)`, id, tenantId, question, answer, sort_order ?? 0);
    res.json({ success: true, data: { id } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.put('/faq/:id', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const { question, answer, sort_order } = req.body;
    await dbRun(`UPDATE shop_faq SET question=?,answer=?,sort_order=? WHERE id=? AND tenant_id=?`, question, answer, sort_order ?? 0, req.params.id, resolveTenantId(req));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.delete('/faq/:id', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    await dbRun(`DELETE FROM shop_faq WHERE id=? AND tenant_id=?`, req.params.id, resolveTenantId(req));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Conversations ──────────────────────────────────────────────────────────────

shopRouter.get('/conversations', authenticateShopOrTenant, async (req: any, res: Response) => {
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

shopRouter.get('/conversations/:phone', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const conv = await dbGet(`SELECT * FROM shop_conversations WHERE tenant_id=? AND guest_phone=?`, resolveTenantId(req), phone);
    if (!conv) return res.status(404).json({ success: false, error: 'Not found' });
    try { conv.messages = JSON.parse(conv.messages || '[]'); } catch { conv.messages = []; }
    res.json({ success: true, data: conv });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.delete('/conversations/:phone', authenticateShopOrTenant, async (req: any, res: Response) => {
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
shopRouter.delete('/conversations', authenticateShopOrTenant, async (req: any, res: Response) => {
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

shopRouter.get('/reports/summary', authenticateShopOrTenant, async (req: any, res: Response) => {
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
        ROUND(AVG(${minutesDiff})::numeric) AS avg_minutes,
        MIN(${minutesDiff})                AS min_minutes,
        MAX(${minutesDiff})                AS max_minutes
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

shopRouter.get('/reports/breakdown', authenticateShopOrTenant, async (req: any, res: Response) => {
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
        ROUND(AVG(total_price)::numeric) AS avg_value,
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
        ROUND(AVG(${minutesDiff})::numeric) AS avg_minutes
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

shopRouter.get('/analytics', authenticateShopOrTenant, async (req: any, res: Response) => {
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

// ── Auth ───────────────────────────────────────────────────────────────────────

shopRouter.post('/auth/login', async (req: any, res: Response) => {
  try {
    const { username, password, tenant_id } = req.body;
    if (!username || !password || !tenant_id) {
      return res.status(400).json({ success: false, error: 'username, password and tenant_id required' });
    }
    const user = await dbGet(
      `SELECT * FROM shop_users WHERE tenant_id = ? AND username = ? AND is_active = 1`,
      tenant_id, String(username).toLowerCase().trim(),
    );
    if (!user) return res.status(401).json({ success: false, error: 'Invalid username or password' });
    const valid = await bcryptCompare(String(password), user.password_hash);
    if (!valid) return res.status(401).json({ success: false, error: 'Invalid username or password' });

    const token = jwt.sign(
      {
        userId:         user.id,
        tenantId:       user.tenant_id,
        username:       user.username,
        name:           user.name,
        surname:        user.surname,
        role:           user.role,
        sessionVersion: user.session_version,
        type:           'shop_user',
      },
      getJwtSecret(),
      { expiresIn: '30d' },
    );
    await auditLog(user.tenant_id, user.id, `${user.name} ${user.surname}`, 'auth.login', null, null);
    res.json({
      success: true,
      data: {
        token,
        user: {
          id:          user.id,
          username:    user.username,
          name:        user.name,
          surname:     user.surname,
          role:        user.role,
          operator_id: user.operator_id,
        },
      },
    });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.get('/auth/me', authenticateShopUser, (req: any, res: Response) => {
  res.json({ success: true, data: req.shopUser });
});

// ── User Management (admin only) ───────────────────────────────────────────────

shopRouter.get('/users', authenticateShopOrTenant, requireShopAdmin, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const rows = await dbAll(
      `SELECT id, username, name, surname, tax_id, operator_id, fiscal_operator_code, role, is_active, created_at FROM shop_users WHERE tenant_id = ? ORDER BY created_at DESC`,
      tenantId,
    );
    res.json({ success: true, data: rows });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.post('/users', authenticateShopOrTenant, requireShopAdmin, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const actorName = req.shopUser ? `${req.shopUser.name} ${req.shopUser.surname}` : 'Admin';
    const actorId   = req.shopUser?.userId || null;
    const { username, password, name, surname, tax_id, operator_id, fiscal_operator_code, role } = req.body;

    if (!username || !password || !name || !surname || !role) {
      return res.status(400).json({ success: false, error: 'username, password, name, surname and role are required' });
    }
    if (!['operator', 'supervisor', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const password_hash = await bcryptHash(String(password), 10);
    const id = crypto.randomUUID();
    try {
      await dbRun(
        `INSERT INTO shop_users (id, tenant_id, username, password_hash, name, surname, tax_id, operator_id, fiscal_operator_code, role) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id, tenantId, String(username).toLowerCase().trim(), password_hash,
        name, surname, tax_id || null, operator_id || null, fiscal_operator_code || null, role,
      );
    } catch (err: any) {
      if (err.message?.includes('UNIQUE') || err.code === '23505') {
        return res.status(400).json({ success: false, error: 'Username already exists' });
      }
      throw err;
    }
    await auditLog(tenantId, actorId, actorName, 'user.created', 'user', id, { username, role, name, surname });
    res.json({ success: true, data: { id, username: String(username).toLowerCase().trim(), name, surname, role } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.patch('/users/:id', authenticateShopOrTenant, requireShopAdmin, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const actorName = req.shopUser ? `${req.shopUser.name} ${req.shopUser.surname}` : 'Admin';
    const actorId   = req.shopUser?.userId || null;
    const { name, surname, tax_id, operator_id, fiscal_operator_code, role, is_active, password } = req.body;

    const current = await dbGet(`SELECT role, is_active FROM shop_users WHERE id = ? AND tenant_id = ?`, req.params.id, tenantId);
    if (!current) return res.status(404).json({ success: false, error: 'User not found' });

    const roleChanged   = role && role !== current.role;
    const activeChanged = is_active !== undefined && Boolean(is_active) !== Boolean(current.is_active);
    const isActivePg    = is_active !== undefined ? (is_active ? 1 : 0) : null;

    const sets: string[] = [
      'name                 = COALESCE(?, name)',
      'surname              = COALESCE(?, surname)',
      'tax_id               = COALESCE(?, tax_id)',
      'operator_id          = COALESCE(?, operator_id)',
      'fiscal_operator_code = COALESCE(?, fiscal_operator_code)',
      'role                 = COALESCE(?, role)',
      'is_active            = COALESCE(?, is_active)',
      'updated_at           = CURRENT_TIMESTAMP',
    ];
    const params: any[] = [name ?? null, surname ?? null, tax_id ?? null, operator_id ?? null, fiscal_operator_code ?? null, role ?? null, isActivePg];

    let bumpSession = roleChanged || activeChanged;

    if (password) {
      if (String(password).length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
      const hash = await bcryptHash(String(password), 10);
      sets.push('password_hash = ?');
      params.push(hash);
      bumpSession = true;
    }
    if (bumpSession) sets.push('session_version = session_version + 1');

    params.push(req.params.id, tenantId);
    await dbRun(`UPDATE shop_users SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, ...params);
    await auditLog(tenantId, actorId, actorName, 'user.updated', 'user', req.params.id, { role, is_active, role_changed: roleChanged });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.delete('/users/:id', authenticateShopOrTenant, requireShopAdmin, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const actorId  = req.shopUser?.userId || null;
    if (req.params.id === actorId) {
      return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
    }
    await dbRun(`DELETE FROM shop_users WHERE id = ? AND tenant_id = ?`, req.params.id, tenantId);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Audit Log ──────────────────────────────────────────────────────────────────

shopRouter.get('/audit-log', authenticateShopOrTenant, requireShopAdmin, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const rows = await dbAll(
      `SELECT * FROM shop_audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200`,
      tenantId,
    );
    res.json({ success: true, data: rows });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Logo Upload ────────────────────────────────────────────────────────────────

const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(file.originalname).toLowerCase());
    cb(null, ok);
  },
});

shopRouter.post('/config/logo', authenticateShopOrTenant, uploadLogo.single('logo'), async (req: any, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    const tenantId = resolveTenantId(req);
    const old = await dbGet(`SELECT shop_logo_url FROM shop_config WHERE tenant_id=?`, tenantId);
    if (old?.shop_logo_url) {
      const { isR2Url, deleteFromR2 } = await import('../utils/r2.js');
      if (isR2Url(old.shop_logo_url)) { try { await deleteFromR2(old.shop_logo_url); } catch { /* ignore */ } }
    }
    const { uploadToR2 } = await import('../utils/r2.js');
    const ext = path.extname(req.file.originalname).toLowerCase();
    const key = `shop/${tenantId}/logo/${crypto.randomUUID()}${ext}`;
    const logoUrl = await uploadToR2(key, req.file.buffer, req.file.mimetype);
    await dbRun(
      `UPDATE shop_config SET shop_logo_url=?, shop_logo_filename=NULL, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?`,
      logoUrl, tenantId,
    );
    res.json({ success: true, data: { logo_url: logoUrl } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.delete('/config/logo', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const old = await dbGet(`SELECT shop_logo_url FROM shop_config WHERE tenant_id=?`, tenantId);
    if (old?.shop_logo_url) {
      const { isR2Url, deleteFromR2 } = await import('../utils/r2.js');
      if (isR2Url(old.shop_logo_url)) { try { await deleteFromR2(old.shop_logo_url); } catch { /* ignore */ } }
    }
    await dbRun(
      `UPDATE shop_config SET shop_logo_url=NULL, shop_logo_filename=NULL, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?`,
      tenantId,
    );
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Tables (for table QR codes) ────────────────────────────────────────────────

shopRouter.get('/tables', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const rows = await dbAll(
      `SELECT * FROM shop_tables WHERE tenant_id=? ORDER BY sort_order ASC, name ASC`,
      resolveTenantId(req),
    );
    res.json({ success: true, data: rows });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.post('/tables', authenticateShopOrTenant, requireShopAdmin, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { name, sort_order } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO shop_tables (id, tenant_id, name, sort_order) VALUES (?,?,?,?)`,
      id, tenantId, name, sort_order ?? 0,
    );
    res.json({ success: true, data: { id, tenant_id: tenantId, name, sort_order: sort_order ?? 0, is_active: 1 } });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE') || err.code === '23505')
      return res.status(400).json({ success: false, error: 'Table name already exists' });
    res.status(500).json({ success: false, error: err.message });
  }
});

shopRouter.post('/tables/bulk', authenticateShopOrTenant, requireShopAdmin, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { count, prefix = 'Table' } = req.body;
    if (!count || count < 1 || count > 100)
      return res.status(400).json({ success: false, error: 'count must be 1–100' });
    const created: any[] = [];
    for (let i = 1; i <= count; i++) {
      const name = `${prefix} ${i}`;
      const id   = crypto.randomUUID();
      try {
        await dbRun(
          `INSERT INTO shop_tables (id, tenant_id, name, sort_order) VALUES (?,?,?,?)`,
          id, tenantId, name, i,
        );
        created.push({ id, name, sort_order: i, is_active: 1 });
      } catch { /* skip duplicate names */ }
    }
    res.json({ success: true, data: created });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.patch('/tables/:id', authenticateShopOrTenant, requireShopAdmin, async (req: any, res: Response) => {
  try {
    const { name, sort_order, is_active } = req.body;
    await dbRun(
      `UPDATE shop_tables SET name=COALESCE(?,name), sort_order=COALESCE(?,sort_order), is_active=COALESCE(?,is_active) WHERE id=? AND tenant_id=?`,
      name ?? null, sort_order ?? null, is_active !== undefined ? (is_active ? 1 : 0) : null,
      req.params.id, resolveTenantId(req),
    );
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.delete('/tables/:id', authenticateShopOrTenant, requireShopAdmin, async (req: any, res: Response) => {
  try {
    await dbRun(`DELETE FROM shop_tables WHERE id=? AND tenant_id=?`, req.params.id, resolveTenantId(req));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── PUBLIC QR Ordering (no auth) ───────────────────────────────────────────────

shopRouter.get('/public/:slug', async (req: any, res: Response) => {
  try {
    const cfg = await dbGet(
      `SELECT sc.* FROM shop_config sc WHERE sc.qr_slug = ? AND sc.qr_ordering_enabled = 1`,
      req.params.slug,
    );
    if (!cfg) return res.status(404).json({ success: false, error: 'Shop not found or QR ordering not enabled' });

    const [items, shopTenant] = await Promise.all([
      dbAll(
        `SELECT i.id, i.name, i.description, i.price, i.currency, i.photo_url, i.sort_order,
                c.name AS category_name, c.sort_order AS category_order
         FROM shop_menu_items i
         LEFT JOIN shop_menu_categories c ON c.id = i.category_id
         WHERE i.tenant_id = ? AND i.is_active = 1
           AND (i.stock_type = 'unlimited' OR i.stock_limit IS NULL OR (i.stock_limit - i.stock_used) > 0)
         ORDER BY c.sort_order ASC, i.sort_order ASC`,
        cfg.tenant_id,
      ),
      dbGet(`SELECT shop_photos_enabled FROM tenants WHERE id = ?`, cfg.tenant_id),
    ]);

    res.json({
      success: true,
      data: {
        shop_name:           cfg.shop_name,
        shop_logo_url:       cfg.shop_logo_url,
        qr_collect_name:     cfg.qr_collect_name,
        qr_collect_table:    cfg.qr_collect_table,
        qr_welcome_message:  cfg.qr_welcome_message,
        shop_photos_enabled: shopTenant?.shop_photos_enabled ?? 0,
        pickup_mode:         cfg.pickup_mode,
        items,
      },
    });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.get('/public/:slug/table/:tableId', async (req: any, res: Response) => {
  try {
    const cfg = await dbGet(
      `SELECT tenant_id FROM shop_config WHERE qr_slug=? AND qr_ordering_enabled=1`,
      req.params.slug,
    );
    if (!cfg) return res.status(404).json({ success: false, error: 'Shop not found' });
    const table = await dbGet(
      `SELECT id, name FROM shop_tables WHERE id=? AND tenant_id=? AND is_active=1`,
      req.params.tableId, cfg.tenant_id,
    );
    if (!table) return res.status(404).json({ success: false, error: 'Table not found' });
    res.json({ success: true, data: table });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.post('/public/:slug/order', async (req: any, res: Response) => {
  try {
    const { customer_name, table_name, items, qr_session } = req.body;
    if (!items?.length) return res.status(400).json({ success: false, error: 'No items in order' });

    const cfg = await dbGet(
      `SELECT * FROM shop_config WHERE qr_slug=? AND qr_ordering_enabled=1`,
      req.params.slug,
    );
    if (!cfg) return res.status(404).json({ success: false, error: 'Shop not found' });
    const tenantId = cfg.tenant_id;

    const itemIds = items.map((i: any) => i.item_id);
    const ph = itemIds.map(() => '?').join(',');
    const menuItems = await dbAll(
      `SELECT id, name, price, currency, stock_type, stock_limit, stock_used, is_active FROM shop_menu_items WHERE tenant_id=? AND id IN (${ph}) AND is_active=1`,
      tenantId, ...itemIds,
    );
    const itemMap = new Map(menuItems.map((i: any) => [i.id, i]));

    const unavailable: string[] = [];
    for (const oi of items) {
      const mi = itemMap.get(oi.item_id) as any;
      if (!mi) { unavailable.push(oi.item_id); continue; }
      if (mi.stock_type !== 'unlimited' && mi.stock_limit != null) {
        if ((mi.stock_limit - mi.stock_used) < oi.quantity) unavailable.push(mi.name);
      }
    }
    if (unavailable.length) return res.status(400).json({ success: false, error: 'Some items are no longer available', unavailable });

    let total = 0;
    const orderLines = items.map((oi: any) => {
      const mi = itemMap.get(oi.item_id) as any;
      const subtotal = parseFloat(mi.price) * oi.quantity;
      total += subtotal;
      return { item_id: oi.item_id, item_name: mi.name, item_price: parseFloat(mi.price), quantity: oi.quantity, subtotal, currency: mi.currency };
    });

    const today = new Date().toISOString().split('T')[0];
    const numRows = await dbAll(
      `SELECT COALESCE(MAX(order_number), 0) + 1 AS next_num FROM shop_orders WHERE tenant_id=? AND order_date=?`,
      tenantId, today,
    );
    const orderNumber = (numRows[0] as any)?.next_num || 1;

    const orderId = crypto.randomUUID();
    const now = new Date().toISOString();
    await dbRun(
      `INSERT INTO shop_orders (id,tenant_id,order_number,order_date,guest_phone,pickup_name,status,total_price,currency,source,table_name,qr_session,created_at,updated_at)
       VALUES (?,?,?,?,?,?,'new',?,?,'qr',?,?,?,?)`,
      orderId, tenantId, orderNumber, today, null, customer_name || 'Walk-in',
      total, orderLines[0]?.currency || 'ALL', table_name || null, qr_session || null, now, now,
    );

    for (const line of orderLines) {
      await dbRun(
        `INSERT INTO shop_order_items (id,order_id,tenant_id,item_id,item_name,item_price,quantity,subtotal) VALUES (?,?,?,?,?,?,?,?)`,
        crypto.randomUUID(), orderId, tenantId, line.item_id, line.item_name, line.item_price, line.quantity, line.subtotal,
      );
    }
    for (const line of orderLines) {
      await dbRun(
        `UPDATE shop_menu_items SET stock_used = stock_used + ?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND stock_type != 'unlimited'`,
        line.quantity, line.item_id,
      );
    }

    // Deduct recipe-based inventory
    if (await isInventoryEnabled(tenantId)) {
      await deductIngredientsForOrder(orderId, tenantId, orderLines).catch(
        (err: any) => console.error('[Inventory] Deduct failed:', err.message),
      );
    }

    console.log(`[Shop QR] Order #${orderNumber} from ${customer_name || 'Walk-in'}${table_name ? ` @ ${table_name}` : ''}`);
    const deliveryInfo = await getCurrentDeliveryTime(tenantId);
    res.json({ success: true, data: { order_id: orderId, order_number: orderNumber, total, customer_name: customer_name || 'Walk-in', table_name: table_name || null, pickup_mode: cfg.pickup_mode || 'estimated', estimated_minutes: deliveryInfo.minutes, delivery_label: deliveryInfo.label } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Delivery time ──────────────────────────────────────────────────────────────

// GET /shop/delivery-time — authenticated, for dashboard badge
shopRouter.get('/delivery-time', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const info = await getCurrentDeliveryTime(resolveTenantId(req));
    res.json(info);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /shop/public/:slug/delivery-time — public, for QR ordering page
shopRouter.get('/public/:slug/delivery-time', async (req: any, res: Response) => {
  try {
    const cfg = await dbGet(`SELECT tenant_id FROM shop_config WHERE qr_slug = ?`, req.params.slug);
    if (!cfg) return res.status(404).json({ error: 'Shop not found' });
    const info = await getCurrentDeliveryTime(cfg.tenant_id);
    res.json(info);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Fiscalization ──────────────────────────────────────────────────────────────

// GET /shop/fiscal/middlewares — list available middleware options for UI dropdown
shopRouter.get('/fiscal/middlewares', authenticateShopOrTenant, async (_req: any, res: Response) => {
  res.json(getAllMiddlewares());
});

// POST /shop/orders/:id/pay — Pay & Fiscalize
shopRouter.post('/orders/:id/pay', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { payment_type = 'BANKNOTE' } = req.body;

    const operatorCode = req.shopUser?.fiscal_operator_code
      || (req.shopUser?.userId
        ? (await dbGet('SELECT fiscal_operator_code FROM shop_users WHERE id=?', req.shopUser.userId))?.fiscal_operator_code
        : null)
      || 'default';

    const cfg = await dbGet('SELECT fiscal_enabled FROM shop_config WHERE tenant_id=?', tenantId);
    if (!cfg?.fiscal_enabled) {
      await dbRun(
        `UPDATE shop_orders SET is_paid=1, paid_at=CURRENT_TIMESTAMP, payment_type=?, status='done', done_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`,
        payment_type, req.params.id, tenantId,
      );
      return res.json({ success: true, fiscalized: false });
    }

    const result = await fiscalizeOrder(req.params.id, tenantId, operatorCode, payment_type);

    await auditLog(
      tenantId,
      req.shopUser?.userId || null,
      req.shopUser ? `${req.shopUser.name} ${req.shopUser.surname}` : 'Admin',
      result.success ? 'order.fiscalized' : 'order.fiscal_failed',
      'order', req.params.id,
      { payment_type, fiscal_inv_num: result.data?.Invoice?.InvNum },
    );

    res.json({
      success:      result.success,
      fiscalized:   result.success,
      fiscal_error: result.error || null,
      invoice:      result.data?.Invoice || null,
      verify_url:   result.data?.VerifyInvoice || null,
    });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /shop/orders/:id/retry-fiscal
shopRouter.post('/orders/:id/retry-fiscal', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const operatorCode = req.shopUser?.fiscal_operator_code || 'default';
    const order = await dbGet('SELECT payment_type FROM shop_orders WHERE id=? AND tenant_id=?', req.params.id, tenantId);
    const result = await fiscalizeOrder(req.params.id, tenantId, operatorCode, order?.payment_type || 'BANKNOTE');
    res.json({ success: result.success, fiscal_error: result.error || null, invoice: result.data?.Invoice || null });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /shop/orders/:id/correct
shopRouter.post('/orders/:id/correct', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const operatorCode = req.shopUser?.fiscal_operator_code || 'default';
    const result = await correctInvoice(req.params.id, tenantId, operatorCode);
    res.json(result);
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /shop/fiscal/cash-deposit
shopRouter.post('/fiscal/cash-deposit', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { amount, operation = 'INITIAL' } = req.body;
    const cfg = await dbGet('SELECT fiscal_initial_cash FROM shop_config WHERE tenant_id=?', tenantId);
    const cashAmount = amount ?? cfg?.fiscal_initial_cash ?? 0;
    const result = await registerCashDeposit(tenantId, cashAmount, operation);
    res.json(result);
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /shop/fiscal/register-tcr (main-tenant admin only)
shopRouter.post('/fiscal/register-tcr', async (req: any, res: Response) => {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return res.status(401).json({ success: false, error: 'Unauthorised' });
    const jwt = await import('jsonwebtoken');
    const { getJwtSecret } = await import('../lib/jwt.js');
    const decoded: any = jwt.default.verify(auth.slice(7), getJwtSecret());
    const result = await registerTCR(decoded.tenantId);
    res.json(result);
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /shop/orders/:id/receipt
shopRouter.get('/orders/:id/receipt', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const order = await dbGet(
      `SELECT so.*, sc.shop_name, sc.shop_logo_url, sc.fiscal_nuis
       FROM shop_orders so
       JOIN shop_config sc ON sc.tenant_id = so.tenant_id
       WHERE so.id = ? AND so.tenant_id = ?`,
      req.params.id, tenantId,
    );
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    const items = await dbAll(`SELECT * FROM shop_order_items WHERE order_id = ? ORDER BY id`, req.params.id);
    res.json({
      success: true,
      data: {
        order_number:      order.order_number,
        order_date:        order.created_at,
        shop_name:         order.shop_name,
        shop_logo_url:     order.shop_logo_url,
        fiscal_nuis:       order.fiscal_nuis,
        pickup_name:       order.pickup_name,
        table_name:        order.table_name,
        items:             items.map((i: any) => ({ name: i.item_name, qty: i.quantity, price: i.item_price, sub: i.subtotal })),
        total:             order.total_price,
        payment_type:      order.payment_type,
        fiscal_inv_num:    order.fiscal_inv_num,
        fiscal_iic:        order.fiscal_iic,
        fiscal_verify_url: order.fiscal_verify_url,
        fiscal_status:     order.fiscal_status,
        is_paid:           order.is_paid,
      },
    });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Inventory Module ───────────────────────────────────────────────────────────

async function requireInventory(req: any, res: Response, next: Function) {
  try {
    const tenantId = resolveTenantId(req);
    if (!(await isInventoryEnabled(tenantId))) {
      return res.status(403).json({ success: false, error: 'Inventory module is not enabled' });
    }
    next();
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── Inventory Categories ────────────────────────────────────────────────────────

shopRouter.get('/inventory/categories', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const rows = await dbAll(`SELECT * FROM inventory_categories WHERE tenant_id=? ORDER BY sort_order ASC, name ASC`, tenantId);
    res.json({ success: true, data: rows });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.post('/inventory/categories', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { name, sort_order = 0 } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name is required' });
    const id = crypto.randomUUID();
    await dbRun(`INSERT INTO inventory_categories (id,tenant_id,name,sort_order) VALUES (?,?,?,?)`, id, tenantId, name, sort_order);
    res.json({ success: true, data: { id } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.put('/inventory/categories/:id', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { name, sort_order } = req.body;
    await dbRun(
      `UPDATE inventory_categories SET name=?,sort_order=? WHERE id=? AND tenant_id=?`,
      name, sort_order ?? 0, req.params.id, tenantId,
    );
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.delete('/inventory/categories/:id', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    await dbRun(`DELETE FROM inventory_categories WHERE id=? AND tenant_id=?`, req.params.id, tenantId);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Inventory Suppliers ─────────────────────────────────────────────────────────

shopRouter.get('/inventory/suppliers', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const rows = await dbAll(`SELECT * FROM inventory_suppliers WHERE tenant_id=? AND is_active=1 ORDER BY name ASC`, tenantId);
    res.json({ success: true, data: rows });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.post('/inventory/suppliers', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { name, contact, phone, email, notes } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name is required' });
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO inventory_suppliers (id,tenant_id,name,contact,phone,email,notes) VALUES (?,?,?,?,?,?,?)`,
      id, tenantId, name, contact ?? null, phone ?? null, email ?? null, notes ?? null,
    );
    res.json({ success: true, data: { id } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.patch('/inventory/suppliers/:id', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { name, contact, phone, email, notes, is_active } = req.body;
    await dbRun(
      `UPDATE inventory_suppliers SET name=?,contact=?,phone=?,email=?,notes=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`,
      name, contact ?? null, phone ?? null, email ?? null, notes ?? null, is_active ?? 1, req.params.id, tenantId,
    );
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.delete('/inventory/suppliers/:id', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    await dbRun(`UPDATE inventory_suppliers SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`, req.params.id, tenantId);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Inventory Ingredients ───────────────────────────────────────────────────────

shopRouter.get('/inventory/ingredients', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const rows = await dbAll(
      `SELECT i.*, c.name AS category_name, s.name AS supplier_name
       FROM inventory_ingredients i
       LEFT JOIN inventory_categories c ON c.id = i.category_id
       LEFT JOIN inventory_suppliers s ON s.id = i.supplier_id
       WHERE i.tenant_id=? AND i.is_active=1
       ORDER BY i.name ASC`,
      tenantId,
    );
    res.json({ success: true, data: rows });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.post('/inventory/ingredients', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { name, unit = 'pieces', category_id, supplier_id, current_stock = 0, reorder_threshold = 0, cost_per_unit = 0 } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name is required' });
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO inventory_ingredients (id,tenant_id,name,unit,category_id,supplier_id,current_stock,reorder_threshold,cost_per_unit) VALUES (?,?,?,?,?,?,?,?,?)`,
      id, tenantId, name, unit, category_id ?? null, supplier_id ?? null, current_stock, reorder_threshold, cost_per_unit,
    );
    res.json({ success: true, data: { id } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.patch('/inventory/ingredients/:id', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { name, unit, category_id, supplier_id, current_stock, reorder_threshold, cost_per_unit, is_active } = req.body;
    await dbRun(
      `UPDATE inventory_ingredients SET name=?,unit=?,category_id=?,supplier_id=?,current_stock=?,reorder_threshold=?,cost_per_unit=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`,
      name, unit, category_id ?? null, supplier_id ?? null, current_stock, reorder_threshold, cost_per_unit, is_active ?? 1, req.params.id, tenantId,
    );
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.delete('/inventory/ingredients/:id', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    await dbRun(`UPDATE inventory_ingredients SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`, req.params.id, tenantId);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Inventory Recipes ───────────────────────────────────────────────────────────

shopRouter.get('/inventory/recipes', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const recipes = await dbAll(
      `SELECT r.*, smi.name AS item_name
       FROM inventory_recipes r
       JOIN shop_menu_items smi ON smi.id = r.menu_item_id
       WHERE r.tenant_id=?
       ORDER BY smi.name ASC`,
      tenantId,
    );
    for (const recipe of recipes) {
      recipe.lines = await dbAll(
        `SELECT rl.*, i.name AS ingredient_name, i.unit
         FROM inventory_recipe_lines rl
         JOIN inventory_ingredients i ON i.id = rl.ingredient_id
         WHERE rl.recipe_id=?
         ORDER BY rl.sort_order ASC`,
        recipe.id,
      );
    }
    res.json({ success: true, data: recipes });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.get('/inventory/recipes/:menuItemId', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const recipe = await dbGet(
      `SELECT r.* FROM inventory_recipes r WHERE r.menu_item_id=? AND r.tenant_id=?`,
      req.params.menuItemId, tenantId,
    );
    if (!recipe) return res.json({ success: true, data: null });
    recipe.lines = await dbAll(
      `SELECT rl.*, i.name AS ingredient_name, i.unit
       FROM inventory_recipe_lines rl
       JOIN inventory_ingredients i ON i.id = rl.ingredient_id
       WHERE rl.recipe_id=?
       ORDER BY rl.sort_order ASC`,
      recipe.id,
    );
    res.json({ success: true, data: recipe });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.put('/inventory/recipes/:menuItemId', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { name, lines = [] } = req.body as { name?: string; lines: { ingredient_id: string; quantity: number; sort_order?: number }[] };
    let recipe = await dbGet(`SELECT id FROM inventory_recipes WHERE menu_item_id=? AND tenant_id=?`, req.params.menuItemId, tenantId);
    if (!recipe) {
      const recipeId = crypto.randomUUID();
      await dbRun(
        `INSERT INTO inventory_recipes (id,tenant_id,menu_item_id,name) VALUES (?,?,?,?)`,
        recipeId, tenantId, req.params.menuItemId, name ?? null,
      );
      recipe = { id: recipeId };
      await dbRun(`UPDATE shop_menu_items SET stock_mode='recipe' WHERE id=? AND tenant_id=?`, req.params.menuItemId, tenantId);
    } else {
      await dbRun(`UPDATE inventory_recipes SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, name ?? null, recipe.id);
    }
    await dbRun(`DELETE FROM inventory_recipe_lines WHERE recipe_id=?`, recipe.id);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      await dbRun(
        `INSERT INTO inventory_recipe_lines (id,recipe_id,tenant_id,ingredient_id,quantity,sort_order) VALUES (?,?,?,?,?,?)`,
        crypto.randomUUID(), recipe.id, tenantId, line.ingredient_id, line.quantity, line.sort_order ?? i,
      );
    }
    res.json({ success: true, data: { id: recipe.id } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.delete('/inventory/recipes/:menuItemId', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const recipe = await dbGet(`SELECT id FROM inventory_recipes WHERE menu_item_id=? AND tenant_id=?`, req.params.menuItemId, tenantId);
    if (recipe) {
      await dbRun(`DELETE FROM inventory_recipe_lines WHERE recipe_id=?`, recipe.id);
      await dbRun(`DELETE FROM inventory_recipes WHERE id=?`, recipe.id);
    }
    await dbRun(`UPDATE shop_menu_items SET stock_mode='simple' WHERE id=? AND tenant_id=?`, req.params.menuItemId, tenantId);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Inventory Deliveries ────────────────────────────────────────────────────────

shopRouter.get('/inventory/deliveries', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const deliveries = await dbAll(
      `SELECT * FROM inventory_deliveries WHERE tenant_id=? ORDER BY delivered_at DESC`,
      tenantId,
    );
    for (const d of deliveries) {
      d.lines = await dbAll(`SELECT * FROM inventory_delivery_lines WHERE delivery_id=?`, d.id);
    }
    res.json({ success: true, data: deliveries });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.post('/inventory/deliveries', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const actorName = req.shopUser ? `${req.shopUser.name} ${req.shopUser.surname}` : 'Admin';
    const { supplier_id, supplier_name, invoice_ref, notes, delivered_at, lines = [] } = req.body as {
      supplier_id?: string; supplier_name?: string; invoice_ref?: string; notes?: string;
      delivered_at?: string; lines: { ingredient_id: string; quantity: number; unit: string; cost_per_unit?: number }[];
    };
    if (lines.length === 0) return res.status(400).json({ success: false, error: 'At least one line is required' });

    const deliveryId = crypto.randomUUID();
    let totalCost = 0;
    const deliveryLines: any[] = [];
    for (const line of lines) {
      const ing = await dbGet(`SELECT name, unit FROM inventory_ingredients WHERE id=? AND tenant_id=?`, line.ingredient_id, tenantId);
      if (!ing) continue;
      const lineTotal = (line.cost_per_unit ?? 0) * line.quantity;
      totalCost += lineTotal;
      deliveryLines.push({ ...line, ingredient_name: ing.name, unit: line.unit || ing.unit, lineTotal });
    }

    await dbRun(
      `INSERT INTO inventory_deliveries (id,tenant_id,supplier_id,supplier_name,invoice_ref,notes,total_cost,delivered_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
      deliveryId, tenantId, supplier_id ?? null, supplier_name ?? null, invoice_ref ?? null, notes ?? null,
      totalCost, delivered_at ?? new Date().toISOString(), actorName,
    );

    for (const dl of deliveryLines) {
      await dbRun(
        `INSERT INTO inventory_delivery_lines (id,delivery_id,tenant_id,ingredient_id,ingredient_name,quantity,unit,cost_per_unit,line_total) VALUES (?,?,?,?,?,?,?,?,?)`,
        crypto.randomUUID(), deliveryId, tenantId, dl.ingredient_id, dl.ingredient_name, dl.quantity, dl.unit, dl.cost_per_unit ?? 0, dl.lineTotal,
      );
      await dbRun(
        `UPDATE inventory_ingredients SET current_stock = current_stock + ?, cost_per_unit=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`,
        dl.quantity, dl.cost_per_unit ?? 0, dl.ingredient_id, tenantId,
      );
    }

    res.json({ success: true, data: { id: deliveryId, total_cost: totalCost } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.delete('/inventory/deliveries/:id', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const lines = await dbAll(`SELECT * FROM inventory_delivery_lines WHERE delivery_id=?`, req.params.id);
    for (const dl of lines) {
      await dbRun(
        `UPDATE inventory_ingredients SET current_stock = current_stock - ?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`,
        dl.quantity, dl.ingredient_id, tenantId,
      );
    }
    await dbRun(`DELETE FROM inventory_delivery_lines WHERE delivery_id=?`, req.params.id);
    await dbRun(`DELETE FROM inventory_deliveries WHERE id=? AND tenant_id=?`, req.params.id, tenantId);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Inventory Waste ─────────────────────────────────────────────────────────────

shopRouter.get('/inventory/waste', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const rows = await dbAll(`SELECT * FROM inventory_waste WHERE tenant_id=? ORDER BY recorded_at DESC`, tenantId);
    res.json({ success: true, data: rows });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.post('/inventory/waste', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const actorName = req.shopUser ? `${req.shopUser.name} ${req.shopUser.surname}` : 'Admin';
    const { ingredient_id, quantity, category = 'spillage', notes } = req.body;
    if (!ingredient_id || !quantity) return res.status(400).json({ success: false, error: 'ingredient_id and quantity are required' });

    const ing = await dbGet(`SELECT name, unit FROM inventory_ingredients WHERE id=? AND tenant_id=?`, ingredient_id, tenantId);
    if (!ing) return res.status(404).json({ success: false, error: 'Ingredient not found' });

    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO inventory_waste (id,tenant_id,ingredient_id,ingredient_name,quantity,unit,category,notes,recorded_by) VALUES (?,?,?,?,?,?,?,?,?)`,
      id, tenantId, ingredient_id, ing.name, quantity, ing.unit, category, notes ?? null, actorName,
    );
    const deductSql = isPg
      ? `UPDATE inventory_ingredients SET current_stock = GREATEST(0, current_stock - ?), updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`
      : `UPDATE inventory_ingredients SET current_stock = MAX(0, current_stock - ?), updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`;
    await dbRun(deductSql, quantity, ingredient_id, tenantId);
    res.json({ success: true, data: { id } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Inventory Reports ───────────────────────────────────────────────────────────

shopRouter.get('/inventory/reports/stock-levels', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const rows = await dbAll(
      `SELECT i.id, i.name, i.unit, i.current_stock, i.reorder_threshold, i.cost_per_unit,
              c.name AS category_name,
              CASE WHEN i.reorder_threshold > 0 AND i.current_stock <= i.reorder_threshold THEN 1 ELSE 0 END AS is_low
       FROM inventory_ingredients i
       LEFT JOIN inventory_categories c ON c.id = i.category_id
       WHERE i.tenant_id=? AND i.is_active=1
       ORDER BY is_low DESC, i.name ASC`,
      tenantId,
    );
    res.json({ success: true, data: rows });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.get('/inventory/reports/consumption', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const days = parseInt(String(req.query.days || '30'), 10) || 30;
    const dateSql = isPg
      ? `consumed_at >= NOW() - (? || ' days')::INTERVAL`
      : `consumed_at >= datetime('now', '-' || ? || ' days')`;
    const rows = await dbAll(
      `SELECT ingredient_id, ingredient_name, unit,
              SUM(quantity) AS total_consumed,
              COUNT(DISTINCT order_id) AS order_count
       FROM inventory_consumption
       WHERE tenant_id=? AND ${dateSql}
       GROUP BY ingredient_id, ingredient_name, unit
       ORDER BY total_consumed DESC`,
      tenantId, days,
    );
    res.json({ success: true, data: rows });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.get('/inventory/reports/waste', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const days = parseInt(String(req.query.days || '30'), 10) || 30;
    const dateSql = isPg
      ? `recorded_at >= NOW() - (? || ' days')::INTERVAL`
      : `recorded_at >= datetime('now', '-' || ? || ' days')`;
    const rows = await dbAll(
      `SELECT ingredient_id, ingredient_name, unit, category,
              SUM(quantity) AS total_wasted
       FROM inventory_waste
       WHERE tenant_id=? AND ${dateSql}
       GROUP BY ingredient_id, ingredient_name, unit, category
       ORDER BY total_wasted DESC`,
      tenantId, days,
    );
    res.json({ success: true, data: rows });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

shopRouter.get('/inventory/reports/stock-value', authenticateShopOrTenant, requireInventory, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const rows = await dbAll(
      `SELECT i.id, i.name, i.unit, i.current_stock, i.cost_per_unit,
              (i.current_stock * i.cost_per_unit) AS stock_value,
              c.name AS category_name
       FROM inventory_ingredients i
       LEFT JOIN inventory_categories c ON c.id = i.category_id
       WHERE i.tenant_id=? AND i.is_active=1
       ORDER BY stock_value DESC`,
      tenantId,
    );
    const total = rows.reduce((sum: number, r: any) => sum + parseFloat(r.stock_value || 0), 0);
    res.json({ success: true, data: { items: rows, total_value: total } });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Menu Documents (PDF / URL) ─────────────────────────────────────────────────

shopRouter.get('/menu-documents', authenticateShopOrTenant, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const docs = await dbAll(
      `SELECT * FROM shop_menu_documents WHERE tenant_id = ? ORDER BY sort_order ASC, created_at ASC`,
      tenantId,
    );
    res.json(docs);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

shopRouter.post('/menu-documents', authenticateShopOrTenant, requireShopAdmin,
  // Wrap multer so MulterError (e.g. LIMIT_FILE_SIZE) returns clean JSON instead of hitting Express's default error handler
  (req: any, res: Response, next: any) => {
    uploadPdf.single('file')(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'File too large. Maximum size is 15MB.' });
        }
        return res.status(400).json({ error: err.message || 'File upload error' });
      }
      next();
    });
  },
  async (req: any, res: Response) => {
    try {
      const tenantId = resolveTenantId(req);
      const { label, doc_type, external_url, sort_order } = req.body;

      if (!label || !doc_type) return res.status(400).json({ error: 'label and doc_type are required' });
      if (!['pdf', 'url'].includes(doc_type)) return res.status(400).json({ error: 'doc_type must be pdf or url' });

      if (doc_type === 'pdf') {
        if (!req.file) return res.status(400).json({ error: 'PDF file is required for doc_type=pdf' });
        if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'Only PDF files are allowed' });

        const { uploadToR2 } = await import('../utils/r2.js');
        const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `shop/${tenantId}/menu-documents/${Date.now()}-${safeName}`;
        const fileUrl = await uploadToR2(key, req.file.buffer, req.file.mimetype);

        const id = crypto.randomUUID();
        await dbRun(
          `INSERT INTO shop_menu_documents (id, tenant_id, label, doc_type, file_url, sort_order) VALUES (?,?,?,?,?,?)`,
          id, tenantId, label, 'pdf', fileUrl, sort_order || 0,
        );
        const doc = await dbGet(`SELECT * FROM shop_menu_documents WHERE id = ?`, id);
        return res.json(doc);
      }

      // doc_type === 'url'
      if (!external_url || !/^https?:\/\//.test(external_url)) {
        return res.status(400).json({ error: 'A valid external_url (http/https) is required for doc_type=url' });
      }
      const id = crypto.randomUUID();
      await dbRun(
        `INSERT INTO shop_menu_documents (id, tenant_id, label, doc_type, external_url, sort_order) VALUES (?,?,?,?,?,?)`,
        id, tenantId, label, 'url', external_url, sort_order || 0,
      );
      const doc = await dbGet(`SELECT * FROM shop_menu_documents WHERE id = ?`, id);
      res.json(doc);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  },
);

shopRouter.patch('/menu-documents/:id', authenticateShopOrTenant, requireShopAdmin, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const { label, sort_order } = req.body;
    await dbRun(
      `UPDATE shop_menu_documents SET label = COALESCE(?, label), sort_order = COALESCE(?, sort_order), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
      label ?? null, sort_order ?? null, req.params.id, tenantId,
    );
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

shopRouter.delete('/menu-documents/:id', authenticateShopOrTenant, requireShopAdmin, async (req: any, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const existing = await dbGet(
      `SELECT file_url FROM shop_menu_documents WHERE id = ? AND tenant_id = ?`,
      req.params.id, tenantId,
    );
    if (existing?.file_url) {
      const { deleteFromR2 } = await import('../utils/r2.js');
      await deleteFromR2(existing.file_url).catch(() => {});
    }
    await dbRun(`DELETE FROM shop_menu_documents WHERE id = ? AND tenant_id = ?`, req.params.id, tenantId);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
