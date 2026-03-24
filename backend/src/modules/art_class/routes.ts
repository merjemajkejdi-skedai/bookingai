// Art Class module routes — classes (events) and registrations.
// Separated so art_class changes never touch the booking or art_event modules.
// Initially identical to art_event/routes.ts — diverge freely as needs change.

import { Router, Request, Response } from 'express';
import { isPg, prepare, query, queryOne, queryRun } from '../../db/database.js';
import { requireAuth } from '../../middleware/auth.js';

export const artClassRouter = Router();

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

artClassRouter.get('/events', requireAuth, async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const { start, end, teacherId } = req.query as Record<string, string>;

  let sql = `
    SELECT e.*,
           s.name  AS teacher_name,
           s.color AS teacher_color,
           COUNT(r.id) AS registration_count
    FROM art_events e
    LEFT JOIN specialists s ON s.id = e.teacher_id
    LEFT JOIN event_registrations r ON r.event_id = e.id
    WHERE e.tenant_id = ? AND e.is_active = 1
  `;
  const params: unknown[] = [tenantId];

  if (start)     { sql += ' AND e.date >= ?'; params.push(start); }
  if (end)       { sql += ' AND e.date <= ?'; params.push(end); }
  if (teacherId) { sql += ' AND e.teacher_id = ?'; params.push(teacherId); }

  sql += ' GROUP BY e.id, e.tenant_id, e.teacher_id, e.title, e.description, e.date, e.start_time, e.end_time, e.age_min, e.age_max, e.max_capacity, e.price, e.is_active, e.created_at, s.name, s.color ORDER BY e.date, e.start_time';

  try {
    const rows = await dbAll(sql, ...params) as any[];
    ok(res, rows.map(r => ({
      id: r.id, tenantId: r.tenant_id,
      teacherId: r.teacher_id ?? null, teacherName: r.teacher_name ?? null, teacherColor: r.teacher_color ?? null,
      title: r.title, description: r.description,
      date: r.date, startTime: r.start_time, endTime: r.end_time,
      ageMin: r.age_min ?? null, ageMax: r.age_max ?? null,
      maxCapacity: r.max_capacity ?? null,
      price: r.price ?? 0,
      registrationCount: Number(r.registration_count),
      isActive: !!r.is_active, createdAt: r.created_at,
    })));
  } catch (e: any) { err(res, e.message, 500); }
});

