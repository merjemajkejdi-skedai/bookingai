import { isPg, query, queryOne, queryRun, prepare } from '../db/database.js';
import crypto from 'crypto';

async function dbAll(sql: string, ...p: unknown[]) { return (isPg ? query(sql, p) : prepare(sql).all(...p)) as any[]; }
async function dbGet(sql: string, ...p: unknown[]) { return (isPg ? queryOne(sql, p) : prepare(sql).get(...p)) as any; }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

export async function isInventoryEnabled(tenantId: string): Promise<boolean> {
  const r = await dbGet('SELECT inventory_enabled FROM shop_config WHERE tenant_id = ?', tenantId);
  return r?.inventory_enabled === true || r?.inventory_enabled === 1;
}

export async function calculateAvailableQty(menuItemId: string, tenantId: string): Promise<number | null> {
  const recipe = await dbGet(
    `SELECT r.id FROM inventory_recipes r
     JOIN shop_menu_items smi ON smi.id = r.menu_item_id
     WHERE r.menu_item_id = ? AND r.tenant_id = ? AND smi.stock_mode = 'recipe'`,
    menuItemId, tenantId,
  );
  if (!recipe) return null;

  const lines = await dbAll(
    `SELECT rl.quantity, i.current_stock
     FROM inventory_recipe_lines rl
     JOIN inventory_ingredients i ON i.id = rl.ingredient_id
     WHERE rl.recipe_id = ?`,
    recipe.id,
  );
  if (lines.length === 0) return null;

  let available = Infinity;
  for (const line of lines) {
    const qty     = parseFloat(line.quantity as any);
    const stock   = parseFloat(line.current_stock as any);
    const canMake = qty > 0 ? Math.floor(stock / qty) : Infinity;
    available = Math.min(available, canMake);
  }
  return available === Infinity ? 0 : available;
}

export async function deductIngredientsForOrder(
  orderId:    string,
  tenantId:   string,
  orderItems: { item_id: string; quantity: number }[],
): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = [];
  for (const orderItem of orderItems) {
    const item = await dbGet(
      'SELECT stock_mode FROM shop_menu_items WHERE id = ? AND tenant_id = ?',
      orderItem.item_id, tenantId,
    );
    if (!item || item.stock_mode !== 'recipe') continue;

    const lines = await dbAll(
      `SELECT rl.ingredient_id, rl.quantity, i.name, i.unit
       FROM inventory_recipes r
       JOIN inventory_recipe_lines rl ON rl.recipe_id = r.id
       JOIN inventory_ingredients i ON i.id = rl.ingredient_id
       WHERE r.menu_item_id = ? AND r.tenant_id = ?`,
      orderItem.item_id, tenantId,
    );

    for (const line of lines) {
      const totalDeduct = parseFloat(line.quantity as any) * orderItem.quantity;
      const deductSql = isPg
        ? 'UPDATE inventory_ingredients SET current_stock = GREATEST(0, current_stock - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?'
        : 'UPDATE inventory_ingredients SET current_stock = MAX(0, current_stock - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?';
      await dbRun(deductSql, totalDeduct, line.ingredient_id, tenantId);
      await dbRun(
        'INSERT INTO inventory_consumption (id, tenant_id, order_id, ingredient_id, ingredient_name, quantity, unit) VALUES (?, ?, ?, ?, ?, ?, ?)',
        crypto.randomUUID(), tenantId, orderId, line.ingredient_id, line.name, totalDeduct, line.unit,
      );
    }
  }
  await checkReorderAlerts(tenantId).catch(err => console.warn('[Inventory] Reorder check failed:', (err as any).message));
  return { success: true, errors };
}

export async function restoreIngredientsForOrder(orderId: string, tenantId: string): Promise<void> {
  const consumption = await dbAll(
    'SELECT ingredient_id, quantity FROM inventory_consumption WHERE order_id = ? AND tenant_id = ?',
    orderId, tenantId,
  );
  for (const row of consumption) {
    await dbRun(
      'UPDATE inventory_ingredients SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?',
      row.quantity, row.ingredient_id, tenantId,
    );
  }
  await dbRun('DELETE FROM inventory_consumption WHERE order_id = ? AND tenant_id = ?', orderId, tenantId);
}

export async function checkReorderAlerts(tenantId: string): Promise<void> {
  const config = await dbGet(
    'SELECT inventory_alert_mode, inventory_alert_whatsapp, fallback_backup_number FROM shop_config WHERE tenant_id = ?',
    tenantId,
  );
  if (!config?.inventory_alert_whatsapp) return;
  if (config.inventory_alert_mode !== 'immediate') return;

  const lowStock = await dbAll(
    `SELECT name, current_stock, reorder_threshold, unit
     FROM inventory_ingredients
     WHERE tenant_id = ? AND is_active = 1 AND reorder_threshold > 0 AND current_stock <= reorder_threshold`,
    tenantId,
  );
  if (lowStock.length === 0) return;

  const ownerWA = config.fallback_backup_number;
  if (!ownerWA) return;

  const lines = lowStock.map((i: any) =>
    `• ${i.name}: ${parseFloat(i.current_stock).toFixed(1)} ${i.unit} remaining`,
  ).join('\n');
  const msg = `⚠️ Low stock alert:\n\n${lines}\n\nPlease reorder.`;
  const { sendWhatsAppMessage } = await import('../whatsapp/twilio.js');
  await sendWhatsAppMessage(ownerWA, msg, { id: tenantId }).catch(
    (err: any) => console.error('[Inventory] Alert send failed:', err.message),
  );
}

export async function sendDailyInventoryDigest(tenantId: string): Promise<void> {
  const config = await dbGet(
    'SELECT inventory_alert_mode, inventory_alert_whatsapp, fallback_backup_number FROM shop_config WHERE tenant_id = ?',
    tenantId,
  );
  if (!config?.inventory_alert_whatsapp) return;
  if (config.inventory_alert_mode !== 'daily') return;

  const lowStock = await dbAll(
    `SELECT name, current_stock, reorder_threshold, unit
     FROM inventory_ingredients
     WHERE tenant_id = ? AND is_active = 1 AND reorder_threshold > 0 AND current_stock <= reorder_threshold
     ORDER BY name ASC`,
    tenantId,
  );
  const ownerWA = config.fallback_backup_number;
  if (!ownerWA || lowStock.length === 0) return;

  const lines = lowStock.map((i: any) =>
    `• ${i.name}: ${parseFloat(i.current_stock).toFixed(1)} ${i.unit}`,
  ).join('\n');
  const msg = `📦 Daily inventory digest\n\nLow stock items:\n${lines}\n\nPlease arrange reorder.`;
  const { sendWhatsAppMessage } = await import('../whatsapp/twilio.js');
  await sendWhatsAppMessage(ownerWA, msg, { id: tenantId }).catch(
    (err: any) => console.error('[Inventory] Digest send failed:', err.message),
  );
}
