import { Router, Request, Response } from 'express';
import { requireHappyAuth, requireHappyRole, HappyUser } from '../../middleware/happyAuth.js';
import { dbAll, dbGet, dbRun, ok, err, boolOut } from './shared.js';

export const happyKitchenRouter = Router();

const ITEM_STATUSES = ['in_progress', 'ready', 'delivered'];

function serializeEvent(row: any) {
  let items: unknown[] = [];
  try { items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items; } catch { items = []; }
  return {
    id: row.id, order_id: row.order_id, table_id: row.table_id, table_display: row.table_display,
    event_type: row.event_type, destination: row.destination, course: row.course, items,
    is_acknowledged: boolOut(row.is_acknowledged), acknowledged_at: row.acknowledged_at,
    created_at: row.created_at,
  };
}

async function listEvents(tenantId: string, destination: 'kitchen' | 'bar') {
  return dbAll(
    `SELECT * FROM happy_kitchen_events WHERE tenant_id=? AND destination=? AND is_acknowledged=0 ORDER BY created_at ASC`,
    tenantId, destination,
  );
}

happyKitchenRouter.get('/restaurant/kitchen/events', requireHappyAuth, requireHappyRole(['kitchen', 'manager', 'admin']), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  try {
    const rows = await listEvents(tenantId, 'kitchen');
    ok(res, rows.map(serializeEvent));
  } catch (e: any) { err(res, e.message, 500); }
});

happyKitchenRouter.get('/restaurant/bar/events', requireHappyAuth, requireHappyRole(['bar', 'manager', 'admin']), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  try {
    const rows = await listEvents(tenantId, 'bar');
    ok(res, rows.map(serializeEvent));
  } catch (e: any) { err(res, e.message, 500); }
});

async function acknowledge(req: Request, res: Response, destination: 'kitchen' | 'bar') {
  const user = req.happyUser as HappyUser;
  const { id } = req.params;
  try {
    const existing = await dbGet(`SELECT * FROM happy_kitchen_events WHERE id=? AND tenant_id=? AND destination=?`, id, user.tenantId, destination);
    if (!existing) return err(res, 'Event not found', 404);
    await dbRun(
      `UPDATE happy_kitchen_events SET is_acknowledged=1, acknowledged_at=CURRENT_TIMESTAMP, acknowledged_by=? WHERE id=?`,
      user.staffId, id,
    );
    const row = await dbGet(`SELECT * FROM happy_kitchen_events WHERE id=?`, id);
    ok(res, serializeEvent(row));
  } catch (e: any) { err(res, e.message, 500); }
}

happyKitchenRouter.put('/restaurant/kitchen/events/:id/acknowledge', requireHappyAuth, requireHappyRole(['kitchen', 'manager', 'admin']), (req, res) => acknowledge(req, res, 'kitchen'));
happyKitchenRouter.put('/restaurant/bar/events/:id/acknowledge', requireHappyAuth, requireHappyRole(['bar', 'manager', 'admin']), (req, res) => acknowledge(req, res, 'bar'));

// Kitchen/bar mark an individual item's prep status.
happyKitchenRouter.put('/restaurant/order-items/:id/status', requireHappyAuth, requireHappyRole(['kitchen', 'bar', 'manager', 'admin']), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  const { id } = req.params;
  const { status } = req.body ?? {};
  if (!ITEM_STATUSES.includes(status)) return err(res, `status must be one of: ${ITEM_STATUSES.join(', ')}`);
  try {
    const existing = await dbGet(`SELECT * FROM happy_order_items WHERE id=? AND tenant_id=?`, id, tenantId);
    if (!existing) return err(res, 'Order item not found', 404);
    await dbRun(`UPDATE happy_order_items SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, status, id);
    const row = await dbGet(`SELECT * FROM happy_order_items WHERE id=?`, id);
    ok(res, {
      id: row.id, order_id: row.order_id, name: row.name, quantity: Number(row.quantity),
      status: row.status, destination: row.destination,
    });
  } catch (e: any) { err(res, e.message, 500); }
});
