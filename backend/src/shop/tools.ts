import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';

async function dbAll(sql: string, ...p: unknown[]) { return (isPg ? query(sql, p) : prepare(sql).all(...p)) as any[]; }
async function dbGet(sql: string, ...p: unknown[]) { return (isPg ? queryOne(sql, p) : prepare(sql).get(...p)) as any; }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

function isAvailable(item: any, qty = 1): boolean {
  if (item.stock_type === 'unlimited' || item.stock_limit == null) return true;
  return (Number(item.stock_limit) - Number(item.stock_used)) >= qty;
}

function stockStatus(item: any): string {
  if (item.stock_type === 'unlimited' || item.stock_limit == null) return 'available';
  const remaining = Number(item.stock_limit) - Number(item.stock_used);
  if (remaining <= 0) return 'out_of_stock';
  if (remaining <= 3) return `only ${remaining} left`;
  return 'available';
}

export const shopTools: Anthropic.Tool[] = [
  {
    name: 'get_menu',
    description: 'Browse the shop menu. Call this whenever a customer asks what is available, wants to see the menu, or asks about specific products.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category_id: { type: 'string', description: 'Optional: filter by category ID' },
        search: { type: 'string', description: 'Optional: search items by name or description keyword' },
      },
    },
  },
  {
    name: 'check_stock',
    description: 'Check if specific items are available in the requested quantities before creating an order.',
    input_schema: {
      type: 'object' as const,
      properties: {
        items: {
          type: 'array',
          items: { type: 'object', properties: { item_id: { type: 'string' }, quantity: { type: 'number' } }, required: ['item_id', 'quantity'] },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'create_order',
    description: 'Create a new order after the customer has confirmed their selection. Always confirm the order summary with the customer first.',
    input_schema: {
      type: 'object' as const,
      properties: {
        items: {
          type: 'array',
          items: { type: 'object', properties: { item_id: { type: 'string' }, quantity: { type: 'number' } }, required: ['item_id', 'quantity'] },
        },
        pickup_name: { type: 'string', description: 'Name to use for pickup — required' },
        notes: { type: 'string', description: 'Optional special instructions' },
      },
      required: ['items', 'pickup_name'],
    },
  },
  {
    name: 'add_to_order',
    description: 'Add more items to an existing order. Only works for orders with status "new".',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: { type: 'string' },
        items: {
          type: 'array',
          items: { type: 'object', properties: { item_id: { type: 'string' }, quantity: { type: 'number' } }, required: ['item_id', 'quantity'] },
        },
      },
      required: ['order_id', 'items'],
    },
  },
  {
    name: 'cancel_order',
    description: 'Cancel an existing order. Only works for orders with status "new".',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: { type: 'string' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'get_order_status',
    description: 'Get the current status and details of an order by its ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: { type: 'string' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'get_faq',
    description: 'Look up frequently asked questions about the shop (hours, policies, pickup, payment, etc.).',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'The customer question to look up' },
      },
      required: ['query'],
    },
  },
];

