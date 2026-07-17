import { Router, Request, Response } from 'express';
import { requireHappyAuth, requireHappyRole, HappyUser } from '../../middleware/happyAuth.js';
import { dbAll, dbGet, dbRun, ok, err, todayStr } from './shared.js';

export const happyOrdersRouter = Router();

async function nextOrderNumber(tenantId: string, date: string): Promise<number> {
  await dbRun(
    `INSERT INTO happy_order_sequences (tenant_id, date, last_order_number, last_ticket_number) VALUES (?, ?, 1, 0)
     ON CONFLICT (tenant_id, date) DO UPDATE SET last_order_number = happy_order_sequences.last_order_number + 1`,
    tenantId, date,
  );
  const row = await dbGet(`SELECT last_order_number FROM happy_order_sequences WHERE tenant_id=? AND date=?`, tenantId, date);
  return Number(row.last_order_number);
}

async function nextTicketNumber(tenantId: string, date: string): Promise<number> {
  await dbRun(
    `INSERT INTO happy_order_sequences (tenant_id, date, last_order_number, last_ticket_number) VALUES (?, ?, 0, 1)
     ON CONFLICT (tenant_id, date) DO UPDATE SET last_ticket_number = happy_order_sequences.last_ticket_number + 1`,
    tenantId, date,
  );
  const row = await dbGet(`SELECT last_ticket_number FROM happy_order_sequences WHERE tenant_id=? AND date=?`, tenantId, date);
  return Number(row.last_ticket_number);
}

