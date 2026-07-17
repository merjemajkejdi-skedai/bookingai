import { Router, Request, Response } from 'express';
import { requireHappyAuth, requireHappyRole, HappyUser } from '../../middleware/happyAuth.js';
import { dbAll, dbGet, dbRun, ok, err } from './shared.js';

export const happyMenuRouter = Router();

const DESTINATIONS = ['kitchen', 'bar', 'printer'];

function serializeCategory(row: any) {
  return {
    id: row.id, name: row.name, description: row.description, image_url: row.image_url,
    destination: row.destination, sort_order: Number(row.sort_order),
    is_active: row.is_active === 1 || row.is_active === true,
    available_from: row.available_from, available_until: row.available_until,
  };
}

function serializeItem(row: any) {
  return {
    id: row.id, category_id: row.category_id, name: row.name, description: row.description,
    price: Number(row.price), image_url: row.image_url,
    destination_override: row.destination_override, course: row.course,
    is_available: row.is_available === 1 || row.is_available === true,
    stock_quantity: row.stock_quantity != null ? Number(row.stock_quantity) : null,
    sort_order: Number(row.sort_order),
    is_active: row.is_active === 1 || row.is_active === true,
  };
}

// ── Categories ───────────────────────────────────────────────────────────────

happyMenuRouter.get('/restaurant/menu/categories', requireHappyAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  try {
    const rows = await dbAll(
      `SELECT * FROM happy_menu_categories WHERE tenant_id=? AND is_active=1 ORDER BY sort_order ASC, name ASC`,
      tenantId,
    );
    ok(res, rows.map(serializeCategory));
  } catch (e: any) { err(res, e.message, 500); }
});

happyMenuRouter.post('/restaurant/menu/categories', requireHappyAuth, requireHappyRole('admin'), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  const { name, description, image_url, destination = 'kitchen', sort_order = 0, available_from, available_until } = req.body ?? {};
  if (!name?.trim()) return err(res, 'name is required');
  if (!DESTINATIONS.includes(destination)) return err(res, `destination must be one of: ${DESTINATIONS.join(', ')}`);
  try {
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO happy_menu_categories (id, tenant_id, name, description, image_url, destination, sort_order, available_from, available_until)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id, tenantId, name.trim(), description ?? null, image_url ?? null, destination, Number(sort_order),
      available_from ?? null, available_until ?? null,
    );
    const row = await dbGet(`SELECT * FROM happy_menu_categories WHERE id=?`, id);
    ok(res, serializeCategory(row));
  } catch (e: any) { err(res, e.message, 500); }
});

