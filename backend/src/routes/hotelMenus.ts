import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { requireAuth, resolveTenantId } from '../middleware/auth.js';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';

export const hotelMenusRouter = Router();

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------
async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const ok = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, status = 400) =>
  res.status(status).json({ success: false, error: msg });

// ---------------------------------------------------------------------------
// File upload setup — memoryStorage; files go to Cloudflare R2
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 }, // 16 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only PDF, JPG, JPEG, PNG files are allowed'));
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseMenu(r: any) {
  if (!r) return r;
  return {
    ...r,
    keywords:  typeof r.keywords  === 'string' ? JSON.parse(r.keywords)  : (r.keywords  ?? []),
    is_active: !!r.is_active,
  };
}

function parseItem(r: any) {
  if (!r) return r;
  return {
    ...r,
    is_available: !!r.is_available,
  };
}

// ---------------------------------------------------------------------------
// GET /menus — list menus with item_count
// ---------------------------------------------------------------------------
hotelMenusRouter.get('/menus', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      `SELECT m.*,
        (SELECT COUNT(*) FROM hotel_menu_items i WHERE i.menu_id = m.id AND i.is_available = 1) AS item_count
       FROM hotel_menus m
       WHERE m.tenant_id = ?
       ORDER BY m.display_order ASC, m.created_at ASC`,
      tenantId,
    ) as any[];
    ok(res, rows.map(r => ({ ...parseMenu(r), item_count: Number(r.item_count) })));
  } catch (e: any) {
    err(res, e.message, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /menus/:id — single menu with items
// ---------------------------------------------------------------------------
hotelMenusRouter.get('/menus/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const menu = await dbGet('SELECT * FROM hotel_menus WHERE id = ? AND tenant_id = ?', req.params.id, tenantId) as any;
    if (!menu) return err(res, 'Menu not found', 404);
    const items = await dbAll(
      `SELECT * FROM hotel_menu_items WHERE menu_id = ? ORDER BY display_order ASC, created_at ASC`,
      req.params.id,
    ) as any[];
    ok(res, { ...parseMenu(menu), items: items.map(parseItem) });
  } catch (e: any) {
    err(res, e.message, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /menus — create
// ---------------------------------------------------------------------------
hotelMenusRouter.post('/menus', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, menu_type = 'other', description, keywords = [], display_order = 0 } = req.body;
  if (!name?.trim()) return err(res, 'name is required');
  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await dbRun(
      `INSERT INTO hotel_menus (id, tenant_id, name, menu_type, description, keywords, display_order, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id, tenantId, name.trim(), menu_type,
      description ?? null,
      JSON.stringify(Array.isArray(keywords) ? keywords : []),
      display_order, now, now,
    );
    const row = await dbGet('SELECT * FROM hotel_menus WHERE id = ?', id) as any;
    ok(res, parseMenu(row));
  } catch (e: any) {
    err(res, e.message, 500);
  }
});

// ---------------------------------------------------------------------------
// PATCH /menus/:id — update
// ---------------------------------------------------------------------------
hotelMenusRouter.patch('/menus/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const existing = await dbGet('SELECT * FROM hotel_menus WHERE id = ? AND tenant_id = ?', req.params.id, tenantId) as any;
    if (!existing) return err(res, 'Menu not found', 404);

    const { name, menu_type, description, keywords, display_order, is_active } = req.body;
    const now = new Date().toISOString();

    await dbRun(
      `UPDATE hotel_menus SET
        name          = ?,
        menu_type     = ?,
        description   = ?,
        keywords      = ?,
        display_order = ?,
        is_active     = ?,
        updated_at    = ?
       WHERE id = ? AND tenant_id = ?`,
      name          ?? existing.name,
      menu_type     ?? existing.menu_type,
      description   !== undefined ? description : existing.description,
      keywords      !== undefined ? JSON.stringify(Array.isArray(keywords) ? keywords : []) : existing.keywords,
      display_order !== undefined ? display_order : existing.display_order,
      is_active     !== undefined ? (is_active ? 1 : 0) : existing.is_active,
      now,
      req.params.id, tenantId,
    );

    const row = await dbGet('SELECT * FROM hotel_menus WHERE id = ?', req.params.id) as any;
    ok(res, parseMenu(row));
  } catch (e: any) {
    err(res, e.message, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /menus/:id — delete menu + file
// ---------------------------------------------------------------------------
hotelMenusRouter.delete('/menus/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const menu = await dbGet('SELECT * FROM hotel_menus WHERE id = ? AND tenant_id = ?', req.params.id, tenantId) as any;
    if (!menu) return err(res, 'Menu not found', 404);

    if (menu.file_url) {
      const { isR2Url, deleteFromR2 } = await import('../utils/r2.js');
      if (isR2Url(menu.file_url)) { try { await deleteFromR2(menu.file_url); } catch { /* ignore */ } }
    }

    await dbRun('DELETE FROM hotel_menu_items WHERE menu_id = ?', req.params.id);
    await dbRun('DELETE FROM hotel_menus WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
    ok(res, { deleted: true });
  } catch (e: any) {
    err(res, e.message, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /menus/:id/upload — upload file to R2
// ---------------------------------------------------------------------------
hotelMenusRouter.post('/menus/:id/upload', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const menu = await dbGet('SELECT * FROM hotel_menus WHERE id = ? AND tenant_id = ?', req.params.id, tenantId) as any;
    if (!menu) return err(res, 'Menu not found', 404);

    if (!req.file) return err(res, 'No file uploaded');

    if (menu.file_url) {
      const { isR2Url, deleteFromR2 } = await import('../utils/r2.js');
      if (isR2Url(menu.file_url)) { try { await deleteFromR2(menu.file_url); } catch { /* ignore */ } }
    }

    const { uploadToR2 } = await import('../utils/r2.js');
    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    const key = `hotel/${tenantId}/menus/${crypto.randomUUID()}.${ext}`;
    const fileUrl = await uploadToR2(key, req.file.buffer, req.file.mimetype);
    const now = new Date().toISOString();

    await dbRun(
      `UPDATE hotel_menus SET file_url = ?, file_name = ?, file_type = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`,
      fileUrl, req.file.originalname, ext, now, req.params.id, tenantId,
    );

    ok(res, { file_url: fileUrl, file_name: req.file.originalname, file_type: ext });
  } catch (e: any) {
    err(res, e.message, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /menus/:id/upload — remove file from R2
// ---------------------------------------------------------------------------
hotelMenusRouter.delete('/menus/:id/upload', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const menu = await dbGet('SELECT * FROM hotel_menus WHERE id = ? AND tenant_id = ?', req.params.id, tenantId) as any;
    if (!menu) return err(res, 'Menu not found', 404);

    if (menu.file_url) {
      const { isR2Url, deleteFromR2 } = await import('../utils/r2.js');
      if (isR2Url(menu.file_url)) { try { await deleteFromR2(menu.file_url); } catch { /* ignore */ } }
    }

    const now = new Date().toISOString();
    await dbRun(
      `UPDATE hotel_menus SET file_url = NULL, file_name = NULL, file_type = NULL, updated_at = ?
       WHERE id = ? AND tenant_id = ?`,
      now, req.params.id, tenantId,
    );

    ok(res, { removed: true });
  } catch (e: any) {
    err(res, e.message, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /menus/:id/items — list items
// ---------------------------------------------------------------------------
hotelMenusRouter.get('/menus/:id/items', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const menu = await dbGet('SELECT id FROM hotel_menus WHERE id = ? AND tenant_id = ?', req.params.id, tenantId) as any;
    if (!menu) return err(res, 'Menu not found', 404);
    const items = await dbAll(
      `SELECT * FROM hotel_menu_items WHERE menu_id = ? ORDER BY category ASC, display_order ASC, created_at ASC`,
      req.params.id,
    ) as any[];
    ok(res, items.map(parseItem));
  } catch (e: any) {
    err(res, e.message, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /menus/:id/items — create item
// ---------------------------------------------------------------------------
hotelMenusRouter.post('/menus/:id/items', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, description, price, currency = 'ALL', category, display_order = 0 } = req.body;
  if (!name?.trim()) return err(res, 'name is required');
  try {
    const menu = await dbGet('SELECT id FROM hotel_menus WHERE id = ? AND tenant_id = ?', req.params.id, tenantId) as any;
    if (!menu) return err(res, 'Menu not found', 404);

    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO hotel_menu_items (id, menu_id, tenant_id, name, description, price, currency, category, display_order)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id, req.params.id, tenantId, name.trim(),
      description ?? null,
      price !== undefined ? Number(price) : null,
      currency, category ?? null, display_order,
    );
    const row = await dbGet('SELECT * FROM hotel_menu_items WHERE id = ?', id) as any;
    ok(res, parseItem(row));
  } catch (e: any) {
    err(res, e.message, 500);
  }
});

// ---------------------------------------------------------------------------
// PATCH /menus/:menuId/items/:itemId — update item
// ---------------------------------------------------------------------------
hotelMenusRouter.patch('/menus/:menuId/items/:itemId', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const item = await dbGet(
      'SELECT * FROM hotel_menu_items WHERE id = ? AND menu_id = ? AND tenant_id = ?',
      req.params.itemId, req.params.menuId, tenantId,
    ) as any;
    if (!item) return err(res, 'Item not found', 404);

    const { name, description, price, currency, category, is_available, display_order } = req.body;

    await dbRun(
      `UPDATE hotel_menu_items SET
        name          = ?,
        description   = ?,
        price         = ?,
        currency      = ?,
        category      = ?,
        is_available  = ?,
        display_order = ?
       WHERE id = ? AND menu_id = ? AND tenant_id = ?`,
      name          !== undefined ? name          : item.name,
      description   !== undefined ? description   : item.description,
      price         !== undefined ? Number(price) : item.price,
      currency      !== undefined ? currency      : item.currency,
      category      !== undefined ? category      : item.category,
      is_available  !== undefined ? (is_available ? 1 : 0) : item.is_available,
      display_order !== undefined ? display_order : item.display_order,
      req.params.itemId, req.params.menuId, tenantId,
    );

    const row = await dbGet('SELECT * FROM hotel_menu_items WHERE id = ?', req.params.itemId) as any;
    ok(res, parseItem(row));
  } catch (e: any) {
    err(res, e.message, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /menus/:menuId/items/:itemId — delete item
// ---------------------------------------------------------------------------
hotelMenusRouter.delete('/menus/:menuId/items/:itemId', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const item = await dbGet(
      'SELECT id FROM hotel_menu_items WHERE id = ? AND menu_id = ? AND tenant_id = ?',
      req.params.itemId, req.params.menuId, tenantId,
    ) as any;
    if (!item) return err(res, 'Item not found', 404);
    await dbRun('DELETE FROM hotel_menu_items WHERE id = ?', req.params.itemId);
    ok(res, { deleted: true });
  } catch (e: any) {
    err(res, e.message, 500);
  }
});
