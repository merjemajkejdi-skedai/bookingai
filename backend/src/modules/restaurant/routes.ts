import { Router, Request, Response } from 'express';
import { isPg, prepare, query, queryOne, queryRun } from '../../db/database.js';
import { requireAuth, resolveTenantId } from '../../middleware/auth.js';

export const restaurantRouter = Router();

const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, status = 400) =>
  res.status(status).json({ success: false, error: msg });

async function dbAll(sql: string, ...params: unknown[]) {
  return isPg ? query(sql, params) : prepare(sql).all(...params);
}
async function dbGet(sql: string, ...params: unknown[]) {
  return isPg ? queryOne(sql, params) : prepare(sql).get(...params);
}
async function dbRun(sql: string, ...params: unknown[]) {
  if (isPg) return queryRun(sql, params);
  prepare(sql).run(...params);
}

// ── ZONES ─────────────────────────────────────────────────────────────────────

restaurantRouter.get('/restaurant/zones', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const zones = await dbAll(
      `SELECT z.*, COUNT(t.id) AS table_count
       FROM restaurant_zones z
       LEFT JOIN restaurant_tables t ON t.zone_id = z.id AND t.is_active = 1
       WHERE z.tenant_id = ? AND z.is_active = 1
       GROUP BY z.id, z.tenant_id, z.name, z.description, z.color, z.max_concurrent, z.is_active, z.created_at
       ORDER BY z.created_at ASC`,
      tenantId
    ) as any[];
    ok(res, zones.map(r => ({
      id: r.id, tenantId: r.tenant_id,
      name: r.name, description: r.description,
      color: r.color, maxConcurrent: Number(r.max_concurrent),
      isVip: !!r.is_vip,
      tableCount: Number(r.table_count),
      isActive: !!r.is_active, createdAt: r.created_at,
    })));
  } catch (e: any) { err(res, e.message, 500); }
});

restaurantRouter.post('/restaurant/zones', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, description = '', color = '#6366f1', maxConcurrent = 10, isVip = false } = req.body;
  if (!name?.trim()) return err(res, 'name is required');
  const id = crypto.randomUUID();
  try {
    await dbRun(
      'INSERT INTO restaurant_zones(id,tenant_id,name,description,color,max_concurrent,is_vip) VALUES(?,?,?,?,?,?,?)',
      id, tenantId, name.trim(), description, color, maxConcurrent, isVip ? 1 : 0
    );
    const row = await dbGet('SELECT * FROM restaurant_zones WHERE id=?', id) as any;
    ok(res, { id: row.id, tenantId: row.tenant_id, name: row.name, description: row.description, color: row.color, maxConcurrent: Number(row.max_concurrent), isVip: !!row.is_vip, tableCount: 0, isActive: true, createdAt: row.created_at });
  } catch (e: any) { err(res, e.message, 500); }
});

restaurantRouter.put('/restaurant/zones/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { id } = req.params;
  const { name, description, color, maxConcurrent, isVip } = req.body;
  const existing = await dbGet('SELECT id FROM restaurant_zones WHERE id=? AND tenant_id=?', id, tenantId) as any;
  if (!existing) return err(res, 'Zone not found', 404);
  try {
    await dbRun(
      'UPDATE restaurant_zones SET name=COALESCE(?,name), description=COALESCE(?,description), color=COALESCE(?,color), max_concurrent=COALESCE(?,max_concurrent), is_vip=COALESCE(?,is_vip) WHERE id=?',
      name ?? null, description ?? null, color ?? null, maxConcurrent ?? null, isVip != null ? (isVip ? 1 : 0) : null, id
    );
    const row = await dbGet(
      `SELECT z.*, COUNT(t.id) AS table_count FROM restaurant_zones z
       LEFT JOIN restaurant_tables t ON t.zone_id = z.id AND t.is_active = 1
       WHERE z.id=? GROUP BY z.id, z.tenant_id, z.name, z.description, z.color, z.max_concurrent, z.is_vip, z.is_active, z.created_at`, id
    ) as any;
    ok(res, { id: row.id, tenantId: row.tenant_id, name: row.name, description: row.description, color: row.color, maxConcurrent: Number(row.max_concurrent), isVip: !!row.is_vip, tableCount: Number(row.table_count), isActive: true, createdAt: row.created_at });
  } catch (e: any) { err(res, e.message, 500); }
});

