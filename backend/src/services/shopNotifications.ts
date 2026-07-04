import { isPg, prepare, queryOne, queryRun } from '../db/database.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';

async function dbGet(sql: string, ...p: unknown[]) { return (isPg ? queryOne(sql, p) : prepare(sql).get(...p)) as any; }

export async function sendStaffOrderNotification(tenantId: string, orderId: string): Promise<void> {
  const config = await dbGet(`SELECT staff_notify_enabled, staff_notify_number FROM shop_config WHERE tenant_id = ?`, tenantId);
  if (!config?.staff_notify_enabled || !config?.staff_notify_number) return;

  const order = await dbGet(`SELECT order_number, total_price, currency, source, pickup_name, table_name FROM shop_orders WHERE id = ?`, orderId);
  if (!order) return;

  const source = order.source === 'qr' ? 'QR' : order.source === 'manual' ? 'Staff' : 'WhatsApp';
  const name   = order.pickup_name || order.table_name || 'Walk-in';
  const total  = `${Number(order.total_price).toFixed(0)} ${order.currency || 'ALL'}`;

  const msg = `🛎️ New order #${order.order_number}\nFrom: ${name} (${source})\nTotal: ${total}`;

  const tenant = await dbGet(`SELECT * FROM tenants WHERE id = ?`, tenantId);
  const to = `whatsapp:${config.staff_notify_number.replace(/\s/g, '')}`;

  await sendWhatsAppMessage(to, msg, tenant);
  console.log(`[Shop notify] Staff notified for order #${order.order_number}`);
}

export async function sendStaffKeepaliveReminder(tenantId: string): Promise<void> {
  const config = await dbGet(`SELECT staff_notify_enabled, staff_notify_number, shop_name FROM shop_config WHERE tenant_id = ?`, tenantId);
  if (!config?.staff_notify_enabled || !config?.staff_notify_number) return;

  const shopName = config.shop_name || 'the shop';
  const msg = `👋 Daily reminder: Reply to this message to keep WhatsApp order notifications active for ${shopName}.`;

  const tenant = await dbGet(`SELECT * FROM tenants WHERE id = ?`, tenantId);
  const to = `whatsapp:${config.staff_notify_number.replace(/\s/g, '')}`;

  await sendWhatsAppMessage(to, msg, tenant);
  console.log(`[Shop notify] Keepalive sent for tenant ${tenantId}`);
}
