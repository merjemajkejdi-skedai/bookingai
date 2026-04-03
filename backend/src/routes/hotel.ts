import { Router, type Request, type Response } from 'express';
import { requireAuth, resolveTenantId } from '../middleware/auth.js';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';

export const hotelRouter = Router();

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
// Requests
// ---------------------------------------------------------------------------

// GET /hotel/requests?status=pending
hotelRouter.get('/requests', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const status = (req.query.status as string) || 'pending';
  try {
    const rows = await dbAll(
      `SELECT * FROM hotel_requests WHERE tenant_id = ? AND status = ? ORDER BY created_at ASC`,
      tenantId, status,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

// PATCH /hotel/requests/:id
hotelRouter.patch('/requests/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { status } = req.body as { status: string };
  if (!status) return err(res, 'status is required');
  try {
    const resolvedAt = status === 'resolved' ? new Date().toISOString() : null;
    await dbRun(
      `UPDATE hotel_requests SET status = ?, resolved_at = ? WHERE id = ? AND tenant_id = ?`,
      status, resolvedAt, req.params.id, tenantId,
    );
    ok(res, { updated: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// Guests
// ---------------------------------------------------------------------------

// GET /hotel/guests
hotelRouter.get('/guests', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      `SELECT * FROM hotel_guest_stays WHERE tenant_id = ? AND status = 'checked_in' ORDER BY room_number`,
      tenantId,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /hotel/guests/checkin
hotelRouter.post('/guests/checkin', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { room_number, guest_name, guest_phone, check_in, check_out } = req.body as {
    room_number: string; guest_name: string; guest_phone: string;
    check_in: string; check_out: string;
  };
  if (!room_number || !guest_name || !guest_phone || !check_in || !check_out) {
    return err(res, 'room_number, guest_name, guest_phone, check_in, check_out are required');
  }
  try {
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO hotel_guest_stays
         (id, tenant_id, room_number, guest_name, guest_phone, check_in, check_out)
       VALUES (?,?,?,?,?,?,?)`,
      id, tenantId, room_number, guest_name, guest_phone, check_in, check_out,
    );
    const row = await dbGet('SELECT * FROM hotel_guest_stays WHERE id = ?', id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

// PATCH /hotel/guests/:id/checkout
hotelRouter.patch('/guests/:id/checkout', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun(
      `UPDATE hotel_guest_stays SET status = 'checked_out' WHERE id = ? AND tenant_id = ?`,
      req.params.id, tenantId,
    );
    ok(res, { checked_out: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// GET /hotel/config
hotelRouter.get('/config', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const row = await dbGet('SELECT * FROM hotel_config WHERE tenant_id = ?', tenantId);
    ok(res, row || {});
  } catch (e: any) { err(res, e.message, 500); }
});

// PUT /hotel/config
hotelRouter.put('/config', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const {
    hotel_name, check_in_time = '14:00', check_out_time = '11:00',
    wifi_password = null, breakfast_hours = null, pool_hours = null,
    restaurant_hours = null, reception_phone = null, emergency_phone = null,
    location_url = null, menu_url = null,
  } = req.body;

  if (!hotel_name) return err(res, 'hotel_name is required');

  try {
    await dbRun(
      `INSERT INTO hotel_config
         (tenant_id, hotel_name, check_in_time, check_out_time, wifi_password,
          breakfast_hours, pool_hours, restaurant_hours, reception_phone, emergency_phone,
          location_url, menu_url)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (tenant_id) DO UPDATE SET
         hotel_name = excluded.hotel_name,
         check_in_time = excluded.check_in_time,
         check_out_time = excluded.check_out_time,
         wifi_password = excluded.wifi_password,
         breakfast_hours = excluded.breakfast_hours,
         pool_hours = excluded.pool_hours,
         restaurant_hours = excluded.restaurant_hours,
         reception_phone = excluded.reception_phone,
         emergency_phone = excluded.emergency_phone,
         location_url = excluded.location_url,
         menu_url = excluded.menu_url`,
      tenantId, hotel_name, check_in_time, check_out_time, wifi_password,
      breakfast_hours, pool_hours, restaurant_hours, reception_phone, emergency_phone,
      location_url, menu_url,
    );
    ok(res, { updated: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

// GET /hotel/faq
hotelRouter.get('/faq', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      `SELECT * FROM hotel_faq WHERE tenant_id = ? ORDER BY category, question`,
      tenantId,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /hotel/faq
hotelRouter.post('/faq', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { question, answer, category } = req.body as {
    question: string; answer: string; category: string;
  };
  if (!question || !answer || !category) {
    return err(res, 'question, answer, and category are required');
  }
  try {
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO hotel_faq (id, tenant_id, question, answer, category) VALUES (?,?,?,?,?)`,
      id, tenantId, question, answer, category,
    );
    const row = await dbGet('SELECT * FROM hotel_faq WHERE id = ?', id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

// DELETE /hotel/faq/:id
hotelRouter.delete('/faq/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun(
      'DELETE FROM hotel_faq WHERE id = ? AND tenant_id = ?',
      req.params.id, tenantId,
    );
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

const REQUEST_TYPES = ['room_service', 'housekeeping', 'maintenance', 'concierge_question', 'complaint', 'other'];

// GET /hotel/departments
hotelRouter.get('/departments', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      `SELECT * FROM hotel_departments WHERE tenant_id = ? ORDER BY name`,
      tenantId,
    ) as any[];
    // Parse request_types JSON string for each row
    ok(res, rows.map(r => ({ ...r, request_types: JSON.parse(r.request_types || '[]') })));
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /hotel/departments
hotelRouter.post('/departments', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, whatsapp, request_types } = req.body as {
    name: string; whatsapp: string; request_types: string[];
  };
  if (!name || !whatsapp || !Array.isArray(request_types) || !request_types.length) {
    return err(res, 'name, whatsapp, and request_types are required');
  }
  const invalid = request_types.filter(t => !REQUEST_TYPES.includes(t));
  if (invalid.length) return err(res, `Invalid request types: ${invalid.join(', ')}`);

  try {
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO hotel_departments (id, tenant_id, name, whatsapp, request_types)
       VALUES (?,?,?,?,?)`,
      id, tenantId, name, whatsapp, JSON.stringify(request_types),
    );
    const row = await dbGet('SELECT * FROM hotel_departments WHERE id = ?', id) as any;
    ok(res, { ...row, request_types: JSON.parse(row.request_types || '[]') });
  } catch (e: any) { err(res, e.message, 500); }
});

// PUT /hotel/departments/:id
hotelRouter.put('/departments/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, whatsapp, request_types, is_active } = req.body as {
    name: string; whatsapp: string; request_types: string[]; is_active?: boolean;
  };
  if (!name || !whatsapp || !Array.isArray(request_types) || !request_types.length) {
    return err(res, 'name, whatsapp, and request_types are required');
  }
  try {
    await dbRun(
      `UPDATE hotel_departments SET name = ?, whatsapp = ?, request_types = ?, is_active = ?
       WHERE id = ? AND tenant_id = ?`,
      name, whatsapp, JSON.stringify(request_types),
      is_active === false ? 0 : 1,
      req.params.id, tenantId,
    );
    ok(res, { updated: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// DELETE /hotel/departments/:id
hotelRouter.delete('/departments/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun(
      'DELETE FROM hotel_departments WHERE id = ? AND tenant_id = ?',
      req.params.id, tenantId,
    );
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});