export async function executeShopTool(
  toolName: string,
  input: any,
  tenantId: string,
  guestPhone: string,
): Promise<any> {
  console.log(`[Shop] tool call: ${toolName}`, JSON.stringify(input));
  switch (toolName) {
    case 'get_menu': {
      try {
        // LOG 1 — what tenantId is the tool receiving?
        console.log('[Shop get_menu] tenantId received:', tenantId);
        console.log('[Shop get_menu] category filter:', input.category_id || 'none');

        // LOG 2 — raw count for this tenant (no filters)
        const countRow = await dbGet(`SELECT COUNT(*) as total FROM shop_menu_items WHERE tenant_id = ?`, tenantId);
        console.log('[Shop get_menu] raw count for tenant:', JSON.stringify(countRow));

        // LOG 3 — all items without is_active filter
        const allItems = await dbAll(`SELECT id, name, is_active, tenant_id FROM shop_menu_items WHERE tenant_id = ?`, tenantId);
        console.log('[Shop get_menu] all items (no filter):', JSON.stringify(allItems));

        // LOG 4 — distinct is_active values
        const distinctActive = await dbAll(`SELECT DISTINCT is_active FROM shop_menu_items WHERE tenant_id = ?`, tenantId);
        console.log('[Shop get_menu] distinct is_active values:', JSON.stringify(distinctActive));

        const categories = await dbAll(
          `SELECT id, name, description, sort_order FROM shop_menu_categories WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order ASC`,
          tenantId,
        );
        let itemSql = `SELECT i.*, c.name AS category_name FROM shop_menu_items i LEFT JOIN shop_menu_categories c ON i.category_id = c.id WHERE i.tenant_id = ? AND i.is_active != 0`;
        const params: unknown[] = [tenantId];
        if (input.category_id) { itemSql += ` AND i.category_id = ?`; params.push(input.category_id); }
        if (input.search) {
          const s = `%${String(input.search).toLowerCase()}%`;
          itemSql += ` AND (LOWER(i.name) LIKE ? OR LOWER(i.description) LIKE ?)`;
          params.push(s, s);
        }
        itemSql += ` ORDER BY i.sort_order ASC`;
        const items = await dbAll(itemSql, ...params);

        // LOG 5 — final result
        console.log('[Shop get_menu] final query returned:', items.length, 'items');
        console.log('[Shop get_menu] first item sample:', JSON.stringify(items[0] || null));
        if (items.length === 0) {
          console.log('[Shop get_menu] ⚠️ ZERO RESULTS — check tenant_id match and is_active values above');
        }

        return {
          success: true,
          categories,
          items: items.map((item: any) => ({ ...item, stock_status: stockStatus(item), available: isAvailable(item) })),
          item_count: items.length,
        };
      } catch (err: any) {
        console.error('[Shop] get_menu failed:', err.message);
        return { success: false, error: err.message, items: [], categories: [] };
      }
    }

    case 'check_stock': {
      const checks = (input.items || []) as Array<{ item_id: string; quantity: number }>;
      if (!checks.length) return { available: true, items: [] };
      const ids = checks.map((c) => c.item_id);
      const ph = ids.map(() => '?').join(',');
      const menuItems = await dbAll(`SELECT * FROM shop_menu_items WHERE tenant_id = ? AND id IN (${ph})`, tenantId, ...ids);
      const result = checks.map((c) => {
        const item = menuItems.find((m: any) => m.id === c.item_id);
        if (!item) return { item_id: c.item_id, quantity: c.quantity, available: false, reason: 'Item not found' };
        const ok = isAvailable(item, c.quantity);
        return { item_id: c.item_id, item_name: item.name, quantity: c.quantity, available: ok, stock_status: stockStatus(item), reason: ok ? undefined : 'Insufficient stock' };
      });
      return { available: result.every((r) => r.available), items: result };
    }

    case 'create_order': {
      const { items, pickup_name, notes } = input as { items: Array<{ item_id: string; quantity: number }>; pickup_name: string; notes?: string };
      if (!items?.length) return { success: false, message: 'No items provided' };

      const ids = items.map((i) => i.item_id);
      const ph = ids.map(() => '?').join(',');
      const menuItems = await dbAll(`SELECT * FROM shop_menu_items WHERE tenant_id = ? AND id IN (${ph}) AND is_active = 1`, tenantId, ...ids);

      const lineItems: Array<{ item: any; qty: number }> = [];
      for (const req of items) {
        const item = menuItems.find((m: any) => m.id === req.item_id);
        if (!item) return { success: false, message: `Item not found or unavailable` };
        if (!isAvailable(item, req.quantity)) return { success: false, message: `${item.name} is out of stock or insufficient quantity available` };
        lineItems.push({ item, qty: req.quantity });
      }

      const today = new Date().toISOString().split('T')[0];
      const nextNumRow = await dbGet(
        `SELECT COALESCE(MAX(order_number), 0) + 1 AS next_num FROM shop_orders WHERE tenant_id = ? AND order_date = ?`,
        tenantId, today,
      );
      const orderNumber = Number(nextNumRow?.next_num ?? 1);
      const totalPrice = lineItems.reduce((s, li) => s + parseFloat(li.item.price) * li.qty, 0);
      const currency = lineItems[0]?.item?.currency || 'ALL';
      const orderId = crypto.randomUUID();

      await dbRun(
        `INSERT INTO shop_orders (id, tenant_id, order_number, order_date, guest_phone, pickup_name, status, total_price, currency, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        orderId, tenantId, orderNumber, today, guestPhone, pickup_name, 'new', totalPrice, currency, notes || null,
      );

      for (const li of lineItems) {
        await dbRun(
          `INSERT INTO shop_order_items (id, order_id, tenant_id, item_id, item_name, item_price, quantity, subtotal) VALUES (?,?,?,?,?,?,?,?)`,
          crypto.randomUUID(), orderId, tenantId, li.item.id, li.item.name, li.item.price, li.qty, parseFloat(li.item.price) * li.qty,
        );
        if (li.item.stock_type !== 'unlimited') {
          await dbRun(`UPDATE shop_menu_items SET stock_used = stock_used + ? WHERE id = ?`, li.qty, li.item.id);
        }
      }

      const config = await dbGet(`SELECT estimated_pickup_minutes FROM shop_config WHERE tenant_id = ?`, tenantId);
      const etaMins = config?.estimated_pickup_minutes ?? 15;

      return {
        success: true,
        order_id: orderId,
        order_number: orderNumber,
        total_price: totalPrice,
        currency,
        estimated_pickup_minutes: etaMins,
        items: lineItems.map((li) => ({ name: li.item.name, quantity: li.qty, subtotal: parseFloat(li.item.price) * li.qty })),
      };
    }

    case 'add_to_order': {
      const { order_id, items } = input as { order_id: string; items: Array<{ item_id: string; quantity: number }> };
      const order = await dbGet(
        `SELECT * FROM shop_orders WHERE id = ? AND tenant_id = ? AND status = 'new'`,
        order_id, tenantId,
      );
      if (!order) return { success: false, message: 'Order not found or no longer modifiable' };

      const ids = items.map((i) => i.item_id);
      const ph = ids.map(() => '?').join(',');
      const menuItems = await dbAll(`SELECT * FROM shop_menu_items WHERE tenant_id = ? AND id IN (${ph}) AND is_active = 1`, tenantId, ...ids);

      let addedTotal = 0;
      for (const req of items) {
        const item = menuItems.find((m: any) => m.id === req.item_id);
        if (!item) return { success: false, message: `Item not found` };
        if (!isAvailable(item, req.quantity)) return { success: false, message: `${item.name} is out of stock` };

        const existing = await dbGet(`SELECT id, quantity FROM shop_order_items WHERE order_id = ? AND item_id = ?`, order_id, req.item_id);
        if (existing) {
          const newQty = Number(existing.quantity) + req.quantity;
          await dbRun(`UPDATE shop_order_items SET quantity = ?, subtotal = ? WHERE id = ?`, newQty, parseFloat(item.price) * newQty, existing.id);
        } else {
          await dbRun(
            `INSERT INTO shop_order_items (id, order_id, tenant_id, item_id, item_name, item_price, quantity, subtotal) VALUES (?,?,?,?,?,?,?,?)`,
            crypto.randomUUID(), order_id, tenantId, item.id, item.name, item.price, req.quantity, parseFloat(item.price) * req.quantity,
          );
        }
        if (item.stock_type !== 'unlimited') {
          await dbRun(`UPDATE shop_menu_items SET stock_used = stock_used + ? WHERE id = ?`, req.quantity, item.id);
        }
        addedTotal += parseFloat(item.price) * req.quantity;
      }

      const newTotal = parseFloat(order.total_price) + addedTotal;
      await dbRun(`UPDATE shop_orders SET total_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, newTotal, order_id);
      return { success: true, order_id, new_total: newTotal };
    }

    case 'cancel_order': {
      const { order_id } = input;
      const order = await dbGet(
        `SELECT * FROM shop_orders WHERE id = ? AND tenant_id = ? AND guest_phone = ? AND status = 'new'`,
        order_id, tenantId, guestPhone,
      );
      if (!order) return { success: false, message: 'Order not found or cannot be cancelled (must be status "new")' };

      const orderItems = await dbAll(`SELECT item_id, quantity FROM shop_order_items WHERE order_id = ?`, order_id);
      for (const oi of orderItems) {
        const restoreSql = isPg
          ? `UPDATE shop_menu_items SET stock_used = GREATEST(0, stock_used - ?) WHERE id = ? AND stock_type != 'unlimited'`
          : `UPDATE shop_menu_items SET stock_used = max(0, stock_used - ?) WHERE id = ? AND stock_type != 'unlimited'`;
        await dbRun(restoreSql, oi.quantity, oi.item_id);
      }

      await dbRun(
        `UPDATE shop_orders SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        order_id,
      );
      return { success: true, message: 'Order cancelled successfully' };
    }

    case 'get_order_status': {
      const { order_id } = input;
      const order = await dbGet(`SELECT * FROM shop_orders WHERE id = ? AND tenant_id = ?`, order_id, tenantId);
      if (!order) return { found: false, message: 'Order not found' };
      const items = await dbAll(`SELECT item_name, quantity, item_price, subtotal FROM shop_order_items WHERE order_id = ?`, order_id);
      return { found: true, order: { ...order, items } };
    }

    case 'get_faq': {
      const faqs = await dbAll(
        `SELECT question, answer FROM shop_faq WHERE tenant_id = ? ORDER BY sort_order ASC`,
        tenantId,
      );
      return { faqs };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