restaurantRouter.delete('/restaurant/zones/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { id } = req.params;
  const existing = await dbGet('SELECT id FROM restaurant_zones WHERE id=? AND tenant_id=?', id, tenantId) as any;
  if (!existing) return err(res, 'Zone not found', 404);
  try {
    await dbRun('UPDATE restaurant_zones SET is_active=0 WHERE id=?', id);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ── TABLES ────────────────────────────────────────────────────────────────────

restaurantRouter.get('/restaurant/zones/:zoneId/tables', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { zoneId } = req.params;
  try {
    const rows = await dbAll(
      'SELECT * FROM restaurant_tables WHERE zone_id=? AND tenant_id=? AND is_active=1 ORDER BY name ASC',
      zoneId, tenantId
    ) as any[];
    ok(res, rows.map(r => ({ id: r.id, tenantId: r.tenant_id, zoneId: r.zone_id, name: r.name, seats: Number(r.seats), isActive: !!r.is_active, createdAt: r.created_at })));
  } catch (e: any) { err(res, e.message, 500); }
});

restaurantRouter.post('/restaurant/zones/:zoneId/tables', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { zoneId } = req.params;
  const { name, seats = 4 } = req.body;
  if (!name?.trim()) return err(res, 'name is required');
  const zone = await dbGet('SELECT id FROM restaurant_zones WHERE id=? AND tenant_id=?', zoneId, tenantId) as any;
  if (!zone) return err(res, 'Zone not found', 404);
  const id = crypto.randomUUID();
  try {
    await dbRun('INSERT INTO restaurant_tables(id,tenant_id,zone_id,name,seats) VALUES(?,?,?,?,?)', id, tenantId, zoneId, name.trim(), seats);
    const row = await dbGet('SELECT * FROM restaurant_tables WHERE id=?', id) as any;
    ok(res, { id: row.id, tenantId: row.tenant_id, zoneId: row.zone_id, name: row.name, seats: Number(row.seats), isActive: true, createdAt: row.created_at });
  } catch (e: any) { err(res, e.message, 500); }
});

restaurantRouter.put('/restaurant/tables/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { id } = req.params;
  const { name, seats } = req.body;
  const existing = await dbGet('SELECT id FROM restaurant_tables WHERE id=? AND tenant_id=?', id, tenantId) as any;
  if (!existing) return err(res, 'Table not found', 404);
  try {
    await dbRun('UPDATE restaurant_tables SET name=COALESCE(?,name), seats=COALESCE(?,seats) WHERE id=?', name ?? null, seats ?? null, id);
    const row = await dbGet('SELECT * FROM restaurant_tables WHERE id=?', id) as any;
    ok(res, { id: row.id, tenantId: row.tenant_id, zoneId: row.zone_id, name: row.name, seats: Number(row.seats), isActive: true, createdAt: row.created_at });
  } catch (e: any) { err(res, e.message, 500); }
});