function serializeOrder(row: any) {
  return {
    id: row.id, table_id: row.table_id, waiter_id: row.waiter_id,
    order_number: Number(row.order_number), ticket_number: row.ticket_number != null ? Number(row.ticket_number) : null,
    status: row.status, payment_status: row.payment_status, payment_method: row.payment_method,
    subtotal: Number(row.subtotal), discount: Number(row.discount), total: Number(row.total),
    notes: row.notes, opened_at: row.opened_at, bill_requested_at: row.bill_requested_at, paid_at: row.paid_at,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

function serializeItem(row: any) {
  return {
    id: row.id, order_id: row.order_id, menu_item_id: row.menu_item_id, name: row.name,
    unit_price: Number(row.unit_price), modifiers_price: Number(row.modifiers_price), total_price: Number(row.total_price),
    quantity: Number(row.quantity), course: row.course, destination: row.destination, status: row.status,
    sent_at: row.sent_at, notes: row.notes,
  };
}

async function recalcOrderTotals(orderId: string) {
  const items = await dbAll(`SELECT total_price FROM happy_order_items WHERE order_id=? AND status != 'voided'`, orderId);
  const subtotal = items.reduce((sum: number, it: any) => sum + Number(it.total_price), 0);
  const order = await dbGet(`SELECT discount FROM happy_orders WHERE id=?`, orderId);
  const total = Math.max(0, subtotal - Number(order?.discount ?? 0));
  await dbRun(`UPDATE happy_orders SET subtotal=?, total=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, subtotal, total, orderId);
}

// waiters only see/touch their own orders; manager/admin see everything tenant-wide
function scopeToWaiter(user: HappyUser) {
  return user.role === 'waiter' ? user.staffId : null;
}

// ── List / detail ────────────────────────────────────────────────────────────

happyOrdersRouter.get('/restaurant/orders', requireHappyAuth, requireHappyRole(['waiter', 'manager', 'admin']), async (req: Request, res: Response) => {
  const user = req.happyUser as HappyUser;
  const { status, table_id, date, waiter_id } = req.query as Record<string, string>;
  try {
    let sql = `SELECT * FROM happy_orders WHERE tenant_id=?`;
    const params: unknown[] = [user.tenantId];
    const ownWaiterId = scopeToWaiter(user);
    if (ownWaiterId) { sql += ' AND waiter_id=?'; params.push(ownWaiterId); }
    else if (waiter_id) { sql += ' AND waiter_id=?'; params.push(waiter_id); }
    if (status)   { sql += ' AND status=?'; params.push(status); }
    if (table_id) { sql += ' AND table_id=?'; params.push(table_id); }
    if (date)     { sql += ' AND opened_at >= ? AND opened_at < ?'; params.push(`${date}T00:00:00`, `${date}T23:59:59.999`); }
    sql += ' ORDER BY opened_at DESC';
    const rows = await dbAll(sql, ...params);
    ok(res, rows.map(serializeOrder));
  } catch (e: any) { err(res, e.message, 500); }
});

happyOrdersRouter.post('/restaurant/orders', requireHappyAuth, requireHappyRole(['waiter', 'manager', 'admin']), async (req: Request, res: Response) => {
  const user = req.happyUser as HappyUser;
  const { table_id = null, notes = null } = req.body ?? {};
  try {
    const settings = await dbGet(`SELECT counter_service_enabled FROM happy_settings WHERE tenant_id=?`, user.tenantId);
    let table: any = null;
    if (table_id) {
      table = await dbGet(`SELECT * FROM happy_tables WHERE id=? AND tenant_id=? AND is_active=1`, table_id, user.tenantId);
      if (!table) return err(res, 'Table not found', 404);
    } else if (!settings?.counter_service_enabled) {
      return err(res, 'Counter service is not enabled for this venue — table_id is required');
    }

    const date = todayStr();
    const orderNumber = await nextOrderNumber(user.tenantId, date);
    const ticketNumber = table_id ? null : await nextTicketNumber(user.tenantId, date);

    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO happy_orders (id, tenant_id, table_id, waiter_id, order_number, ticket_number, notes)
       VALUES (?,?,?,?,?,?,?)`,
      id, user.tenantId, table_id, user.staffId, orderNumber, ticketNumber, notes,
    );
    if (table) {
      await dbRun(`UPDATE happy_tables SET status='occupied', current_order_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, id, table.id);
    }
    const row = await dbGet(`SELECT * FROM happy_orders WHERE id=?`, id);
    ok(res, serializeOrder(row));
  } catch (e: any) { err(res, e.message, 500); }
});

happyOrdersRouter.get('/restaurant/orders/:id', requireHappyAuth, requireHappyRole(['waiter', 'manager', 'admin']), async (req: Request, res: Response) => {
  const user = req.happyUser as HappyUser;
  const { id } = req.params;
  try {
    const order = await dbGet(`SELECT * FROM happy_orders WHERE id=? AND tenant_id=?`, id, user.tenantId);
    if (!order) return err(res, 'Order not found', 404);
    if (scopeToWaiter(user) && order.waiter_id !== user.staffId) return err(res, 'Order not found', 404);
    const items = await dbAll(`SELECT * FROM happy_order_items WHERE order_id=? AND status != 'voided' ORDER BY created_at ASC`, id);
    ok(res, { ...serializeOrder(order), items: items.map(serializeItem) });
  } catch (e: any) { err(res, e.message, 500); }
});

// ── Items ────────────────────────────────────────────────────────────────────
// body: { items: [{ id?, menu_item_id?, quantity, notes? }] }
// - entries with an existing id: quantity<=0 removes it (only if still 'pending'),
//   otherwise updates quantity/notes
// - entries without an id: inserted as new 'pending' items, price + destination
//   resolved and snapshotted right now (menu changes later never touch this order)
happyOrdersRouter.put('/restaurant/orders/:id/items', requireHappyAuth, requireHappyRole(['waiter', 'manager', 'admin']), async (req: Request, res: Response) => {
  const user = req.happyUser as HappyUser;
  const { id } = req.params;
  const { items } = req.body ?? {};
  if (!Array.isArray(items) || items.length === 0) return err(res, 'items array is required');

  try {
    const order = await dbGet(`SELECT * FROM happy_orders WHERE id=? AND tenant_id=?`, id, user.tenantId);
    if (!order) return err(res, 'Order not found', 404);
    if (scopeToWaiter(user) && order.waiter_id !== user.staffId) return err(res, 'Order not found', 404);
    if (order.status !== 'open') return err(res, 'Order is not open — cannot modify items');

    for (const entry of items) {
      if (entry.id) {
        const existing = await dbGet(`SELECT * FROM happy_order_items WHERE id=? AND order_id=?`, entry.id, id);
        if (!existing) return err(res, `Order item ${entry.id} not found`, 404);
        if (existing.status !== 'pending') return err(res, `Order item ${entry.id} has already been sent — cannot edit`);
        const qty = entry.quantity != null ? Number(entry.quantity) : Number(existing.quantity);
        if (qty <= 0) {
          await dbRun(`DELETE FROM happy_order_items WHERE id=?`, entry.id);
        } else {
          const totalPrice = (Number(existing.unit_price) + Number(existing.modifiers_price)) * qty;
          await dbRun(
            `UPDATE happy_order_items SET quantity=?, total_price=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
            qty, totalPrice, entry.notes !== undefined ? entry.notes : existing.notes, entry.id,
          );
        }
      } else {
        if (!entry.menu_item_id) return err(res, 'menu_item_id is required for new items');
        const qty = Number(entry.quantity ?? 1);
        if (qty <= 0) continue;
        const menuItem = await dbGet(`SELECT * FROM happy_menu_items WHERE id=? AND tenant_id=? AND is_active=1`, entry.menu_item_id, user.tenantId);
        if (!menuItem) return err(res, `Menu item ${entry.menu_item_id} not found`, 404);
        if (!menuItem.is_available) return err(res, `${menuItem.name} is not currently available`);
        const category = await dbGet(`SELECT destination FROM happy_menu_categories WHERE id=?`, menuItem.category_id);
        const destination = menuItem.destination_override || category?.destination || 'kitchen';
        const unitPrice = Number(menuItem.price);
        const totalPrice = unitPrice * qty;
        const itemId = crypto.randomUUID();
        await dbRun(
          `INSERT INTO happy_order_items
            (id, order_id, tenant_id, menu_item_id, name, unit_price, modifiers_price, total_price, quantity, course, destination, notes)
           VALUES (?,?,?,?,?,?,0,?,?,?,?,?)`,
          itemId, id, user.tenantId, menuItem.id, menuItem.name, unitPrice, totalPrice, qty, menuItem.course, destination, entry.notes ?? null,
        );
      }
    }

    await recalcOrderTotals(id);
    const updatedOrder = await dbGet(`SELECT * FROM happy_orders WHERE id=?`, id);
    const updatedItems = await dbAll(`SELECT * FROM happy_order_items WHERE order_id=? AND status != 'voided' ORDER BY created_at ASC`, id);
    ok(res, { ...serializeOrder(updatedOrder), items: updatedItems.map(serializeItem) });
  } catch (e: any) { err(res, e.message, 500); }
});

