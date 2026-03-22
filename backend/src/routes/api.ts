import { Router, Request, Response } from 'express';
import { prepare, exec as dbExec, runMigrations } from '../db/database.js';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { addMinutes, format, parseISO } from 'date-fns';
import { getAvailableSlots, suggestNextSlots, isSlotAvailable } from '../services/availability.js';
import twilio from 'twilio';

// Send a WhatsApp notification to a customer
async function notifyCustomer(phone: string, message: string): Promise<void> {
  if (!phone || !process.env.TWILIO_ACCOUNT_SID) return;
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886',
      to: `whatsapp:${phone}`,
      body: message,
    });
    console.log(`📤 Notification sent to ${phone}: "${message.slice(0, 60)}..."`);
  } catch (err: any) {
    console.error(`❌ Failed to notify ${phone}:`, err.message);
  }
}

export const router = Router();

const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, status = 400) =>
  res.status(status).json({ success: false, error: msg });

// ---------------------------------------------------------------------------
// SPECIALISTS
// ---------------------------------------------------------------------------

router.get('/specialists', (req: Request, res: Response) => {
  
  const tenantId = req.query.tenantId as string || 'tenant-demo-001';
  const rows = prepare(`
    SELECT s.*, json_group_array(json_object(
      'id', wh.id,
      'dayOfWeek', wh.day_of_week,
      'startTime', wh.start_time,
      'endTime', wh.end_time,
      'isWorking', wh.is_working
    )) AS workingHoursJson
    FROM specialists s
    LEFT JOIN working_hours wh ON wh.specialist_id = s.id
    WHERE s.tenant_id = ? AND s.is_active = 1
    GROUP BY s.id
    ORDER BY s.name
  `).all(tenantId);

  const data = rows.map((r: any) => ({
    id: r.id, tenantId: r.tenant_id, name: r.name,
    role: r.role, color: r.color, isActive: !!r.is_active,
    createdAt: r.created_at,
    workingHours: JSON.parse(r.workingHoursJson || '[]').map((wh: any) => ({
      id: wh.id, specialistId: r.id, dayOfWeek: wh.dayOfWeek,
      startTime: wh.startTime, endTime: wh.endTime, isWorking: !!wh.isWorking,
    })),
  }));
  ok(res, data);
});