restaurantRouter.delete('/restaurant/tables/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { id } = req.params;
  const existing = await dbGet('SELECT id FROM restaurant_tables WHERE id=? AND tenant_id=?', id, tenantId) as any;
  if (!existing) return err(res, 'Table not found', 404);
  try {
    await dbRun('UPDATE restaurant_tables SET is_active=0 WHERE id=?', id);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ── RESERVATIONS ──────────────────────────────────────────────────────────────

restaurantRouter.get('/restaurant/reservations', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { date, from, to } = req.query as Record<string, string>;
  let sql = `
    SELECT r.*, z.name AS zone_name, z.color AS zone_color,
           t.name AS table_name, t.seats AS table_seats
    FROM restaurant_reservations r
    LEFT JOIN restaurant_zones z ON z.id = r.zone_id
    LEFT JOIN restaurant_tables t ON t.id = r.table_id
    WHERE r.tenant_id = ? AND r.status != 'cancelled'
  `;
  const params: unknown[] = [tenantId];
  if (date)  { sql += ' AND r.date = ?';    params.push(date); }
  if (from)  { sql += ' AND r.date >= ?';   params.push(from); }
  if (to)    { sql += ' AND r.date <= ?';   params.push(to); }
  sql += ' ORDER BY r.date ASC, r.time ASC';
  try {
    const rows = await dbAll(sql, ...params) as any[];
    ok(res, rows.map(r => ({
      id: r.id, tenantId: r.tenant_id,
      zoneId: r.zone_id, zoneName: r.zone_name, zoneColor: r.zone_color,
      tableId: r.table_id ?? null, tableName: r.table_name ?? null, tableSeats: r.table_seats ? Number(r.table_seats) : null,
      guestName: r.guest_name, guestPhone: r.guest_phone,
      guestCount: Number(r.guest_count),
      date: r.date, time: r.time,
      durationMins: Number(r.duration_mins),
      notes: r.notes, status: r.status,
      createdAt: r.created_at,
    })));
  } catch (e: any) { err(res, e.message, 500); }
});

restaurantRouter.post('/restaurant/reservations', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { zoneId, tableId, guestName, guestPhone = '', guestCount = 2, date, time, durationMins = 90, notes = '' } = req.body;
  if (!guestName?.trim()) return err(res, 'guestName is required');
  if (!zoneId)            return err(res, 'zoneId is required');
  if (!date || !time)     return err(res, 'date and time are required');

  // Check zone max_concurrent limit
  const zone = await dbGet('SELECT * FROM restaurant_zones WHERE id=? AND tenant_id=?', zoneId, tenantId) as any;
  if (!zone) return err(res, 'Zone not found', 404);

  // Count overlapping confirmed reservations in this zone
  const [startH, startM] = time.split(':').map(Number);
  const startMins = startH * 60 + startM;
  const endMins   = startMins + Number(durationMins);

  const existing = await dbAll(
    `SELECT time, duration_mins FROM restaurant_reservations
     WHERE tenant_id=? AND zone_id=? AND date=? AND status='confirmed'`,
    tenantId, zoneId, date
  ) as any[];

  const overlapping = existing.filter((r: any) => {
    const [rH, rM] = r.time.split(':').map(Number);
    const rStart = rH * 60 + rM;
    const rEnd   = rStart + Number(r.duration_mins);
    return startMins < rEnd && endMins > rStart;
  });

  if (overlapping.length >= zone.max_concurrent) {
    return err(res, `Zone "${zone.name}" is fully booked at this time (max ${zone.max_concurrent} concurrent reservations)`);
  }

  const id = crypto.randomUUID();
  try {
    await dbRun(
      'INSERT INTO restaurant_reservations(id,tenant_id,zone_id,table_id,guest_name,guest_phone,guest_count,date,time,duration_mins,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      id, tenantId, zoneId, tableId ?? null, guestName.trim(), guestPhone, Number(guestCount), date, time, Number(durationMins), notes
    );
    const row = await dbGet(
      `SELECT r.*, z.name AS zone_name, z.color AS zone_color, t.name AS table_name, t.seats AS table_seats
       FROM restaurant_reservations r
       LEFT JOIN restaurant_zones z ON z.id = r.zone_id
       LEFT JOIN restaurant_tables t ON t.id = r.table_id
       WHERE r.id=?`, id
    ) as any;
    ok(res, {
      id: row.id, tenantId: row.tenant_id,
      zoneId: row.zone_id, zoneName: row.zone_name, zoneColor: row.zone_color,
      tableId: row.table_id ?? null, tableName: row.table_name ?? null, tableSeats: row.table_seats ? Number(row.table_seats) : null,
      guestName: row.guest_name, guestPhone: row.guest_phone,
      guestCount: Number(row.guest_count),
      date: row.date, time: row.time, durationMins: Number(row.duration_mins),
      notes: row.notes, status: row.status, createdAt: row.created_at,
    });
  } catch (e: any) { err(res, e.message, 500); }
});