artClassRouter.post('/events', requireAuth, async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const { title, description = '', date, startTime, endTime, teacherId, ageMin, ageMax, maxCapacity, price } = req.body;

  if (!title || !date) return err(res, 'title and date are required');

  const id = crypto.randomUUID();
  try {
    await dbRun(
      `INSERT INTO art_events(id,tenant_id,teacher_id,title,description,date,start_time,end_time,age_min,age_max,max_capacity,price)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, tenantId, teacherId ?? null, title, description,
      date, startTime || '10:00', endTime || '11:00',
      ageMin ?? null, ageMax ?? null, maxCapacity ?? null, price ?? 0
    );
    const row = await dbGet('SELECT * FROM art_events WHERE id=?', id) as any;
    ok(res, {
      id: row.id, tenantId: row.tenant_id, teacherId: row.teacher_id ?? null,
      title: row.title, description: row.description,
      date: row.date, startTime: row.start_time, endTime: row.end_time,
      ageMin: row.age_min ?? null, ageMax: row.age_max ?? null,
      maxCapacity: row.max_capacity ?? null, price: row.price ?? 0, registrationCount: 0,
      isActive: !!row.is_active, createdAt: row.created_at,
    });
  } catch (e: any) { err(res, e.message, 500); }
});

artClassRouter.put('/events/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const { id } = req.params;
  const { title, description, date, startTime, endTime, teacherId, ageMin, ageMax, maxCapacity, price } = req.body;

  const existing = await dbGet('SELECT id FROM art_events WHERE id=? AND tenant_id=?', id, tenantId) as any;
  if (!existing) return err(res, 'Event not found', 404);

  try {
    await dbRun(
      `UPDATE art_events SET
         title=?, description=?, date=?, start_time=?, end_time=?,
         teacher_id=?, age_min=?, age_max=?, max_capacity=?, price=?
       WHERE id=?`,
      title, description ?? '', date, startTime, endTime,
      teacherId ?? null, ageMin ?? null, ageMax ?? null, maxCapacity ?? null, price ?? 0, id
    );
    const row = await dbGet('SELECT * FROM art_events WHERE id=?', id) as any;
    const cnt = await dbGet('SELECT COUNT(*) as cnt FROM event_registrations WHERE event_id=?', id) as any;
    ok(res, {
      id: row.id, tenantId: row.tenant_id, teacherId: row.teacher_id ?? null,
      title: row.title, description: row.description,
      date: row.date, startTime: row.start_time, endTime: row.end_time,
      ageMin: row.age_min ?? null, ageMax: row.age_max ?? null,
      maxCapacity: row.max_capacity ?? null, price: row.price ?? 0,
      registrationCount: Number(cnt?.cnt || 0),
      isActive: !!row.is_active, createdAt: row.created_at,
    });
  } catch (e: any) { err(res, e.message, 500); }
});

artClassRouter.delete('/events/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const { id } = req.params;

  const existing = await dbGet('SELECT id FROM art_events WHERE id=? AND tenant_id=?', id, tenantId) as any;
  if (!existing) return err(res, 'Event not found', 404);

  try {
    await dbRun('UPDATE art_events SET is_active=0 WHERE id=?', id);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

artClassRouter.get('/events/:id/registrations', requireAuth, async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const { id } = req.params;

  const event = await dbGet('SELECT id FROM art_events WHERE id=? AND tenant_id=?', id, tenantId) as any;
  if (!event) return err(res, 'Event not found', 404);

  try {
    const rows = await dbAll('SELECT * FROM event_registrations WHERE event_id=? ORDER BY registered_at ASC', id) as any[];
    ok(res, rows.map(r => ({
      id: r.id, eventId: r.event_id, tenantId: r.tenant_id,
      participantName: r.participant_name, parentPhone: r.parent_phone,
      parentName: r.parent_name, notes: r.notes, registeredAt: r.registered_at,
    })));
  } catch (e: any) { err(res, e.message, 500); }
});

artClassRouter.post('/events/:id/registrations', requireAuth, async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const { id } = req.params;
  const { participantName, parentPhone = '', parentName = '', notes = '' } = req.body;

  if (!participantName) return err(res, 'participantName is required');

  const event = await dbGet('SELECT * FROM art_events WHERE id=? AND tenant_id=?', id, tenantId) as any;
  if (!event) return err(res, 'Event not found', 404);

  if (event.max_capacity) {
    const cnt = await dbGet('SELECT COUNT(*) as cnt FROM event_registrations WHERE event_id=?', id) as any;
    if (Number(cnt?.cnt || 0) >= event.max_capacity) return err(res, 'This class is at full capacity');
  }

  try {
    const regId = crypto.randomUUID();
    await dbRun(
      'INSERT INTO event_registrations(id,event_id,tenant_id,participant_name,parent_phone,parent_name,notes) VALUES(?,?,?,?,?,?,?)',
      regId, id, tenantId, participantName, parentPhone, parentName, notes
    );
    const row = await dbGet('SELECT * FROM event_registrations WHERE id=?', regId) as any;
    ok(res, {
      id: row.id, eventId: row.event_id, tenantId: row.tenant_id,
      participantName: row.participant_name, parentPhone: row.parent_phone,
      parentName: row.parent_name, notes: row.notes, registeredAt: row.registered_at,
    });
  } catch (e: any) { err(res, e.message, 500); }
});

artClassRouter.delete('/events/:id/registrations/:regId', requireAuth, async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const { id, regId } = req.params;

  const event = await dbGet('SELECT id FROM art_events WHERE id=? AND tenant_id=?', id, tenantId) as any;
  if (!event) return err(res, 'Event not found', 404);

  const reg = await dbGet('SELECT id FROM event_registrations WHERE id=? AND event_id=?', regId, id) as any;
  if (!reg) return err(res, 'Registration not found', 404);

  try {
    await dbRun('DELETE FROM event_registrations WHERE id=?', regId);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ── GET /event-templates ──────────────────────────────────────────────────────
artClassRouter.get('/event-templates', requireAuth, async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  try {
    const rows = await dbAll(
      `SELECT t.*, s.name AS teacher_name, s.color AS teacher_color
       FROM event_templates t
       LEFT JOIN specialists s ON s.id = t.teacher_id
       WHERE t.tenant_id = ?
       ORDER BY t.created_at DESC`,
      tenantId
    ) as any[];
    ok(res, rows.map(r => ({
      id: r.id, tenantId: r.tenant_id,
      teacherId: r.teacher_id ?? null, teacherName: r.teacher_name ?? null, teacherColor: r.teacher_color ?? null,
      title: r.title, description: r.description,
      ageMin: r.age_min ?? null, ageMax: r.age_max ?? null,
      maxCapacity: r.max_capacity ?? null,
      price: r.price ?? 0,
      createdAt: r.created_at,
    })));
  } catch (e: any) { err(res, e.message, 500); }
});

// ── POST /event-templates ─────────────────────────────────────────────────────
artClassRouter.post('/event-templates', requireAuth, async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const { title, description = '', teacherId, ageMin, ageMax, maxCapacity, price } = req.body;
  if (!title) return err(res, 'title is required');
  const id = crypto.randomUUID();
  try {
    await dbRun(
      `INSERT INTO event_templates(id,tenant_id,teacher_id,title,description,age_min,age_max,max_capacity,price)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      id, tenantId, teacherId ?? null, title, description,
      ageMin ?? null, ageMax ?? null, maxCapacity ?? null, price ?? 0
    );
    const row = await dbGet('SELECT * FROM event_templates WHERE id=?', id) as any;
    ok(res, {
      id: row.id, tenantId: row.tenant_id, teacherId: row.teacher_id ?? null,
      title: row.title, description: row.description,
      ageMin: row.age_min ?? null, ageMax: row.age_max ?? null,
      maxCapacity: row.max_capacity ?? null, price: row.price ?? 0, createdAt: row.created_at,
    });
  } catch (e: any) { err(res, e.message, 500); }
});

