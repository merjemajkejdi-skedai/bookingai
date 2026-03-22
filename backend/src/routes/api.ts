import { Router, Request, Response } from 'express';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { addMinutes, addDays, format, parseISO } from 'date-fns';
import { getAvailableSlots, suggestNextSlots, isSlotAvailable } from '../services/availability.js';
import twilio from 'twilio';

async function notifyCustomer(phone: string, message: string): Promise<void> {
  if (!phone || !process.env.TWILIO_ACCOUNT_SID) return;
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886',
      to: `whatsapp:${phone}`, body: message,
    });
  } catch (e: any) { console.error('notify failed:', e.message); }
}

export const router = Router();
const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, status = 400) =>
  res.status(status).json({ success: false, error: msg });

// helper — works on both SQLite and pg
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

// ── SPECIALISTS ──────────────────────────────────────────────────────────────
router.get('/specialists', async (req: Request, res: Response) => {
  const tenantId = req.query.tenantId as string || 'tenant-demo-001';
  let rows: any[];
  if (isPg) {
    rows = await query(`
      SELECT s.*,
        json_agg(json_build_object(
          'id', wh.id, 'dayOfWeek', wh.day_of_week,
          'startTime', wh.start_time, 'endTime', wh.end_time, 'isWorking', wh.is_working
        )) FILTER (WHERE wh.id IS NOT NULL) AS working_hours_json
      FROM specialists s
      LEFT JOIN working_hours wh ON wh.specialist_id = s.id
      WHERE s.tenant_id = $1 AND s.is_active = 1
      GROUP BY s.id ORDER BY s.name
    `, [tenantId]);
  } else {
    rows = prepare(`
      SELECT s.*, json_group_array(json_object(
        'id', wh.id, 'dayOfWeek', wh.day_of_week,
        'startTime', wh.start_time, 'endTime', wh.end_time, 'isWorking', wh.is_working
      )) AS working_hours_json
      FROM specialists s
      LEFT JOIN working_hours wh ON wh.specialist_id = s.id
      WHERE s.tenant_id = ? AND s.is_active = 1
      GROUP BY s.id ORDER BY s.name
    `).all(tenantId);
  }
  const data = rows.map((r: any) => {
    const wh = isPg
      ? (r.working_hours_json || [])
      : JSON.parse(r.working_hours_json || '[]');
    return {
      id: r.id, tenantId: r.tenant_id, name: r.name,
      role: r.role, color: r.color, isActive: !!r.is_active, createdAt: r.created_at,
      workingHours: wh.filter((w: any) => w.id).map((w: any) => ({
        id: w.id, specialistId: r.id, dayOfWeek: w.dayOfWeek,
        startTime: w.startTime, endTime: w.endTime, isWorking: !!w.isWorking,
      })),
    };
  });
  ok(res, data);
});

router.post('/specialists', async (req: Request, res: Response) => {
  const parsed = z.object({
    tenantId: z.string().default('tenant-demo-001'),
    name: z.string().min(1), role: z.string().default('Specialist'),
    color: z.string().default('#6366f1'),
  }).safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);

  const id = uuid();
  await dbRun(
    'INSERT INTO specialists(id,tenant_id,name,role,color,is_active) VALUES (?,?,?,?,?,1)',
    id, parsed.data.tenantId, parsed.data.name, parsed.data.role, parsed.data.color
  );
  for (let day = 0; day <= 6; day++) {
    await dbRun(
      'INSERT INTO working_hours(id,specialist_id,day_of_week,start_time,end_time,is_working) VALUES (?,?,?,?,?,?)',
      uuid(), id, day, '09:00', '19:00', day === 0 ? 0 : 1
    );
  }
  ok(res, await dbGet('SELECT * FROM specialists WHERE id = ?', id));
});