restaurantRouter.put('/restaurant/reservations/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { id } = req.params;
  const existing = await dbGet('SELECT id FROM restaurant_reservations WHERE id=? AND tenant_id=?', id, tenantId) as any;
  if (!existing) return err(res, 'Reservation not found', 404);
  const { zoneId, tableId, guestName, guestPhone, guestCount, date, time, durationMins, notes, status } = req.body;
  try {
    await dbRun(
      `UPDATE restaurant_reservations SET
         zone_id=COALESCE(?,zone_id), table_id=COALESCE(?,table_id),
         guest_name=COALESCE(?,guest_name), guest_phone=COALESCE(?,guest_phone),
         guest_count=COALESCE(?,guest_count), date=COALESCE(?,date), time=COALESCE(?,time),
         duration_mins=COALESCE(?,duration_mins), notes=COALESCE(?,notes), status=COALESCE(?,status)
       WHERE id=?`,
      zoneId ?? null, tableId ?? null, guestName ?? null, guestPhone ?? null,
      guestCount ?? null, date ?? null, time ?? null, durationMins ?? null, notes ?? null, status ?? null, id
    );
    const row = await dbGet(
      `SELECT r.*, z.name AS zone_name, z.color AS zone_color, t.name AS table_name, t.seats AS table_seats
       FROM restaurant_reservations r
       LEFT JOIN restaurant_zones z ON z.id = r.zone_id
       LEFT JOIN restaurant_tables t ON t.id = r.table_id
       WHERE r.id=?`, id
    ) as any;
    ok(res, {
      id: row.id, tenantId: row.tenant_id,
      zoneId: row.zone_id, zoneName: row.zone_name, zoneColor: row.zone_color,
      tableId: row.table_id ?? null, tableName: row.table_name ?? null,
      guestName: row.guest_name, guestPhone: row.guest_phone,
      guestCount: Number(row.guest_count),
      date: row.date, time: row.time, durationMins: Number(row.duration_mins),
      notes: row.notes, status: row.status, createdAt: row.created_at,
    });
  } catch (e: any) { err(res, e.message, 500); }
});

restaurantRouter.delete('/restaurant/reservations/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { id } = req.params;
  const existing = await dbGet('SELECT id FROM restaurant_reservations WHERE id=? AND tenant_id=?', id, tenantId) as any;
  if (!existing) return err(res, 'Reservation not found', 404);
  try {
    await dbRun("UPDATE restaurant_reservations SET status='cancelled' WHERE id=?", id);
    ok(res, { cancelled: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ── AVAILABILITY ──────────────────────────────────────────────────────────────
restaurantRouter.get('/restaurant/availability', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { date, time, durationMins = '90' } = req.query as Record<string, string>;
  if (!date || !time) return err(res, 'date and time are required');

  const [startH, startM] = time.split(':').map(Number);
  const startMins = startH * 60 + startM;
  const endMins   = startMins + Number(durationMins);

  try {
    const zones = await dbAll(
      'SELECT * FROM restaurant_zones WHERE tenant_id=? AND is_active=1', tenantId
    ) as any[];

    const existing = await dbAll(
      `SELECT zone_id, time, duration_mins FROM restaurant_reservations
       WHERE tenant_id=? AND date=? AND status='confirmed'`,
      tenantId, date
    ) as any[];

    const result = zones.map((z: any) => {
      const zoneRes = existing.filter((r: any) => r.zone_id === z.id);
      const overlapping = zoneRes.filter((r: any) => {
        const [rH, rM] = r.time.split(':').map(Number);
        const rStart = rH * 60 + rM;
        const rEnd   = rStart + Number(r.duration_mins);
        return startMins < rEnd && endMins > rStart;
      });
      return {
        zoneId: z.id, zoneName: z.name, zoneColor: z.color,
        maxConcurrent: Number(z.max_concurrent),
        currentCount: overlapping.length,
        available: overlapping.length < Number(z.max_concurrent),
      };
    });

    ok(res, result);
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// Config (location + menu URL)
// ---------------------------------------------------------------------------

restaurantRouter.get('/restaurant/config', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const row = await dbGet('SELECT * FROM restaurant_config WHERE tenant_id = ?', tenantId);
    ok(res, row || {});
  } catch (e: any) { err(res, e.message, 500); }
});

restaurantRouter.put('/restaurant/config', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { location_url = null, menu_url = null } = req.body;
  try {
    await dbRun(
      `INSERT INTO restaurant_config (tenant_id, location_url, menu_url)
       VALUES (?, ?, ?)
       ON CONFLICT (tenant_id) DO UPDATE SET
         location_url = excluded.location_url,
         menu_url     = excluded.menu_url`,
      tenantId, location_url, menu_url,
    );
    const row = await dbGet('SELECT * FROM restaurant_config WHERE tenant_id = ?', tenantId);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});