// ── PUT /event-templates/:id ──────────────────────────────────────────────────
artClassRouter.put('/event-templates/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const { id } = req.params;
  const { title, description, teacherId, ageMin, ageMax, maxCapacity, price } = req.body;
  const existing = await dbGet('SELECT id FROM event_templates WHERE id=? AND tenant_id=?', id, tenantId) as any;
  if (!existing) return err(res, 'Template not found', 404);
  try {
    await dbRun(
      `UPDATE event_templates SET title=?, description=?,
       teacher_id=?, age_min=?, age_max=?, max_capacity=?, price=? WHERE id=?`,
      title, description ?? '',
      teacherId ?? null, ageMin ?? null, ageMax ?? null, maxCapacity ?? null, price ?? 0, id
    );
    const row = await dbGet('SELECT * FROM event_templates WHERE id=?', id) as any;
    ok(res, {
      id: row.id, tenantId: row.tenant_id, teacherId: row.teacher_id ?? null,
      title: row.title, description: row.description,
      ageMin: row.age_min ?? null, ageMax: row.age_max ?? null,
      maxCapacity: row.max_capacity ?? null, price: row.price ?? 0, createdAt: row.created_at,
    });
  } catch (e: any) { err(res, e.message, 500); }
});

// ── DELETE /event-templates/:id ───────────────────────────────────────────────
artClassRouter.delete('/event-templates/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const { id } = req.params;
  const existing = await dbGet('SELECT id FROM event_templates WHERE id=? AND tenant_id=?', id, tenantId) as any;
  if (!existing) return err(res, 'Template not found', 404);
  try {
    await dbRun('DELETE FROM event_templates WHERE id=?', id);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});