router.post('/specialists', (req: Request, res: Response) => {
  const schema = z.object({
    tenantId: z.string().default('tenant-demo-001'),
    name: z.string().min(1),
    role: z.string().default('Specialist'),
    color: z.string().default('#6366f1'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);

  
  const id = uuid();
  prepare(`INSERT INTO specialists(id, tenant_id, name, role, color, is_active)
              VALUES (?,?,?,?,?,1)`)
    .run(id, parsed.data.tenantId, parsed.data.name, parsed.data.role, parsed.data.color);

  // Default working hours Mon–Sat 09:00–19:00
  for (let day = 0; day <= 6; day++) {
    prepare(`INSERT INTO working_hours(id, specialist_id, day_of_week, start_time, end_time, is_working)
                VALUES (?,?,?,?,?,?)`)
      .run(uuid(), id, day, '09:00', '19:00', day === 0 ? 0 : 1);
  }

  const specialist = prepare('SELECT * FROM specialists WHERE id = ?').get(id);
  ok(res, specialist);
});

router.put('/specialists/:id', (req: Request, res: Response) => {
  
  const schema = z.object({
    name: z.string().min(1).optional(),
    role: z.string().optional(),
    color: z.string().optional(),
    isActive: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);

  const { name, role, color, isActive } = parsed.data;
  prepare(`UPDATE specialists SET
    name = COALESCE(?, name),
    role = COALESCE(?, role),
    color = COALESCE(?, color),
    is_active = COALESCE(?, is_active)
    WHERE id = ?`).run(name ?? null, role ?? null, color ?? null,
    isActive !== undefined ? (isActive ? 1 : 0) : null, req.params.id);

  ok(res, prepare('SELECT * FROM specialists WHERE id = ?').get(req.params.id));
});

// Update working hours for a specialist
router.put('/specialists/:id/working-hours', (req: Request, res: Response) => {
  
  const schema = z.array(z.object({
    dayOfWeek: z.number().min(0).max(6),
    startTime: z.string(),
    endTime: z.string(),
    isWorking: z.boolean(),
  }));
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);

  const upsert = prepare(`
    INSERT INTO working_hours(id, specialist_id, day_of_week, start_time, end_time, is_working)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(specialist_id, day_of_week)
    DO UPDATE SET start_time=excluded.start_time, end_time=excluded.end_time, is_working=excluded.is_working
  `);

  for (const wh of parsed.data) {
    upsert.run(uuid(), req.params.id, wh.dayOfWeek, wh.startTime, wh.endTime, wh.isWorking ? 1 : 0);
  }

  const hours = prepare('SELECT * FROM working_hours WHERE specialist_id = ? ORDER BY day_of_week')
    .all(req.params.id);
  ok(res, hours);
});

// ---------------------------------------------------------------------------
// SERVICES
// ---------------------------------------------------------------------------

router.get('/services', (req: Request, res: Response) => {
  
  const tenantId = req.query.tenantId as string || 'tenant-demo-001';
  const rows = prepare(`
    SELECT * FROM services WHERE tenant_id = ? AND is_active = 1 ORDER BY name
  `).all(tenantId);

  ok(res, rows.map((r: any) => ({
    id: r.id, tenantId: r.tenant_id, name: r.name,
    durationMins: r.duration_mins, price: r.price,
    color: r.color, isActive: !!r.is_active,
  })));
});

router.post('/services', (req: Request, res: Response) => {
  const schema = z.object({
    tenantId: z.string().default('tenant-demo-001'),
    name: z.string().min(1),
    durationMins: z.number().min(5).max(480),
    price: z.number().min(0),
    color: z.string().default('#8b5cf6'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);

  
  const id = uuid();
  prepare(`INSERT INTO services(id, tenant_id, name, duration_mins, price, color, is_active)
              VALUES (?,?,?,?,?,?,1)`)
    .run(id, parsed.data.tenantId, parsed.data.name,
         parsed.data.durationMins, parsed.data.price, parsed.data.color);
  ok(res, prepare('SELECT * FROM services WHERE id = ?').get(id));
});

router.put('/services/:id', (req: Request, res: Response) => {
  
  const schema = z.object({
    name: z.string().optional(),
    durationMins: z.number().optional(),
    price: z.number().optional(),
    color: z.string().optional(),
    isActive: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);
  const { name, durationMins, price, color, isActive } = parsed.data;
  prepare(`UPDATE services SET
    name = COALESCE(?, name),
    duration_mins = COALESCE(?, duration_mins),
    price = COALESCE(?, price),
    color = COALESCE(?, color),
    is_active = COALESCE(?, is_active)
    WHERE id = ?`).run(name??null, durationMins??null, price??null, color??null,
    isActive !== undefined ? (isActive?1:0) : null, req.params.id);
  ok(res, prepare('SELECT * FROM services WHERE id = ?').get(req.params.id));
});

router.delete('/services/:id', (req: Request, res: Response) => {
  prepare('UPDATE services SET is_active = 0 WHERE id = ?').run(req.params.id);
  ok(res, { id: req.params.id });
});

// ---------------------------------------------------------------------------
// BOOKINGS
// ---------------------------------------------------------------------------

router.get('/bookings', (req: Request, res: Response) => {
  
  const { tenantId = 'tenant-demo-001', start, end, specialistId } = req.query as Record<string, string>;

  let query = `
    SELECT b.*,
      s.name AS specialist_name, s.color AS specialist_color,
      sv.name AS service_name, sv.duration_mins AS service_duration_mins, sv.price AS service_price
    FROM bookings b
    JOIN specialists s  ON s.id = b.specialist_id
    JOIN services   sv  ON sv.id = b.service_id
    WHERE b.tenant_id = ?
  `;
  const params: unknown[] = [tenantId];

  if (start) { query += ' AND b.starts_at >= ?'; params.push(start); }
  if (end)   { query += ' AND b.starts_at <= ?'; params.push(end); }
  if (specialistId) { query += ' AND b.specialist_id = ?'; params.push(specialistId); }

  query += ' ORDER BY b.starts_at';

  const rows = prepare(query).all(...params);
  ok(res, rows.map((r: any) => ({
    id: r.id, tenantId: r.tenant_id,
    specialistId: r.specialist_id, specialistName: r.specialist_name,
    specialistColor: r.specialist_color,
    serviceId: r.service_id, serviceName: r.service_name,
    serviceDurationMins: r.service_duration_mins, servicePrice: r.service_price,
    customerName: r.customer_name, customerPhone: r.customer_phone,
    startsAt: r.starts_at, endsAt: r.ends_at,
    status: r.status, notes: r.notes, createdAt: r.created_at,
  })));
});

router.post('/bookings', (req: Request, res: Response) => {
  const schema = z.object({
    tenantId: z.string().default('tenant-demo-001'),
    specialistId: z.string(),
    serviceId: z.string(),
    customerName: z.string().min(1),
    customerPhone: z.string().default(''),
    startsAt: z.string(),
    notes: z.string().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);

  
  const svc = prepare('SELECT duration_mins FROM services WHERE id = ?')
    .get(parsed.data.serviceId) as { duration_mins: number } | undefined;
  if (!svc) return err(res, 'Service not found', 404);

  const endsAt = format(
    addMinutes(parseISO(parsed.data.startsAt), svc.duration_mins),
    "yyyy-MM-dd'T'HH:mm:ss"
  );

  // Availability check
  if (!isSlotAvailable(parsed.data.specialistId, parsed.data.startsAt, svc.duration_mins)) {
    const suggestions = suggestNextSlots(
      parsed.data.specialistId, parsed.data.startsAt, svc.duration_mins, 3
    );
    return res.status(409).json({
      success: false,
      error: 'Slot not available',
      suggestions,
    });
  }

  const id = uuid();
  prepare(`INSERT INTO bookings(id, tenant_id, specialist_id, service_id, customer_name,
              customer_phone, starts_at, ends_at, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, parsed.data.tenantId, parsed.data.specialistId, parsed.data.serviceId,
         parsed.data.customerName, parsed.data.customerPhone,
         parsed.data.startsAt, endsAt, 'confirmed', parsed.data.notes);

  const booking = prepare(`
    SELECT b.*, s.name AS specialist_name, s.color AS specialist_color,
           sv.name AS service_name, sv.duration_mins AS service_duration_mins
    FROM bookings b
    JOIN specialists s ON s.id = b.specialist_id
    JOIN services sv ON sv.id = b.service_id
    WHERE b.id = ?
  `).get(id) as any;

  ok(res, { ...booking, specialistName: booking.specialist_name,
    specialistColor: booking.specialist_color, serviceName: booking.service_name });
});

router.put('/bookings/:id', (req: Request, res: Response) => {
  const schema = z.object({
    status: z.enum(['confirmed', 'cancelled', 'completed', 'no_show']).optional(),
    notes: z.string().optional(),
    startsAt: z.string().optional(),
    specialistId: z.string().optional(),
    serviceId: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);

  
  const { status, notes, startsAt, serviceId } = parsed.data;

  let endsAt: string | null = null;
  if (startsAt && serviceId) {
    const svc = prepare('SELECT duration_mins FROM services WHERE id = ?').get(serviceId) as any;
    endsAt = format(addMinutes(parseISO(startsAt), svc.duration_mins), "yyyy-MM-dd'T'HH:mm:ss");
  }

  prepare(`UPDATE bookings SET
    status = COALESCE(?, status),
    notes = COALESCE(?, notes),
    starts_at = COALESCE(?, starts_at),
    ends_at = COALESCE(?, ends_at),
    service_id = COALESCE(?, service_id),
    specialist_id = COALESCE(?, specialist_id)
    WHERE id = ?`)
    .run(status??null, notes??null, startsAt??null, endsAt,
         parsed.data.serviceId??null, parsed.data.specialistId??null, req.params.id);

  const updated = prepare(`
    SELECT b.*, s.name AS specialist_name, sv.name AS service_name
    FROM bookings b
    JOIN specialists s ON s.id = b.specialist_id
    JOIN services sv ON sv.id = b.service_id
    WHERE b.id = ?
  `).get(req.params.id) as any;

  // Notify customer when cancelled from dashboard
  if (status === 'cancelled' && updated?.customer_phone) {
    const dateStr = format(parseISO(updated.starts_at), 'EEEE d MMMM');
    const timeStr = format(parseISO(updated.starts_at), 'HH:mm');
    const msg = `Hi ${updated.customer_name}, your ${updated.service_name} appointment with ${updated.specialist_name} on ${dateStr} at ${timeStr} has been cancelled. We apologise for any inconvenience. Please contact us to rebook.`;
    notifyCustomer(updated.customer_phone, msg);
  }

  // Notify customer when rescheduled from dashboard
  if (startsAt && status !== 'cancelled' && updated?.customer_phone) {
    const dateStr = format(parseISO(updated.starts_at), 'EEEE d MMMM');
    const timeStr = format(parseISO(updated.starts_at), 'HH:mm');
    const msg = `Hi ${updated.customer_name}, your ${updated.service_name} appointment with ${updated.specialist_name} has been rescheduled to ${dateStr} at ${timeStr}. See you then!`;
    notifyCustomer(updated.customer_phone, msg);
  }

  ok(res, updated);
});

router.delete('/bookings/:id', async (req: Request, res: Response) => {
  const booking = prepare(`
    SELECT b.*, s.name AS specialist_name, sv.name AS service_name
    FROM bookings b
    JOIN specialists s ON s.id = b.specialist_id
    JOIN services sv ON sv.id = b.service_id
    WHERE b.id = ?
  `).get(req.params.id) as any;

  if (!booking) return err(res, 'Booking not found', 404);

  prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(req.params.id);

  // Notify customer on WhatsApp if they have a phone number
  if (booking.customer_phone) {
    const dateStr = format(parseISO(booking.starts_at), 'EEEE d MMMM');
    const timeStr = format(parseISO(booking.starts_at), 'HH:mm');
    const msg = `Hi ${booking.customer_name}, your ${booking.service_name} appointment with ${booking.specialist_name} on ${dateStr} at ${timeStr} has been cancelled. We apologise for any inconvenience. Please contact us to rebook.`;
    notifyCustomer(booking.customer_phone, msg);
  }

  ok(res, { id: req.params.id });
});

// ---------------------------------------------------------------------------
// AVAILABILITY
// ---------------------------------------------------------------------------

router.get('/availability', (req: Request, res: Response) => {
  const { specialistId, date, durationMins } = req.query as Record<string, string>;
  if (!specialistId || !date || !durationMins)
    return err(res, 'specialistId, date and durationMins are required');

  const slots = getAvailableSlots(specialistId, date, parseInt(durationMins));
  ok(res, { date, specialistId, slots });
});

router.get('/availability/suggest', (req: Request, res: Response) => {
  const { specialistId, fromDate, durationMins, count } = req.query as Record<string, string>;
  if (!specialistId || !fromDate || !durationMins)
    return err(res, 'specialistId, fromDate and durationMins are required');

  const slots = suggestNextSlots(
    specialistId, fromDate, parseInt(durationMins), parseInt(count || '3')
  );
  ok(res, slots);
});