router.put('/specialists/:id', async (req: Request, res: Response) => {
  const parsed = z.object({
    name: z.string().min(1).optional(), role: z.string().optional(),
    color: z.string().optional(), isActive: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);
  const { name, role, color, isActive } = parsed.data;
  await dbRun(
    'UPDATE specialists SET name=COALESCE(?,name),role=COALESCE(?,role),color=COALESCE(?,color),is_active=COALESCE(?,is_active) WHERE id=?',
    name??null, role??null, color??null, isActive !== undefined ? (isActive?1:0) : null, req.params.id
  );
  ok(res, await dbGet('SELECT * FROM specialists WHERE id = ?', req.params.id));
});

router.put('/specialists/:id/working-hours', async (req: Request, res: Response) => {
  const parsed = z.array(z.object({
    dayOfWeek: z.number().min(0).max(6), startTime: z.string(),
    endTime: z.string(), isWorking: z.boolean(),
  })).safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);

  for (const wh of parsed.data) {
    if (isPg) {
      await queryRun(`
        INSERT INTO working_hours(id,specialist_id,day_of_week,start_time,end_time,is_working)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT(specialist_id,day_of_week)
        DO UPDATE SET start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,is_working=EXCLUDED.is_working
      `, [uuid(), req.params.id, wh.dayOfWeek, wh.startTime, wh.endTime, wh.isWorking?1:0]);
    } else {
      prepare(`INSERT INTO working_hours(id,specialist_id,day_of_week,start_time,end_time,is_working)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(specialist_id,day_of_week)
        DO UPDATE SET start_time=excluded.start_time,end_time=excluded.end_time,is_working=excluded.is_working`)
        .run(uuid(), req.params.id, wh.dayOfWeek, wh.startTime, wh.endTime, wh.isWorking?1:0);
    }
  }
  ok(res, await dbAll('SELECT * FROM working_hours WHERE specialist_id=? ORDER BY day_of_week', req.params.id));
});

// ── SERVICES ─────────────────────────────────────────────────────────────────
router.get('/services', async (req: Request, res: Response) => {
  const tenantId = req.query.tenantId as string || 'tenant-demo-001';
  const rows = await dbAll('SELECT * FROM services WHERE tenant_id=? AND is_active=1 ORDER BY name', tenantId);
  ok(res, rows.map((r: any) => ({
    id: r.id, tenantId: r.tenant_id, name: r.name,
    durationMins: r.duration_mins, price: r.price,
    color: r.color, isActive: !!r.is_active,
  })));
});

router.post('/services', async (req: Request, res: Response) => {
  const parsed = z.object({
    tenantId: z.string().default('tenant-demo-001'),
    name: z.string().min(1), durationMins: z.number().min(5).max(480),
    price: z.number().min(0), color: z.string().default('#8b5cf6'),
  }).safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);

  const id = uuid();
  await dbRun(
    'INSERT INTO services(id,tenant_id,name,duration_mins,price,color,is_active) VALUES (?,?,?,?,?,?,1)',
    id, parsed.data.tenantId, parsed.data.name, parsed.data.durationMins, parsed.data.price, parsed.data.color
  );
  ok(res, await dbGet('SELECT * FROM services WHERE id=?', id));
});