// ── Send to kitchen/bar ──────────────────────────────────────────────────────
happyOrdersRouter.post('/restaurant/orders/:id/send', requireHappyAuth, requireHappyRole(['waiter', 'manager', 'admin']), async (req: Request, res: Response) => {
  const user = req.happyUser as HappyUser;
  const { id } = req.params;
  try {
    const order = await dbGet(`SELECT * FROM happy_orders WHERE id=? AND tenant_id=?`, id, user.tenantId);
    if (!order) return err(res, 'Order not found', 404);
    if (scopeToWaiter(user) && order.waiter_id !== user.staffId) return err(res, 'Order not found', 404);

    const pending = await dbAll(`SELECT * FROM happy_order_items WHERE order_id=? AND status='pending'`, id);
    if (pending.length === 0) return err(res, 'No pending items to send');

    let tableDisplay: string;
    if (order.table_id) {
      const table = await dbGet(`SELECT number, name FROM happy_tables WHERE id=?`, order.table_id);
      tableDisplay = table?.name || (table?.number != null ? `Table ${table.number}` : 'Table');
    } else {
      tableDisplay = `Counter #${order.ticket_number}`;
    }

    const byDestination = new Map<string, any[]>();
    for (const it of pending) {
      const list = byDestination.get(it.destination) ?? [];
      list.push(it);
      byDestination.set(it.destination, list);
    }

    for (const [destination, destItems] of byDestination) {
      const eventItems = destItems.map((it: any) => ({
        name: it.name, quantity: Number(it.quantity), notes: it.notes, course: it.course,
      }));
      await dbRun(
        `INSERT INTO happy_kitchen_events (id, tenant_id, order_id, table_id, table_display, event_type, destination, items)
         VALUES (?,?,?,?,?,'new_items',?,?)`,
        crypto.randomUUID(), user.tenantId, id, order.table_id, tableDisplay, destination, JSON.stringify(eventItems),
      );
    }

    const ids = pending.map((it: any) => it.id);
    for (const itemId of ids) {
      await dbRun(`UPDATE happy_order_items SET status='sent', sent_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`, itemId);
    }

    const updatedOrder = await dbGet(`SELECT * FROM happy_orders WHERE id=?`, id);
    const updatedItems = await dbAll(`SELECT * FROM happy_order_items WHERE order_id=? AND status != 'voided' ORDER BY created_at ASC`, id);
    ok(res, { ...serializeOrder(updatedOrder), items: updatedItems.map(serializeItem) });
  } catch (e: any) { err(res, e.message, 500); }
});
