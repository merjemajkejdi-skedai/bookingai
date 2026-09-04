import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { requireAuth, resolveTenantId } from '../middleware/auth.js';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';
import { sendInstagramMessage } from '../channels/instagram.js';
import { sendMessengerMessage } from '../channels/messenger.js';
import { appendGbStaffMessage } from '../generalBusiness/session.js';

export const gbRouter = Router();

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, status = 400) =>
  res.status(status).json({ success: false, error: msg });

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

gbRouter.get('/config', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const row = await dbGet('SELECT * FROM gb_business_config WHERE tenant_id = ?', tenantId);
    ok(res, row || null);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.put('/config', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { business_name, business_description, phone, website, email,
    opening_hours, notification_whatsapp, fallback_message, ai_enabled, menu_enabled } = req.body;
  try {
    const existing = await dbGet('SELECT id FROM gb_business_config WHERE tenant_id = ?', tenantId);
    const hours = typeof opening_hours === 'object' ? JSON.stringify(opening_hours) : (opening_hours ?? '{}');

    if (existing) {
      await dbRun(
        `UPDATE gb_business_config SET
          business_name = COALESCE(?, business_name),
          business_description = ?,
          phone = ?, website = ?, email = ?,
          opening_hours = ?,
          notification_whatsapp = ?,
          fallback_message = ?,
          ai_enabled = ?,
          updated_at = ${isPg ? 'NOW()' : 'CURRENT_TIMESTAMP'}
        WHERE tenant_id = ?`,
        business_name, business_description ?? null, phone ?? null, website ?? null,
        email ?? null, hours, notification_whatsapp ?? null, fallback_message ?? null,
        isPg ? (ai_enabled ?? true) : (ai_enabled ? 1 : 0), tenantId,
      );
    } else {
      await dbRun(
        `INSERT INTO gb_business_config
          (id, tenant_id, business_name, business_description, phone, website, email,
           opening_hours, notification_whatsapp, fallback_message, ai_enabled)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        crypto.randomUUID(), tenantId, business_name || 'Business',
        business_description ?? null, phone ?? null, website ?? null, email ?? null,
        hours, notification_whatsapp ?? null, fallback_message ?? null,
        isPg ? (ai_enabled ?? true) : (ai_enabled ? 1 : 0),
      );
    }

    if (menu_enabled !== undefined) {
      await dbRun(
        `UPDATE tenants SET menu_enabled = ? WHERE id = ?`,
        isPg ? !!menu_enabled : (menu_enabled ? 1 : 0), tenantId,
      );
    }

    const updated = await dbGet('SELECT * FROM gb_business_config WHERE tenant_id = ?', tenantId);
    ok(res, updated);
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// LOCATIONS
// ═══════════════════════════════════════════════════════════════════════════

gbRouter.get('/locations', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll('SELECT * FROM gb_locations WHERE tenant_id = ? ORDER BY sort_order', tenantId);
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.post('/locations', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, address, phone, sort_order } = req.body;
  if (!name || !address) return err(res, 'name and address are required');
  try {
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO gb_locations (id, tenant_id, name, address, phone, sort_order) VALUES (?,?,?,?,?,?)`,
      id, tenantId, name, address, phone ?? null, sort_order ?? 0,
    );
    const row = await dbGet('SELECT * FROM gb_locations WHERE id = ?', id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.put('/locations/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, address, phone, sort_order, is_active } = req.body;
  try {
    await dbRun(
      `UPDATE gb_locations SET name = COALESCE(?,name), address = COALESCE(?,address),
       phone = ?, sort_order = COALESCE(?,sort_order),
       is_active = COALESCE(?,is_active),
       updated_at = ${isPg ? 'NOW()' : 'CURRENT_TIMESTAMP'}
       WHERE id = ? AND tenant_id = ?`,
      name, address, phone ?? null, sort_order, is_active, req.params.id, tenantId,
    );
    const row = await dbGet('SELECT * FROM gb_locations WHERE id = ?', req.params.id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.delete('/locations/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun('DELETE FROM gb_locations WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// DEPARTMENTS
// ═══════════════════════════════════════════════════════════════════════════

gbRouter.get('/departments', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll('SELECT * FROM gb_departments WHERE tenant_id = ? ORDER BY name', tenantId);
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.post('/departments', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, whatsapp_number, request_types, response_time_minutes } = req.body;
  if (!name) return err(res, 'name is required');
  try {
    const id = crypto.randomUUID();
    const types = isPg
      ? (request_types || [])
      : JSON.stringify(request_types || []);
    await dbRun(
      `INSERT INTO gb_departments (id, tenant_id, name, whatsapp_number, request_types, response_time_minutes)
       VALUES (?,?,?,?,?,?)`,
      id, tenantId, name, whatsapp_number ?? null, types, response_time_minutes ?? 30,
    );
    const row = await dbGet('SELECT * FROM gb_departments WHERE id = ?', id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.put('/departments/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, whatsapp_number, request_types, response_time_minutes, is_active } = req.body;
  try {
    const types = request_types !== undefined
      ? (isPg ? request_types : JSON.stringify(request_types))
      : undefined;
    await dbRun(
      `UPDATE gb_departments SET
       name = COALESCE(?,name), whatsapp_number = ?,
       request_types = COALESCE(?,request_types),
       response_time_minutes = COALESCE(?,response_time_minutes),
       is_active = COALESCE(?,is_active)
       WHERE id = ? AND tenant_id = ?`,
      name, whatsapp_number ?? null, types, response_time_minutes, is_active,
      req.params.id, tenantId,
    );
    const row = await dbGet('SELECT * FROM gb_departments WHERE id = ?', req.params.id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.delete('/departments/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun('DELETE FROM gb_departments WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// FAQS
// ═══════════════════════════════════════════════════════════════════════════

gbRouter.get('/faqs', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll('SELECT * FROM gb_faqs WHERE tenant_id = ? ORDER BY sort_order', tenantId);
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.post('/faqs', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { question, answer } = req.body;
  if (!question || !answer) return err(res, 'question and answer are required');
  try {
    const id = crypto.randomUUID();
    await dbRun(
      'INSERT INTO gb_faqs (id, tenant_id, question, answer) VALUES (?,?,?,?)',
      id, tenantId, question, answer,
    );
    const row = await dbGet('SELECT * FROM gb_faqs WHERE id = ?', id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.put('/faqs/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { question, answer, is_active, sort_order } = req.body;
  try {
    await dbRun(
      `UPDATE gb_faqs SET question = COALESCE(?,question), answer = COALESCE(?,answer),
       is_active = COALESCE(?,is_active), sort_order = COALESCE(?,sort_order)
       WHERE id = ? AND tenant_id = ?`,
      question, answer, is_active, sort_order, req.params.id, tenantId,
    );
    const row = await dbGet('SELECT * FROM gb_faqs WHERE id = ?', req.params.id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.delete('/faqs/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun('DELETE FROM gb_faqs WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENTS
// ═══════════════════════════════════════════════════════════════════════════

gbRouter.get('/documents', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll('SELECT * FROM gb_documents WHERE tenant_id = ? ORDER BY created_at DESC', tenantId);
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.post('/documents', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, file_type, r2_key, file_size_bytes, extracted_text } = req.body;
  if (!name || !file_type || !r2_key) return err(res, 'name, file_type, and r2_key are required');
  try {
    const id = crypto.randomUUID();
    await dbRun(
      'INSERT INTO gb_documents (id, tenant_id, name, file_type, r2_key, file_size_bytes, extracted_text) VALUES (?,?,?,?,?,?,?)',
      id, tenantId, name, file_type, r2_key, file_size_bytes ?? null, extracted_text ?? null,
    );
    const row = await dbGet('SELECT * FROM gb_documents WHERE id = ?', id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.patch('/documents/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { is_active } = req.body;
  try {
    await dbRun(
      `UPDATE gb_documents SET is_active = ? WHERE id = ? AND tenant_id = ?`,
      isPg ? is_active : (is_active ? 1 : 0), req.params.id, tenantId,
    );
    const row = await dbGet('SELECT * FROM gb_documents WHERE id = ?', req.params.id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.delete('/documents/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun('DELETE FROM gb_documents WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// MENU ITEMS
// ═══════════════════════════════════════════════════════════════════════════

gbRouter.get('/menu', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll('SELECT * FROM gb_menu_items WHERE tenant_id = ? ORDER BY category, sort_order', tenantId);
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.post('/menu', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, description, price, currency, category, sort_order } = req.body;
  if (!name) return err(res, 'name is required');
  try {
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO gb_menu_items (id, tenant_id, name, description, price, currency, category, sort_order)
       VALUES (?,?,?,?,?,?,?,?)`,
      id, tenantId, name, description ?? null, price ?? null, currency ?? 'ALL',
      category ?? null, sort_order ?? 0,
    );
    const row = await dbGet('SELECT * FROM gb_menu_items WHERE id = ?', id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.put('/menu/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, description, price, currency, category, is_available, sort_order } = req.body;
  try {
    await dbRun(
      `UPDATE gb_menu_items SET
       name = COALESCE(?,name), description = ?, price = ?,
       currency = COALESCE(?,currency), category = ?,
       is_available = COALESCE(?,is_available), sort_order = COALESCE(?,sort_order)
       WHERE id = ? AND tenant_id = ?`,
      name, description ?? null, price ?? null, currency, category ?? null,
      is_available, sort_order, req.params.id, tenantId,
    );
    const row = await dbGet('SELECT * FROM gb_menu_items WHERE id = ?', req.params.id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.delete('/menu/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun('DELETE FROM gb_menu_items WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════════════════════════

gbRouter.get('/orders', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll('SELECT * FROM gb_orders WHERE tenant_id = ? ORDER BY created_at DESC', tenantId);
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.patch('/orders/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { status, notes } = req.body;
  try {
    const sets: string[] = [];
    const params: any[] = [];
    if (status) { sets.push('status = ?'); params.push(status); }
    if (notes !== undefined) { sets.push('notes = ?'); params.push(notes); }
    sets.push(isPg ? 'updated_at = NOW()' : 'updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id, tenantId);
    await dbRun(`UPDATE gb_orders SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, ...params);
    const row = await dbGet('SELECT * FROM gb_orders WHERE id = ?', req.params.id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// REQUESTS
// ═══════════════════════════════════════════════════════════════════════════

gbRouter.get('/requests', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const rawStatus = (req.query.status as string) || 'open';
  try {
    let rows: unknown[];
    if (rawStatus === 'all') {
      rows = await dbAll(
        `SELECT r.*, d.name as department_name FROM gb_requests r
         LEFT JOIN gb_departments d ON r.department_id = ${isPg ? 'd.id::text' : 'd.id'}
         WHERE r.tenant_id = ?
         ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, r.created_at DESC`,
        tenantId,
      );
    } else {
      rows = await dbAll(
        `SELECT r.*, d.name as department_name FROM gb_requests r
         LEFT JOIN gb_departments d ON r.department_id = ${isPg ? 'd.id::text' : 'd.id'}
         WHERE r.tenant_id = ? AND r.status = ?
         ORDER BY r.created_at ASC`,
        tenantId, rawStatus,
      );
    }
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.patch('/requests/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { status, staff_notes } = req.body;
  try {
    const sets: string[] = [];
    const params: any[] = [];
    if (status) { sets.push('status = ?'); params.push(status); }
    if (staff_notes !== undefined) { sets.push('staff_notes = ?'); params.push(staff_notes); }
    sets.push(isPg ? 'updated_at = NOW()' : 'updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id, tenantId);
    await dbRun(`UPDATE gb_requests SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, ...params);
    const row = await dbGet(
      `SELECT r.*, d.name as department_name FROM gb_requests r
       LEFT JOIN gb_departments d ON r.department_id = ${isPg ? 'd.id::text' : 'd.id'}
       WHERE r.id = ?`,
      req.params.id,
    );
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATIONS
// ═══════════════════════════════════════════════════════════════════════════

gbRouter.get('/conversations', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      `SELECT id, tenant_id, guest_phone, guest_name, guest_username, guest_email,
              last_message, channel, channel_user_id, ai_paused_until, ai_paused_by,
              updated_at, last_guest_message_at
       FROM gb_conversations WHERE tenant_id = ?
       ORDER BY updated_at DESC`,
      tenantId,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.get('/conversations/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const row = await dbGet(
      'SELECT * FROM gb_conversations WHERE id = ? AND tenant_id = ?',
      req.params.id, tenantId,
    );
    if (!row) return err(res, 'Conversation not found', 404);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.post('/conversations/:id/reply', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { message } = req.body;
  if (!message) return err(res, 'message is required');
  try {
    const conv = await dbGet(
      'SELECT * FROM gb_conversations WHERE id = ? AND tenant_id = ?',
      req.params.id, tenantId,
    ) as any;
    if (!conv) return err(res, 'Conversation not found', 404);

    const tenant = await dbGet('SELECT * FROM tenants WHERE id = ?', tenantId) as any;
    const channel = (conv.channel || 'whatsapp').toLowerCase();

    if (channel === 'whatsapp' && conv.guest_phone) {
      await sendWhatsAppMessage(conv.guest_phone, message, tenant);
    } else if (channel === 'instagram' && conv.channel_user_id) {
      await sendInstagramMessage(conv.channel_user_id, message, tenantId);
    } else if (channel === 'facebook' && conv.channel_user_id) {
      await sendMessengerMessage(conv.channel_user_id, message, tenantId);
    }

    await appendGbStaffMessage(tenantId, conv.guest_phone, message);
    ok(res, { sent: true });
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.post('/conversations/:id/takeover', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const minutes = req.body.minutes || 60;
  try {
    const until = new Date(Date.now() + minutes * 60_000).toISOString();
    await dbRun(
      `UPDATE gb_conversations SET ai_paused_until = ?, ai_paused_by = 'staff', updated_at = ${isPg ? 'NOW()' : 'CURRENT_TIMESTAMP'}
       WHERE id = ? AND tenant_id = ?`,
      until, req.params.id, tenantId,
    );
    ok(res, { paused_until: until });
  } catch (e: any) { err(res, e.message, 500); }
});

gbRouter.post('/conversations/:id/resume', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun(
      `UPDATE gb_conversations SET ai_paused_until = NULL, ai_paused_by = NULL, updated_at = ${isPg ? 'NOW()' : 'CURRENT_TIMESTAMP'}
       WHERE id = ? AND tenant_id = ?`,
      req.params.id, tenantId,
    );
    ok(res, { resumed: true });
  } catch (e: any) { err(res, e.message, 500); }
});