router.put('/services/:id', async (req: Request, res: Response) => {
  const parsed = z.object({
    name: z.string().optional(), durationMins: z.number().optional(),
    price: z.number().optional(), color: z.string().optional(), isActive: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);
  const { name, durationMins, price, color, isActive } = parsed.data;
  await dbRun(
    'UPDATE services SET name=COALESCE(?,name),duration_mins=COALESCE(?,duration_mins),price=COALESCE(?,price),color=COALESCE(?,color),is_active=COALESCE(?,is_active) WHERE id=?',
    name??null, durationMins??null, price??null, color??null,
    isActive !== undefined ? (isActive?1:0) : null, req.params.id
  );
  ok(res, await dbGet('SELECT * FROM services WHERE id=?', req.params.id));
});

router.delete('/services/:id', async (req: Request, res: Response) => {
  await dbRun('UPDATE services SET is_active=0 WHERE id=?', req.params.id);
  ok(res, { id: req.params.id });
});

// ── BOOKINGS ─────────────────────────────────────────────────────────────────
router.get('/bookings', async (req: Request, res: Response) => {
  const { tenantId = 'tenant-demo-001', start, end, specialistId } = req.query as Record<string,string>;
  let sql = `
    SELECT b.*, s.name AS specialist_name, s.color AS specialist_color,
      sv.name AS service_name, sv.duration_mins AS service_duration_mins, sv.price AS service_price
    FROM bookings b
    JOIN specialists s ON s.id = b.specialist_id
    JOIN services sv ON sv.id = b.service_id
    WHERE b.tenant_id = ?
  `;
  const params: unknown[] = [tenantId];
  if (start)        { sql += ' AND b.starts_at >= ?'; params.push(start); }
  if (end)          { sql += ' AND b.starts_at <= ?';  params.push(end); }
  if (specialistId) { sql += ' AND b.specialist_id = ?'; params.push(specialistId); }
  sql += ' ORDER BY b.starts_at';

  const rows = await dbAll(sql, ...params);
  ok(res, rows.map((r: any) => ({
    id: r.id, tenantId: r.tenant_id,
    specialistId: r.specialist_id, specialistName: r.specialist_name, specialistColor: r.specialist_color,
    serviceId: r.service_id, serviceName: r.service_name,
    serviceDurationMins: r.service_duration_mins, servicePrice: r.service_price,
    customerName: r.customer_name, customerPhone: r.customer_phone,
    startsAt: r.starts_at?.slice(0,19), endsAt: r.ends_at?.slice(0,19),
    status: r.status, notes: r.notes, createdAt: r.created_at,
    recurrenceRule: r.recurrence_rule || 'none',
    recurrenceGroupId: r.recurrence_group_id || null,
  })));
});

router.post('/bookings', async (req: Request, res: Response) => {
  const parsed = z.object({
    tenantId: z.string().default('tenant-demo-001'),
    specialistId: z.string(), serviceId: z.string(),
    customerName: z.string().min(1), customerPhone: z.string().default(''),
    startsAt: z.string(), notes: z.string().default(''),
    recurrence: z.enum(['none','weekly','biweekly','3weekly','4weekly']).default('none'),
  }).safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);

  const svc = await dbGet('SELECT duration_mins FROM services WHERE id=?', parsed.data.serviceId) as any;
  if (!svc) return err(res, 'Service not found', 404);

  // Check first slot is available
  if (!await isSlotAvailable(parsed.data.specialistId, parsed.data.startsAt, svc.duration_mins)) {
    const suggestions = await suggestNextSlots(parsed.data.specialistId, parsed.data.startsAt, svc.duration_mins, 3);
    return res.status(409).json({ success: false, error: 'Slot not available', suggestions });
  }

  // Calculate interval in days
  const intervalDays: Record<string, number> = {
    none: 0, weekly: 7, biweekly: 14, '3weekly': 21, '4weekly': 28
  };
  const interval = intervalDays[parsed.data.recurrence] ?? 0;
  const occurrences = interval > 0 ? 12 : 1; // up to 12 weeks ahead
  const groupId = interval > 0 ? uuid() : null;

  const createdIds: string[] = [];

  for (let i = 0; i < occurrences; i++) {
    const startsAt = format(
      addDays(parseISO(parsed.data.startsAt), i * interval),
      "yyyy-MM-dd'T'HH:mm:ss"
    );
    const endsAt = format(addMinutes(parseISO(startsAt), svc.duration_mins), "yyyy-MM-dd'T'HH:mm:ss");

    // Skip if slot not available (for recurring, skip conflicts silently)
    if (i > 0 && !await isSlotAvailable(parsed.data.specialistId, startsAt, svc.duration_mins)) {
      continue;
    }

    const id = uuid();
    await dbRun(
      'INSERT INTO bookings(id,tenant_id,specialist_id,service_id,customer_name,customer_phone,starts_at,ends_at,status,notes,recurrence_rule,recurrence_group_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      id, parsed.data.tenantId, parsed.data.specialistId, parsed.data.serviceId,
      parsed.data.customerName, parsed.data.customerPhone,
      startsAt, endsAt, 'confirmed', parsed.data.notes,
      parsed.data.recurrence, groupId
    );
    createdIds.push(id);
  }

  if (!createdIds.length) return err(res, 'Could not create any bookings — all slots unavailable');

  // Return the first booking
  const booking = await dbGet(`
    SELECT b.*, s.name AS specialist_name, s.color AS specialist_color, sv.name AS service_name
    FROM bookings b
    JOIN specialists s ON s.id = b.specialist_id
    JOIN services sv ON sv.id = b.service_id
    WHERE b.id = ?
  `, createdIds[0]) as any;

  ok(res, {
    ...booking,
    specialistName: booking.specialist_name,
    specialistColor: booking.specialist_color,
    serviceName: booking.service_name,
    recurrenceCount: createdIds.length,
    recurrenceGroupId: groupId,
  });
});

