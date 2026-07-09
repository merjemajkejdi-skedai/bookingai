import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';

async function dbAll(sql: string, ...p: unknown[]) { return (isPg ? query(sql, p) : prepare(sql).all(...p)) as any[]; }
async function dbGet(sql: string, ...p: unknown[]) { return (isPg ? queryOne(sql, p) : prepare(sql).get(...p)) as any; }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

export interface StaffCommandResult {
  handled: boolean;
  reply: string;
}

// Parses staff WhatsApp commands:
//   "1 done"           → order #1 marked done
//   "1 in progress"    → order #1 marked in_progress
//   "1 cancel"         → order #1 cancelled (no reason)
//   "1 cancel reason"  → order #1 cancelled with reason
export async function handleStaffCommand(
  message: string,
  tenantId: string,
  tenant: any,
): Promise<StaffCommandResult> {
  const trimmed = message.trim();

  const doneMatch       = trimmed.match(/^(\d+)\s+done$/i);
  const inProgMatch     = trimmed.match(/^(\d+)\s+in\s*progress$/i);
  const cancelMatch     = trimmed.match(/^(\d+)\s+cancel(.*)$/i);

  if (!doneMatch && !inProgMatch && !cancelMatch) {
    return { handled: false, reply: '' };
  }

  if (doneMatch)    return changeStatus(parseInt(doneMatch[1]),   'done',        null,                   tenantId, tenant);
  if (inProgMatch)  return changeStatus(parseInt(inProgMatch[1]), 'in_progress', null,                   tenantId, tenant);
  if (cancelMatch)  return cancelOrder( parseInt(cancelMatch[1]), cancelMatch[2].trim() || null,         tenantId, tenant);

  return { handled: false, reply: '' };
}

async function findOrder(orderNum: number, tenantId: string, excludeStatuses: string[]): Promise<any | null> {
  const notIn = excludeStatuses.map(() => '?').join(',');
  const sql = `SELECT * FROM shop_orders WHERE tenant_id = ? AND order_number = ? AND status NOT IN (${notIn}) ORDER BY created_at DESC LIMIT 1`;
  return dbGet(sql, tenantId, orderNum, ...excludeStatuses);
}

async function changeStatus(
  orderNum: number,
  newStatus: 'done' | 'in_progress',
  _reason: null,
  tenantId: string,
  tenant: any,
): Promise<StaffCommandResult> {
  const exclude = newStatus === 'done' ? ['done', 'picked_up', 'cancelled'] : ['picked_up', 'cancelled'];
  const order = await findOrder(orderNum, tenantId, exclude);
  if (!order) {
    return { handled: true, reply: `❌ Order #${orderNum} not found or already ${newStatus === 'done' ? 'completed/cancelled' : 'cancelled'}.` };
  }

  const tsCol: Record<string, string> = { done: 'done_at', in_progress: 'in_progress_at' };
  const ts = tsCol[newStatus];
  await dbRun(
    `UPDATE shop_orders SET status = ?, ${ts} = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    newStatus, order.id,
  );

  if (newStatus === 'done' && order.guest_phone) {
    try {
      const cfg = await dbGet(`SELECT shop_name FROM shop_config WHERE tenant_id = ?`, tenantId);
      const shopName = cfg?.shop_name || tenant?.name || 'our shop';
      const msg = `✅ Your order #${order.order_number} from ${shopName} is ready for pickup! Please come to the counter.`;
      await sendWhatsAppMessage(order.guest_phone, msg, tenant);
    } catch (e: any) {
      console.error('[Staff cmd] Customer ready notify failed:', e.message);
    }
  }

  const label = newStatus === 'done' ? 'ready ✅' : 'in progress 🔄';
  return { handled: true, reply: `✅ Order #${orderNum} marked ${label}.` };
}

async function cancelOrder(
  orderNum: number,
  reason: string | null,
  tenantId: string,
  tenant: any,
): Promise<StaffCommandResult> {
  const order = await findOrder(orderNum, tenantId, ['cancelled', 'done']);
  if (!order) {
    return { handled: true, reply: `❌ Order #${orderNum} not found or already cancelled/done.` };
  }

  // Update status + reason
  await dbRun(
    `UPDATE shop_orders SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    reason || null, order.id,
  );

  // Restore stock
  try {
    const orderItems = await dbAll(`SELECT item_id, quantity FROM shop_order_items WHERE order_id = ?`, order.id);
    for (const oi of orderItems) {
      const restoreSql = isPg
        ? `UPDATE shop_menu_items SET stock_used = GREATEST(0, stock_used - ?) WHERE id = ? AND stock_type != 'unlimited'`
        : `UPDATE shop_menu_items SET stock_used = max(0, stock_used - ?) WHERE id = ? AND stock_type != 'unlimited'`;
      await dbRun(restoreSql, oi.quantity, oi.item_id);
    }
  } catch (e: any) {
    console.error('[Staff cmd] Stock restore failed:', e.message);
  }

  // Restore recipe inventory (fire-and-forget)
  try {
    const { isInventoryEnabled, restoreIngredientsForOrder } = await import('../services/inventory.js');
    if (await isInventoryEnabled(tenantId)) {
      restoreIngredientsForOrder(order.id, tenantId).catch(
        (e: any) => console.error('[Staff cmd] Inventory restore failed:', e.message),
      );
    }
  } catch { /* ignore if inventory module unavailable */ }

  // Staff confirmation
  const staffReply = reason
    ? `✅ Order #${orderNum} cancelled. Reason: ${reason}`
    : `✅ Order #${orderNum} cancelled.`;

  // Proactive customer message
  if (order.guest_phone) {
    const customerMsg = reason
      ? `We're sorry to inform you that your order #${order.order_number} has been cancelled.\nReason: ${reason}.\nPlease come to our stand for more details.\nWe apologize for the inconvenience. 🙏`
      : `We're sorry to inform you that your order #${order.order_number} has been cancelled.\nPlease come to our stand for more details.\nWe apologize for the inconvenience. 🙏`;

    try {
      await sendWhatsAppMessage(order.guest_phone, customerMsg, tenant);
      console.log(`[Staff cmd] Cancel message sent to customer ${order.guest_phone}`);
    } catch (e: any) {
      console.error('[Staff cmd] Customer cancel notify failed:', e.message);
    }

    // Log the cancel message in the customer's conversation
    try {
      const conv = await dbGet(
        `SELECT id, messages FROM shop_conversations WHERE tenant_id = ? AND guest_phone = ?`,
        tenantId, order.guest_phone,
      );
      if (conv) {
        let msgs: any[] = [];
        try { msgs = JSON.parse(conv.messages || '[]'); } catch { msgs = []; }
        msgs.push({ role: 'assistant', content: customerMsg });
        await dbRun(
          `UPDATE shop_conversations SET messages = ?, updated_at = ? WHERE id = ?`,
          JSON.stringify(msgs.slice(-40)), new Date().toISOString(), conv.id,
        );
      }
    } catch (e: any) {
      console.error('[Staff cmd] Conv log failed:', e.message);
    }
  }

  return { handled: true, reply: staffReply };
}