happyMenuRouter.put('/restaurant/menu/categories/:id', requireHappyAuth, requireHappyRole('admin'), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  const { id } = req.params;
  const { name, description, image_url, destination, sort_order, available_from, available_until } = req.body ?? {};
  if (destination && !DESTINATIONS.includes(destination)) return err(res, `destination must be one of: ${DESTINATIONS.join(', ')}`);
  try {
    const existing = await dbGet(`SELECT id FROM happy_menu_categories WHERE id=? AND tenant_id=?`, id, tenantId);
    if (!existing) return err(res, 'Category not found', 404);
    await dbRun(
      `UPDATE happy_menu_categories SET
        name=COALESCE(?,name), description=COALESCE(?,description), image_url=COALESCE(?,image_url),
        destination=COALESCE(?,destination), sort_order=COALESCE(?,sort_order),
        available_from=?, available_until=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      name?.trim() ?? null, description ?? null, image_url ?? null, destination ?? null,
      sort_order != null ? Number(sort_order) : null,
      available_from !== undefined ? available_from : existing.available_from,
      available_until !== undefined ? available_until : existing.available_until,
      id,
    );
    const row = await dbGet(`SELECT * FROM happy_menu_categories WHERE id=?`, id);
    ok(res, serializeCategory(row));
  } catch (e: any) { err(res, e.message, 500); }
});

happyMenuRouter.delete('/restaurant/menu/categories/:id', requireHappyAuth, requireHappyRole('admin'), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  const { id } = req.params;
  try {
    const existing = await dbGet(`SELECT id FROM happy_menu_categories WHERE id=? AND tenant_id=?`, id, tenantId);
    if (!existing) return err(res, 'Category not found', 404);
    await dbRun(`UPDATE happy_menu_categories SET is_active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?`, id);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ── Items ────────────────────────────────────────────────────────────────────

happyMenuRouter.get('/restaurant/menu/items', requireHappyAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  const { category_id } = req.query as Record<string, string>;
  try {
    let sql = `SELECT * FROM happy_menu_items WHERE tenant_id=? AND is_active=1`;
    const params: unknown[] = [tenantId];
    if (category_id) { sql += ' AND category_id=?'; params.push(category_id); }
    sql += ' ORDER BY sort_order ASC, name ASC';
    const rows = await dbAll(sql, ...params);
    ok(res, rows.map(serializeItem));
  } catch (e: any) { err(res, e.message, 500); }
});

happyMenuRouter.post('/restaurant/menu/items', requireHappyAuth, requireHappyRole('admin'), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  const {
    category_id, name, description, price, image_url,
    destination_override, course, stock_quantity, sort_order = 0,
  } = req.body ?? {};
  if (!category_id) return err(res, 'category_id is required');
  if (!name?.trim()) return err(res, 'name is required');
  if (price == null || isNaN(Number(price)) || Number(price) < 0) return err(res, 'price must be a non-negative number');
  if (destination_override && !DESTINATIONS.includes(destination_override)) return err(res, `destination_override must be one of: ${DESTINATIONS.join(', ')}`);
  try {
    const category = await dbGet(`SELECT id FROM happy_menu_categories WHERE id=? AND tenant_id=?`, category_id, tenantId);
    if (!category) return err(res, 'Category not found', 404);
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO happy_menu_items
        (id, tenant_id, category_id, name, description, price, image_url, destination_override, course, stock_quantity, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, tenantId, category_id, name.trim(), description ?? null, Number(price), image_url ?? null,
      destination_override ?? null, course ?? null, stock_quantity != null ? Number(stock_quantity) : null, Number(sort_order),
    );
    const row = await dbGet(`SELECT * FROM happy_menu_items WHERE id=?`, id);
    ok(res, serializeItem(row));
  } catch (e: any) { err(res, e.message, 500); }
});

happyMenuRouter.put('/restaurant/menu/items/:id', requireHappyAuth, requireHappyRole('admin'), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  const { id } = req.params;
  const {
    category_id, name, description, price, image_url,
    destination_override, course, stock_quantity, sort_order,
  } = req.body ?? {};
  if (destination_override && !DESTINATIONS.includes(destination_override)) return err(res, `destination_override must be one of: ${DESTINATIONS.join(', ')}`);
  try {
    const existing = await dbGet(`SELECT * FROM happy_menu_items WHERE id=? AND tenant_id=?`, id, tenantId);
    if (!existing) return err(res, 'Item not found', 404);
    if (category_id) {
      const category = await dbGet(`SELECT id FROM happy_menu_categories WHERE id=? AND tenant_id=?`, category_id, tenantId);
      if (!category) return err(res, 'Category not found', 404);
    }
    await dbRun(
      `UPDATE happy_menu_items SET
        category_id=COALESCE(?,category_id), name=COALESCE(?,name), description=COALESCE(?,description),
        price=COALESCE(?,price), image_url=COALESCE(?,image_url), destination_override=?,
        course=?, stock_quantity=?, sort_order=COALESCE(?,sort_order), updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      category_id ?? null, name?.trim() ?? null, description ?? null,
      price != null ? Number(price) : null, image_url ?? null,
      destination_override !== undefined ? destination_override : existing.destination_override,
      course !== undefined ? course : existing.course,
      stock_quantity !== undefined ? (stock_quantity != null ? Number(stock_quantity) : null) : existing.stock_quantity,
      sort_order != null ? Number(sort_order) : null,
      id,
    );
    const row = await dbGet(`SELECT * FROM happy_menu_items WHERE id=?`, id);
    ok(res, serializeItem(row));
  } catch (e: any) { err(res, e.message, 500); }
});

// Toggle availability mid-service ("86 an item") — manager + admin.
happyMenuRouter.put('/restaurant/menu/items/:id/availability', requireHappyAuth, requireHappyRole(['manager', 'admin']), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  const { id } = req.params;
  const { is_available } = req.body ?? {};
  if (typeof is_available !== 'boolean') return err(res, 'is_available (boolean) is required');
  try {
    const existing = await dbGet(`SELECT id FROM happy_menu_items WHERE id=? AND tenant_id=?`, id, tenantId);
    if (!existing) return err(res, 'Item not found', 404);
    await dbRun(`UPDATE happy_menu_items SET is_available=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, is_available ? 1 : 0, id);
    const row = await dbGet(`SELECT * FROM happy_menu_items WHERE id=?`, id);
    ok(res, serializeItem(row));
  } catch (e: any) { err(res, e.message, 500); }
});

happyMenuRouter.delete('/restaurant/menu/items/:id', requireHappyAuth, requireHappyRole('admin'), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  const { id } = req.params;
  try {
    const existing = await dbGet(`SELECT id FROM happy_menu_items WHERE id=? AND tenant_id=?`, id, tenantId);
    if (!existing) return err(res, 'Item not found', 404);
    await dbRun(`UPDATE happy_menu_items SET is_active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?`, id);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});