router.put('/bookings/:id', async (req: Request, res: Response) => {
  const parsed = z.object({
    status: z.enum(['confirmed','cancelled','completed','no_show']).optional(),
    notes: z.string().optional(), startsAt: z.string().optional(),
    specialistId: z.string().optional(), serviceId: z.string().optional(),
    reason: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);

  const { status, notes, startsAt, serviceId, reason } = parsed.data;
  let endsAt: string | null = null;
  if (startsAt && serviceId) {
    const svc = await dbGet('SELECT duration_mins FROM services WHERE id=?', serviceId) as any;
    endsAt = format(addMinutes(parseISO(startsAt), svc.duration_mins), "yyyy-MM-dd'T'HH:mm:ss");
  }

  await dbRun(
    'UPDATE bookings SET status=COALESCE(?,status),notes=COALESCE(?,notes),starts_at=COALESCE(?,starts_at),ends_at=COALESCE(?,ends_at),service_id=COALESCE(?,service_id),specialist_id=COALESCE(?,specialist_id) WHERE id=?',
    status??null, notes??null, startsAt??null, endsAt,
    parsed.data.serviceId??null, parsed.data.specialistId??null, req.params.id
  );

  const updated = await dbGet(`
    SELECT b.*, s.name AS specialist_name, sv.name AS service_name
    FROM bookings b JOIN specialists s ON s.id=b.specialist_id JOIN services sv ON sv.id=b.service_id
    WHERE b.id=?
  `, req.params.id) as any;

  if (status === 'cancelled' && updated?.customer_phone) {
    const dateStr = format(parseISO(updated.starts_at.slice(0,19)), 'EEEE d MMMM');
    const timeStr = format(parseISO(updated.starts_at.slice(0,19)), 'HH:mm');
    const reasonPart = reason ? `\nReason: ${reason}` : '';
    const msg = `Hi ${updated.customer_name}, your ${updated.service_name} appointment with ${updated.specialist_name} on ${dateStr} at ${timeStr} has been cancelled.${reasonPart} We apologise for any inconvenience. Please contact us to rebook.`;
    notifyCustomer(updated.customer_phone, msg);
  }
  if (startsAt && status !== 'cancelled' && updated?.customer_phone) {
    const newDateStr = format(parseISO(updated.starts_at.slice(0,19)), 'EEEE d MMMM');
    const newTimeStr = format(parseISO(updated.starts_at.slice(0,19)), 'HH:mm');
    const msg = `Hi ${updated.customer_name}, your ${updated.service_name} appointment with ${updated.specialist_name} has been rescheduled to ${newDateStr} at ${newTimeStr}. See you then!`;
    notifyCustomer(updated.customer_phone, msg);
  }
  ok(res, updated);
});

router.delete('/bookings/:id', async (req: Request, res: Response) => {
  const { reason } = req.body as { reason?: string };
  const booking = await dbGet(`
    SELECT b.*, s.name AS specialist_name, sv.name AS service_name
    FROM bookings b JOIN specialists s ON s.id=b.specialist_id JOIN services sv ON sv.id=b.service_id
    WHERE b.id=?
  `, req.params.id) as any;
  if (!booking) return err(res, 'Booking not found', 404);

  await dbRun("UPDATE bookings SET status='cancelled' WHERE id=?", req.params.id);

  if (booking.customer_phone) {
    const dateStr = format(parseISO(booking.starts_at.slice(0,19)), 'EEEE d MMMM');
    const timeStr = format(parseISO(booking.starts_at.slice(0,19)), 'HH:mm');
    const reasonPart = reason ? `\nReason: ${reason}` : '';
    const msg = `Hi ${booking.customer_name}, your ${booking.service_name} appointment with ${booking.specialist_name} on ${dateStr} at ${timeStr} has been cancelled.${reasonPart} We apologise for any inconvenience. Please contact us to rebook.`;
    notifyCustomer(booking.customer_phone, msg);
  }
  ok(res, { id: req.params.id });
});

// ── CANCEL RECURRING SERIES ──────────────────────────────────────────────────
router.delete('/bookings/:id/series', async (req: Request, res: Response) => {
  const { reason } = req.body as { reason?: string };

  // Get the booking to find its group
  const booking = await dbGet(`
    SELECT b.*, s.name AS specialist_name, sv.name AS service_name
    FROM bookings b
    JOIN specialists s ON s.id = b.specialist_id
    JOIN services sv ON sv.id = b.service_id
    WHERE b.id = ?
  `, req.params.id) as any;

  if (!booking) return err(res, 'Booking not found', 404);
  if (!booking.recurrence_group_id) return err(res, 'This booking is not part of a series', 400);

  // Cancel all future bookings in the group (including this one)
  const now = format(new Date(), "yyyy-MM-dd'T'HH:mm:ss");
  await dbRun(
    "UPDATE bookings SET status='cancelled' WHERE recurrence_group_id=? AND starts_at >= ? AND status='confirmed'",
    booking.recurrence_group_id, now
  );

  const cancelledCount = (await dbAll(
    "SELECT id FROM bookings WHERE recurrence_group_id=? AND status='cancelled'",
    booking.recurrence_group_id
  )).length;

  // Notify customer if they have a phone
  if (booking.customer_phone) {
    const reasonPart = reason ? `\nReason: ${reason}` : '';
    const msg = `Hi ${booking.customer_name}, your recurring ${booking.service_name} appointments with ${booking.specialist_name} have been cancelled.${reasonPart} We apologise for any inconvenience.`;
    notifyCustomer(booking.customer_phone, msg);
  }

  ok(res, { cancelled: cancelledCount, groupId: booking.recurrence_group_id });
});

// ── AVAILABILITY ─────────────────────────────────────────────────────────────
router.get('/availability', async (req: Request, res: Response) => {
  const { specialistId, date, durationMins } = req.query as Record<string,string>;
  if (!specialistId || !date || !durationMins)
    return err(res, 'specialistId, date and durationMins are required');
  ok(res, { date, specialistId, slots: await getAvailableSlots(specialistId, date, parseInt(durationMins)) });
});

router.get('/availability/suggest', async (req: Request, res: Response) => {
  const { specialistId, fromDate, durationMins, count } = req.query as Record<string,string>;
  if (!specialistId || !fromDate || !durationMins)
    return err(res, 'specialistId, fromDate and durationMins are required');
  ok(res, await suggestNextSlots(specialistId, fromDate, parseInt(durationMins), parseInt(count||'3')));
});
