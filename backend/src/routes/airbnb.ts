import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { requireAuth, resolveTenantId } from '../middleware/auth.js';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';
import { sendInstagramMessage } from '../channels/instagram.js';
import { sendMessengerMessage } from '../channels/messenger.js';
import { appendAirbnbStaffMessage } from '../airbnb/session.js';
import { ensureForwardEmails } from '../airbnb/reservations/forwardEmail.js';
import { parseBlocks } from '../airbnb/reservations/deliver.js';
import multer from 'multer';
import path from 'path';

export const airbnbRouter = Router();

const instructionImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // WhatsApp only accepts JPEG/PNG images.
    const ok = ['.jpg', '.jpeg', '.png'].includes(path.extname(file.originalname).toLowerCase());
    if (ok) cb(null, true); else cb(new Error('Only JPG or PNG images are allowed'));
  },
});

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, status = 400) =>
  res.status(status).json({ success: false, error: msg });

// ═══════════════════════════════════════════════════════════════════════════
// LISTINGS
// ═══════════════════════════════════════════════════════════════════════════

airbnbRouter.get('/listings', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    // Listings created before the forwarding-address feature get theirs here.
    await ensureForwardEmails(tenantId).catch((e: any) => console.warn('[Airbnb] ensureForwardEmails failed:', e.message));
    const rows = await dbAll('SELECT * FROM airbnb_listings WHERE tenant_id = ? ORDER BY created_at ASC', tenantId);
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.post('/listings', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, address, config } = req.body;
  if (!name || !address) return err(res, 'name and address are required');
  try {
    const id = crypto.randomUUID();
    const configJson = typeof config === 'object' ? JSON.stringify(config ?? {}) : (config ?? '{}');
    await dbRun(
      `INSERT INTO airbnb_listings (id, tenant_id, name, address, config) VALUES (?,?,?,?,?)`,
      id, tenantId, name, address, configJson,
    );
    await ensureForwardEmails(tenantId).catch((e: any) => console.warn('[Airbnb] ensureForwardEmails failed:', e.message));
    const row = await dbGet('SELECT * FROM airbnb_listings WHERE id = ?', id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.put('/listings/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, address, config, is_active } = req.body;
  try {
    const configJson = config !== undefined
      ? (typeof config === 'object' ? JSON.stringify(config) : config)
      : undefined;
    await dbRun(
      `UPDATE airbnb_listings SET
         name = COALESCE(?, name),
         address = COALESCE(?, address),
         config = COALESCE(?, config),
         is_active = COALESCE(?, is_active),
         updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      name ?? null, address ?? null, configJson ?? null, is_active ?? null, req.params.id, tenantId,
    );

    // Check-in fields. Handled separately from the COALESCE update above
    // because these can legitimately be cleared back to empty/null.
    const { backup_owner_number, checkin_send_time, checkin_instructions, use_shared_forward_email } = req.body;
    const sets: string[] = [];
    const params: any[] = [];
    if (typeof use_shared_forward_email === 'boolean') { sets.push('use_shared_forward_email = ?'); params.push(use_shared_forward_email); }
    if (backup_owner_number !== undefined) { sets.push('backup_owner_number = ?'); params.push(String(backup_owner_number || '').trim() || null); }
    if (checkin_send_time !== undefined) {
      if (checkin_send_time && !/^\d{2}:\d{2}$/.test(checkin_send_time)) return err(res, 'checkin_send_time must be HH:MM');
      sets.push('checkin_send_time = ?'); params.push(checkin_send_time || null);
    }
    if (checkin_instructions !== undefined) {
      sets.push('checkin_instructions = ?'); params.push(JSON.stringify(parseBlocks(checkin_instructions)));
    }
    if (sets.length) {
      await dbRun(
        `UPDATE airbnb_listings SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ? AND tenant_id = ?`,
        ...params, req.params.id, tenantId,
      );
    }

    const row = await dbGet('SELECT * FROM airbnb_listings WHERE id = ?', req.params.id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /airbnb/listings/:id/instructions-image — uploads one photo for the
// check-in instructions editor and returns its URL. The client adds it to the
// instruction blocks and saves them via PUT.
airbnbRouter.post('/listings/:id/instructions-image', requireAuth, instructionImageUpload.single('file'), async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const listing = await dbGet('SELECT id FROM airbnb_listings WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
    if (!listing) return err(res, 'Listing not found', 404);
    if (!req.file) return err(res, 'No file uploaded');

    const { uploadToR2, r2IsConfigured } = await import('../utils/r2.js');
    if (!r2IsConfigured()) return err(res, 'File storage is not configured', 503);

    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    const key = `airbnb/${tenantId}/${req.params.id}/instructions/${crypto.randomUUID()}.${ext}`;
    const url = await uploadToR2(key, req.file.buffer, req.file.mimetype);
    ok(res, { url });
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.delete('/listings/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun('DELETE FROM airbnb_listings WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// FAQS (scoped to a listing)
// ═══════════════════════════════════════════════════════════════════════════

airbnbRouter.get('/faqs', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const listingId = req.query.listingId as string;
  if (!listingId) return err(res, 'listingId is required');
  try {
    const rows = await dbAll(
      'SELECT * FROM airbnb_faqs WHERE tenant_id = ? AND listing_id = ? ORDER BY category, question',
      tenantId, listingId,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.post('/faqs', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { listing_id, question, answer, category } = req.body;
  if (!listing_id || !question || !answer) return err(res, 'listing_id, question and answer are required');
  try {
    const listing = await dbGet('SELECT id FROM airbnb_listings WHERE id = ? AND tenant_id = ?', listing_id, tenantId);
    if (!listing) return err(res, 'Listing not found', 404);

    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO airbnb_faqs (id, tenant_id, listing_id, category, question, answer) VALUES (?,?,?,?,?,?)`,
      id, tenantId, listing_id, category ?? null, question, answer,
    );
    const row = await dbGet('SELECT * FROM airbnb_faqs WHERE id = ?', id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.put('/faqs/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { question, answer, category } = req.body;
  try {
    await dbRun(
      `UPDATE airbnb_faqs SET
         question = COALESCE(?, question),
         answer = COALESCE(?, answer),
         category = ?,
         updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      question ?? null, answer ?? null, category ?? null, req.params.id, tenantId,
    );
    const row = await dbGet('SELECT * FROM airbnb_faqs WHERE id = ?', req.params.id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.delete('/faqs/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun('DELETE FROM airbnb_faqs WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// REQUESTS
// ═══════════════════════════════════════════════════════════════════════════

airbnbRouter.get('/requests', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const status = (req.query.status as string) || 'open';
  const listingId = (req.query.listingId as string) || '';
  const resolvedAfter  = (req.query.resolvedAfter  as string) || '';
  const resolvedBefore = (req.query.resolvedBefore as string) || '';
  try {
    let sql = `SELECT r.*, l.name as listing_name FROM airbnb_requests r
       JOIN airbnb_listings l ON l.id = r.listing_id
       WHERE r.tenant_id = ?`;
    const params: any[] = [tenantId];

    if (listingId) { sql += ' AND r.listing_id = ?'; params.push(listingId); }

    if (status !== 'all') { sql += ' AND r.status = ?'; params.push(status); }
    if (status === 'resolved') {
      if (resolvedAfter)  { sql += ' AND r.resolved_at >= ?'; params.push(resolvedAfter); }
      if (resolvedBefore) { sql += ' AND r.resolved_at <= ?'; params.push(resolvedBefore); }
      sql += ' ORDER BY r.resolved_at DESC';
    } else {
      sql += ` ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at DESC`;
    }

    const rows = await dbAll(sql, ...params);
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.patch('/requests/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { status } = req.body;
  if (!status) return err(res, 'status is required');
  try {
    const sets = ['status = ?'];
    const params: any[] = [status];
    if (status === 'resolved') sets.push('resolved_at = NOW()');
    params.push(req.params.id, tenantId);
    await dbRun(`UPDATE airbnb_requests SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, ...params);
    const row = await dbGet(
      `SELECT r.*, l.name as listing_name FROM airbnb_requests r
       JOIN airbnb_listings l ON l.id = r.listing_id WHERE r.id = ?`,
      req.params.id,
    );
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATIONS
// ═══════════════════════════════════════════════════════════════════════════

airbnbRouter.get('/conversations', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      `SELECT c.id, c.tenant_id, c.listing_id, l.name as listing_name, c.channel, c.channel_user_id,
              c.ai_paused_until, c.updated_at, c.created_at
       FROM airbnb_conversations c
       LEFT JOIN airbnb_listings l ON l.id = c.listing_id
       WHERE c.tenant_id = ?
       ORDER BY c.updated_at DESC`,
      tenantId,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.get('/conversations/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const row = await dbGet(
      `SELECT c.*, l.name as listing_name FROM airbnb_conversations c
       LEFT JOIN airbnb_listings l ON l.id = c.listing_id
       WHERE c.id = ? AND c.tenant_id = ?`,
      req.params.id, tenantId,
    );
    if (!row) return err(res, 'Conversation not found', 404);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.post('/conversations/:id/reply', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { message } = req.body;
  if (!message) return err(res, 'message is required');
  try {
    const conv = await dbGet(
      'SELECT * FROM airbnb_conversations WHERE id = ? AND tenant_id = ?',
      req.params.id, tenantId,
    ) as any;
    if (!conv) return err(res, 'Conversation not found', 404);

    const tenant = await dbGet('SELECT * FROM tenants WHERE id = ?', tenantId) as any;
    const channel = (conv.channel || 'whatsapp').toLowerCase();

    if (channel === 'whatsapp') {
      await sendWhatsAppMessage(conv.channel_user_id, message, tenant);
    } else if (channel === 'instagram') {
      const accessToken = (tenant?.ig_access_token || '') as string;
      if (accessToken) await sendInstagramMessage(conv.channel_user_id, message, accessToken);
    } else if (channel === 'messenger' || channel === 'facebook') {
      const encryptedToken = (tenant?.messenger_access_token_encrypted || '') as string;
      if (encryptedToken && tenant?.messenger_page_id) {
        await sendMessengerMessage(tenant.messenger_page_id, conv.channel_user_id, message, encryptedToken);
      }
    }

    await appendAirbnbStaffMessage(conv.id, message);
    ok(res, { sent: true });
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.post('/conversations/:id/takeover', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const minutes = req.body.minutes || 60;
  try {
    const until = new Date(Date.now() + minutes * 60_000).toISOString();
    await dbRun(
      'UPDATE airbnb_conversations SET ai_paused_until = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?',
      until, req.params.id, tenantId,
    );
    ok(res, { paused_until: until });
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.post('/conversations/:id/resume', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun(
      'UPDATE airbnb_conversations SET ai_paused_until = NULL, updated_at = NOW() WHERE id = ? AND tenant_id = ?',
      req.params.id, tenantId,
    );
    ok(res, { resumed: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// DEPARTMENTS
// ═══════════════════════════════════════════════════════════════════════════

airbnbRouter.get('/departments', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll('SELECT * FROM airbnb_departments WHERE tenant_id = ? ORDER BY created_at ASC', tenantId);
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.post('/departments', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, notification_number } = req.body;
  if (!name || !notification_number) return err(res, 'name and notification_number are required');
  try {
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO airbnb_departments (id, tenant_id, name, notification_number) VALUES (?,?,?,?)`,
      id, tenantId, name, notification_number,
    );
    const row = await dbGet('SELECT * FROM airbnb_departments WHERE id = ?', id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.put('/departments/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { name, notification_number, is_active } = req.body;
  try {
    await dbRun(
      `UPDATE airbnb_departments SET
         name = COALESCE(?, name),
         notification_number = COALESCE(?, notification_number),
         is_active = COALESCE(?, is_active)
       WHERE id = ? AND tenant_id = ?`,
      name ?? null, notification_number ?? null, is_active ?? null, req.params.id, tenantId,
    );
    const row = await dbGet('SELECT * FROM airbnb_departments WHERE id = ?', req.params.id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.delete('/departments/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun('DELETE FROM airbnb_departments WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// BLOCKED NUMBERS
// ═══════════════════════════════════════════════════════════════════════════

airbnbRouter.get('/blocked', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll('SELECT * FROM airbnb_blocked_numbers WHERE tenant_id = ? ORDER BY created_at DESC', tenantId);
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.post('/blocked', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { phone_number, reason } = req.body;
  if (!phone_number) return err(res, 'phone_number is required');
  try {
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO airbnb_blocked_numbers (id, tenant_id, phone_number, reason) VALUES (?,?,?,?)
       ON CONFLICT (tenant_id, phone_number) DO UPDATE SET reason = excluded.reason`,
      id, tenantId, phone_number, reason ?? null,
    );
    const row = await dbGet('SELECT * FROM airbnb_blocked_numbers WHERE tenant_id = ? AND phone_number = ?', tenantId, phone_number);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.delete('/blocked/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun('DELETE FROM airbnb_blocked_numbers WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ═══════════════════════════════════════════════════════════════════════════
// GUEST SURVEY (checkout trigger)
// ═══════════════════════════════════════════════════════════════════════════

function lastGuestMessage(messages: any[]): any | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return messages[i];
  }
  return null;
}

// POST /airbnb/conversations/:id/checkout — marks the conversation checked
// out and, if the guest's last message was within 24h, immediately sends a
// post-stay survey (idempotent via survey_sent_at).
airbnbRouter.post('/conversations/:id/checkout', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const conv = await dbGet(
      'SELECT * FROM airbnb_conversations WHERE id = ? AND tenant_id = ?',
      req.params.id, tenantId,
    ) as any;
    if (!conv) return err(res, 'Conversation not found', 404);

    await dbRun('UPDATE airbnb_conversations SET checked_out_at = NOW() WHERE id = ?', conv.id);

    if (conv.survey_sent_at) {
      return ok(res, { checked_out: true, survey_sent: false, reason: 'already_sent' });
    }

    const messages: any[] = Array.isArray(conv.messages)
      ? conv.messages
      : (() => { try { return JSON.parse(conv.messages || '[]'); } catch { return []; } })();

    const lastGuestMsg = lastGuestMessage(messages);
    if (!lastGuestMsg?.ts) {
      return ok(res, { checked_out: true, survey_sent: false, reason: 'no_guest_messages' });
    }

    const gapMs = Date.now() - new Date(lastGuestMsg.ts).getTime();
    if (gapMs > 24 * 60 * 60 * 1000) {
      return ok(res, { checked_out: true, survey_sent: false, reason: 'outside_24h_window' });
    }

    const tenant = await dbGet('SELECT * FROM tenants WHERE id = ?', tenantId) as any;
    const listing = conv.listing_id
      ? await dbGet('SELECT name FROM airbnb_listings WHERE id = ?', conv.listing_id) as any
      : null;
    const listingName = listing?.name || tenant?.name || 'your stay';

    const surveyMessage = [
      `Thank you for staying at *${listingName}*! 🏡`,
      ``,
      `We hope you had a wonderful time.`,
      ``,
      `On a scale of *1 to 10*, how would you rate your experience?`,
      ``,
      `_(1 = very poor, 10 = exceptional)_`,
    ].join('\n');

    const channel = (conv.channel || 'whatsapp').toLowerCase();
    try {
      if (channel === 'whatsapp') {
        await sendWhatsAppMessage(conv.channel_user_id, surveyMessage, tenant);
      } else if (channel === 'instagram') {
        const accessToken = (tenant?.ig_access_token || '') as string;
        if (accessToken) await sendInstagramMessage(conv.channel_user_id, surveyMessage, accessToken);
      } else if (channel === 'messenger' || channel === 'facebook') {
        const encryptedToken = (tenant?.messenger_access_token_encrypted || '') as string;
        if (encryptedToken && tenant?.messenger_page_id) {
          await sendMessengerMessage(tenant.messenger_page_id, conv.channel_user_id, surveyMessage, encryptedToken);
        }
      }
    } catch (sendErr: any) {
      console.error('[Airbnb] Survey send failed:', sendErr.message);
      return ok(res, { checked_out: true, survey_sent: false, reason: 'send_failed', error: sendErr.message });
    }

    // Only mark sent + log the message after the send actually succeeds —
    // mirrors hotel's checkout-survey route, avoids a stuck
    // checked_out+survey_sent-with-no-message state.
    const now = new Date().toISOString();
    const updatedMessages = [...messages, { role: 'assistant', content: surveyMessage, ts: now }];
    await dbRun(
      'UPDATE airbnb_conversations SET survey_sent_at = NOW(), messages = ? WHERE id = ?',
      JSON.stringify(updatedMessages), conv.id,
    );

    ok(res, { checked_out: true, survey_sent: true });
  } catch (e: any) { err(res, e.message, 500); }
});


// ═══════════════════════════════════════════════════════════════════════════
// RESERVATIONS (parsed from forwarded Airbnb / Booking.com emails)
// ═══════════════════════════════════════════════════════════════════════════

// GET /airbnb/reservations?listingId=&scope=upcoming|all
airbnbRouter.get('/reservations', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const listingId = (req.query.listingId as string) || '';
  const scope = (req.query.scope as string) === 'all' ? 'all' : 'upcoming';
  try {
    let sql = `SELECT r.id, r.listing_id, l.name AS listing_name, r.platform, r.reservation_code,
                      r.guest_name, r.guest_phone,
                      to_char(r.checkin_date, 'YYYY-MM-DD') AS checkin_date,
                      to_char(r.checkout_date, 'YYYY-MM-DD') AS checkout_date,
                      r.guest_count, r.source,
                      r.status, r.checkin_instructions_sent, r.do_not_send, r.created_at
               FROM airbnb_reservations r
               JOIN airbnb_listings l ON l.id = r.listing_id
               WHERE r.tenant_id = ?`;
    const params: any[] = [tenantId];
    if (listingId) { sql += ' AND r.listing_id = ?'; params.push(listingId); }
    if (scope === 'upcoming') sql += ' AND COALESCE(r.checkout_date, r.checkin_date) >= CURRENT_DATE - 1';
    sql += ' ORDER BY r.checkin_date ASC LIMIT 500';
    ok(res, await dbAll(sql, ...params));
  } catch (e: any) { err(res, e.message, 500); }
});

const isIsoDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  // toISOString() throws on an invalid date, and rolls e.g. Feb 30 to Mar 2 — compare to catch both.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// POST /airbnb/reservations — manual entry. Writes the same table as
// email-parsed reservations, so it behaves identically everywhere else
// (dashboard row, sent indicator, don't-send, name-match lookup).
airbnbRouter.post('/reservations', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { listing_id, guest_name, guest_count, checkin_date, checkout_date, guest_phone } = req.body;

  const name = String(guest_name || '').trim();
  const count = Number(guest_count);
  if (!listing_id) return err(res, 'listing_id is required');
  if (!name || name.length > 100) return err(res, 'guest_name is required');
  if (!Number.isInteger(count) || count < 1 || count > 100) return err(res, 'guest_count must be a whole number of at least 1');
  if (!isIsoDate(checkin_date) || !isIsoDate(checkout_date)) return err(res, 'checkin_date and checkout_date are required (YYYY-MM-DD)');
  if (checkout_date <= checkin_date) return err(res, 'Check-out must be after check-in');

  // Optional. Stored as +digits so it compares cleanly with the number a guest
  // messages from; a number that doesn't match the guest's WhatsApp number
  // just means the name-match path won't send to them (fails closed).
  let phone: string | null = null;
  const rawPhone = String(guest_phone ?? '').trim();
  if (rawPhone) {
    const digits = rawPhone.replace(/^whatsapp:/, '').replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return err(res, 'WhatsApp number looks invalid — include the country code');
    phone = `+${digits}`;
  }

  try {
    const listing = await dbGet('SELECT id FROM airbnb_listings WHERE id = ? AND tenant_id = ?', listing_id, tenantId);
    if (!listing) return err(res, 'Listing not found', 404);

    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO airbnb_reservations
         (id, tenant_id, listing_id, platform, guest_name, guest_phone, guest_count, checkin_date, checkout_date, source)
       VALUES (?,?,?, 'manual', ?,?,?, ?::date, ?::date, 'manual')`,
      id, tenantId, listing_id, name, phone, count, checkin_date, checkout_date,
    );
    ok(res, { id });
  } catch (e: any) { err(res, e.message, 500); }
});

// DELETE /airbnb/reservations/:id — manual entries only, so a typo can be
// undone. Email-parsed reservations are never deleted here; cancel/change
// emails (or Don't-send) are how those get handled.
airbnbRouter.delete('/reservations/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const row = await dbGet(
      "SELECT id FROM airbnb_reservations WHERE id = ? AND tenant_id = ? AND source = 'manual'",
      req.params.id, tenantId,
    );
    if (!row) return err(res, 'Only manually added reservations can be deleted', 404);
    await dbRun('DELETE FROM airbnb_reservations WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// GET /airbnb/forwarding — the tenant's shared forwarding address.
airbnbRouter.get('/forwarding', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await ensureForwardEmails(tenantId);
    const t = await dbGet('SELECT shared_confirmation_forward_email FROM tenants WHERE id = ?', tenantId) as any;
    ok(res, { shared_email: t?.shared_confirmation_forward_email ?? null });
  } catch (e: any) { err(res, e.message, 500); }
});

// PATCH /airbnb/reservations/:id/do-not-send — { do_not_send: boolean }.
// Blocks both the proactive send job and the guest-initiated (name-match) path.
airbnbRouter.patch('/reservations/:id/do-not-send', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { do_not_send } = req.body;
  if (typeof do_not_send !== 'boolean') return err(res, 'do_not_send (boolean) is required');
  try {
    await dbRun(
      'UPDATE airbnb_reservations SET do_not_send = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?',
      do_not_send, req.params.id, tenantId,
    );
    ok(res, { id: req.params.id, do_not_send });
  } catch (e: any) { err(res, e.message, 500); }
});

// GET /airbnb/reservations/email-review — forwarded emails that didn't parse,
// or that were a cancellation/change with no reservation to apply to.
airbnbRouter.get('/reservations/email-review', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      `SELECT g.id, g.listing_id, l.name AS listing_name, g.status, g.reason, g.from_address, g.subject,
              LEFT(g.body_text, 4000) AS body_excerpt, g.created_at
       FROM airbnb_email_ingest_log g
       LEFT JOIN airbnb_listings l ON l.id = g.listing_id
       WHERE g.tenant_id = ? AND g.status IN ('unparsed', 'unmatched', 'error') AND g.resolved_at IS NULL
       ORDER BY g.created_at DESC LIMIT 50`,
      tenantId,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

airbnbRouter.post('/reservations/email-review/:id/dismiss', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun(
      'UPDATE airbnb_email_ingest_log SET resolved_at = NOW() WHERE id = ? AND tenant_id = ?',
      req.params.id, tenantId,
    );
    ok(res, { dismissed: true });
  } catch (e: any) { err(res, e.message, 500); }
});
