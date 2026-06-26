import { isPg, query, queryOne, prepare } from '../db/database.js';

async function dbGet(sql: string, ...p: unknown[]) { return (isPg ? queryOne(sql, p) : prepare(sql).get(...p)) as any; }

export async function getCurrentDeliveryTime(tenantId: string): Promise<{
  minutes:       number;
  tier:          1 | 2 | 3;
  active_orders: number;
  label:         string;
}> {
  const countRow = await dbGet(
    `SELECT COUNT(*) AS active FROM shop_orders WHERE tenant_id = ? AND status IN ('new', 'in_progress')`,
    tenantId,
  );
  const activeOrders = parseInt(String(countRow?.active ?? '0'), 10);

  const cfg = await dbGet(
    `SELECT estimated_pickup_minutes,
            delivery_threshold_1, delivery_threshold_2,
            delivery_time_1, delivery_time_2, delivery_time_3
     FROM shop_config WHERE tenant_id = ?`,
    tenantId,
  );

  if (!cfg) return { minutes: 15, tier: 1, active_orders: activeOrders, label: '15 minutes' };

  const t1 = cfg.delivery_threshold_1 ?? 5;
  const t2 = cfg.delivery_threshold_2 ?? 15;
  const m1 = cfg.delivery_time_1 ?? cfg.estimated_pickup_minutes ?? 15;
  const m2 = cfg.delivery_time_2 ?? cfg.estimated_pickup_minutes ?? 30;
  const m3 = cfg.delivery_time_3 ?? cfg.estimated_pickup_minutes ?? 45;

  let minutes: number;
  let tier: 1 | 2 | 3;

  if (activeOrders < t1) {
    minutes = m1; tier = 1;
  } else if (activeOrders < t2) {
    minutes = m2; tier = 2;
  } else {
    minutes = m3; tier = 3;
  }

  const label = minutes < 60
    ? `${minutes} minutes`
    : minutes === 60
    ? '1 hour'
    : `${Math.round(minutes / 60 * 10) / 10} hours`;

  return { minutes, tier, active_orders: activeOrders, label };
}
