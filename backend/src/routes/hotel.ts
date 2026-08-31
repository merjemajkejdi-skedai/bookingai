import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';
import { sendInstagramMessage } from '../channels/instagram.js';
import * as XLSX from 'xlsx';
import { requireAuth, resolveTenantId } from '../middleware/auth.js';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { appendStaffMessage } from '../hotel/session.js';
import { ImapSmtpAdapter } from '../channels/email/ImapSmtpAdapter.js';
import { GraphAdapter } from '../channels/email/GraphAdapter.js';
import type { EmailAccountRow } from '../channels/email/types.js';
import { getConversationsTable } from '../utils/conversationsTable.js';

export const hotelRouter = Router();

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------
async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const ok = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, status = 400) =>
  res.status(status).json({ success: false, error: msg });

async function getTenantType(tenantId: string): Promise<string> {
  const row = await dbGet('SELECT type FROM tenants WHERE id = ?', tenantId) as any;
  return (row?.type || 'hotel').toLowerCase();
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

// GET /hotel/requests?status=pending|in_progress|resolved|all
hotelRouter.get('/requests', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const rawStatus = (req.query.status as string) || 'pending';
  try {
    let rows: unknown[];
    if (rawStatus === 'all') {
      rows = await dbAll(
        `SELECT * FROM hotel_requests WHERE tenant_id = ?
         ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, created_at DESC`,
        tenantId,
      );
    } else {
      rows = await dbAll(
        `SELECT * FROM hotel_requests WHERE tenant_id = ? AND status = ? ORDER BY created_at ASC`,
        tenantId, rawStatus,
      );
    }
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

// PATCH /hotel/requests/:id
hotelRouter.patch('/requests/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { status, note } = req.body as { status: string; note?: string };
  if (!status) return err(res, 'status is required');
  try {
    const now  = new Date().toISOString();
    const resolvedAt    = status === 'resolved'    ? now : null;
    const inProgressAt  = status === 'in_progress' ? now : null;

    // Append note to notes column if provided
    let updatedNotes: string | null = null;
    if (note) {
      const existing = await dbGet('SELECT notes FROM hotel_requests WHERE id = ? AND tenant_id = ?', req.params.id, tenantId) as any;
      const entry = `[Dashboard] ${note}`;
      updatedNotes = existing?.notes ? `${existing.notes}\n${entry}` : entry;
    }

    await dbRun(
      `UPDATE hotel_requests
       SET status = ?,
           resolved_at   = COALESCE(?, resolved_at),
           in_progress_at = COALESCE(?, in_progress_at),
           notes = COALESCE(?, notes)
       WHERE id = ? AND tenant_id = ?`,
      status, resolvedAt, inProgressAt, updatedNotes, req.params.id, tenantId,
    );
    ok(res, { updated: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// Requests — Analytics
//
// Implemented as DB-agnostic JS aggregation rather than dialect-specific SQL,
// because this codebase runs on both Postgres and SQLite, and `request_types`
// is stored as a JSON text column (not a Postgres array). Status `open` in the
// analytics contract maps to this codebase's `pending` status.
// ---------------------------------------------------------------------------

interface ReqRow {
  request_type: string;
  description: string | null;
  status: string;
  department: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

// Parse a stored timestamp (ISO `…Z` from new Date().toISOString(), or the
// SQLite CURRENT_TIMESTAMP form `YYYY-MM-DD HH:MM:SS` in UTC) to epoch ms.
function tsToMs(s: string | null | undefined): number | null {
  if (!s) return null;
  let v = s.includes('T') ? s : s.replace(' ', 'T');
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(v)) v += 'Z';
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

// UTC day key `YYYY-MM-DD` for a stored timestamp.
function dayKey(s: string): string {
  const ms = tsToMs(s);
  return ms === null ? '' : new Date(ms).toISOString().slice(0, 10);
}

function resolutionMinutes(r: ReqRow): number | null {
  const start = tsToMs(r.created_at);
  const end = tsToMs(r.resolved_at);
  if (start === null || end === null) return null;
  return (end - start) / 60000;
}

function round(n: number): number { return Math.round(n); }

// Build a request_type -> target response time (minutes) lookup from active
// departments, matching how requests are routed (request_types JSON includes).
async function loadDeptTargets(tenantId: string): Promise<{
  byType: Map<string, number>;
  byName: Map<string, number>;
}> {
  const depts = await dbAll(
    `SELECT name, request_types, response_time_minutes FROM hotel_departments WHERE tenant_id = ? AND is_active = 1`,
    tenantId,
  ) as any[];
  const byType = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const d of depts) {
    const target = Number(d.response_time_minutes) || 30;
    byName.set(d.name, target);
    let types: string[] = [];
    try { types = typeof d.request_types === 'string' ? JSON.parse(d.request_types) : (d.request_types || []); }
    catch { types = []; }
    for (const t of types) if (!byType.has(t)) byType.set(t, target);
  }
  return { byType, byName };
}

function targetFor(r: ReqRow, t: { byType: Map<string, number>; byName: Map<string, number> }): number {
  return t.byType.get(r.request_type) ?? (r.department ? t.byName.get(r.department) : undefined) ?? 30;
}

// Fetch all of a tenant's requests once; period filtering happens in JS so the
// mixed timestamp formats above are compared as numbers, not strings.
async function loadRequests(tenantId: string): Promise<ReqRow[]> {
  return await dbAll(
    `SELECT request_type, description, status, department, created_at, resolved_at, resolved_by
       FROM hotel_requests WHERE tenant_id = ?`,
    tenantId,
  ) as unknown as ReqRow[];
}

function parseDays(req: Request): number {
  const d = parseInt(String(req.query.days), 10);
  return [7, 30, 90].includes(d) ? d : 7;
}

// GET /hotel/requests/analytics/summary?days=7|30|90
hotelRouter.get('/requests/analytics/summary', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const days = parseDays(req);
  try {
    const all = await loadRequests(tenantId);
    const targets = await loadDeptTargets(tenantId);
    const now = Date.now();
    const periodMs = days * 86400000;
    const curStart = now - periodMs;
    const prevStart = now - periodMs * 2;

    const inRange = (r: ReqRow, from: number, to: number) => {
      const c = tsToMs(r.created_at);
      return c !== null && c >= from && c < to;
    };

    const cur = all.filter(r => inRange(r, curStart, now));
    const prev = all.filter(r => inRange(r, prevStart, curStart));

    const total = cur.length;
    const open = cur.filter(r => r.status === 'pending').length;
    const in_progress = cur.filter(r => r.status === 'in_progress').length;
    const resolved = cur.filter(r => r.status === 'resolved').length;

    const curResMins = cur.map(resolutionMinutes).filter((m): m is number => m !== null);
    const avg_resolution_minutes = curResMins.length
      ? round(curResMins.reduce((a, b) => a + b, 0) / curResMins.length)
      : null;

    const prevResMins = prev.map(resolutionMinutes).filter((m): m is number => m !== null);
    const prev_avg_resolution_minutes = prevResMins.length
      ? round(prevResMins.reduce((a, b) => a + b, 0) / prevResMins.length)
      : null;

    const sla_breached = cur.filter(r => {
      const m = resolutionMinutes(r);
      return m !== null && m > targetFor(r, targets);
    }).length;

    ok(res, {
      total,
      open,
      in_progress,
      resolved,
      avg_resolution_minutes,
      prev_avg_resolution_minutes,
      sla_breached,
    });
  } catch (e: any) { err(res, e.message, 500); }
});

// GET /hotel/requests/analytics/breakdown?days=7|30|90
hotelRouter.get('/requests/analytics/breakdown', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const days = parseDays(req);
  try {
    const all = await loadRequests(tenantId);
    const cutoff = Date.now() - days * 86400000;
    const cur = all.filter(r => { const c = tsToMs(r.created_at); return c !== null && c >= cutoff; });

    const tally = (rows: ReqRow[], key: (r: ReqRow) => string | null) => {
      const m = new Map<string, number>();
      for (const r of rows) {
        const k = key(r);
        if (k == null || k === '') continue;
        m.set(k, (m.get(k) || 0) + 1);
      }
      return m;
    };
    const sortedRows = (m: Map<string, number>, label: string) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, count]) => ({ [label]: k, count }));

    const by_type = sortedRows(tally(cur, r => r.request_type), 'request_type');
    const by_dept = sortedRows(tally(cur, r => r.department), 'department');
    const by_status = [...tally(cur, r => r.status).entries()].map(([status, count]) => ({ status, count }));
    const top_issues = sortedRows(tally(cur, r => r.description), 'description').slice(0, 5);

    // Daily — created per day + resolved (created in window and now resolved)
    const dailyMap = new Map<string, { created: number; resolved: number }>();
    for (const r of cur) {
      const day = dayKey(r.created_at);
      if (!day) continue;
      const d = dailyMap.get(day) || { created: 0, resolved: 0 };
      d.created += 1;
      if (r.status === 'resolved') d.resolved += 1;
      dailyMap.set(day, d);
    }
    const daily = [...dailyMap.entries()]
      .sort((a, b) => a[0] < b[0] ? -1 : 1)
      .map(([day, v]) => ({ day, created: v.created, resolved: v.resolved }));

    // Hourly distribution (UTC hour of created_at)
    const hourMap = new Map<number, number>();
    for (const r of cur) {
      const ms = tsToMs(r.created_at);
      if (ms === null) continue;
      const h = new Date(ms).getUTCHours();
      hourMap.set(h, (hourMap.get(h) || 0) + 1);
    }
    const hourly = [...hourMap.entries()].sort((a, b) => a[0] - b[0]).map(([hour, count]) => ({ hour, count }));

    ok(res, { by_type, by_dept, daily, hourly, top_issues, by_status });
  } catch (e: any) { err(res, e.message, 500); }
});

// GET /hotel/requests/analytics/resolution?days=7|30|90
hotelRouter.get('/requests/analytics/resolution', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const days = parseDays(req);
  try {
    const all = await loadRequests(tenantId);
    const targets = await loadDeptTargets(tenantId);
    const cutoff = Date.now() - days * 86400000;
    const cur = all.filter(r => { const c = tsToMs(r.created_at); return c !== null && c >= cutoff; });

    // By department — avg resolution time, counts, target
    const deptMap = new Map<string, { mins: number[]; resolved: number; total: number; targets: number[] }>();
    for (const r of cur) {
      const dep = r.department || 'unknown';
      const d = deptMap.get(dep) || { mins: [], resolved: 0, total: 0, targets: [] };
      d.total += 1;
      d.targets.push(targetFor(r, targets));
      const m = resolutionMinutes(r);
      if (m !== null) { d.mins.push(m); d.resolved += 1; }
      deptMap.set(dep, d);
    }
    const by_dept = [...deptMap.entries()]
      .filter(([, v]) => v.mins.length > 0)
      .map(([department, v]) => ({
        department,
        avg_minutes: round(v.mins.reduce((a, b) => a + b, 0) / v.mins.length),
        resolved_count: v.resolved,
        total_count: v.total,
        // Most common per-request target within the department group
        target_minutes: mode(v.targets),
      }))
      .sort((a, b) => b.avg_minutes - a.avg_minutes);

    // Resolution time trend — daily average over requests created that day
    const trendMap = new Map<string, number[]>();
    for (const r of cur) {
      const m = resolutionMinutes(r);
      if (m === null) continue;
      const day = dayKey(r.created_at);
      if (!day) continue;
      const arr = trendMap.get(day) || [];
      arr.push(m);
      trendMap.set(day, arr);
    }
    const trend = [...trendMap.entries()]
      .sort((a, b) => a[0] < b[0] ? -1 : 1)
      .map(([day, mins]) => ({ day, avg_minutes: round(mins.reduce((a, b) => a + b, 0) / mins.length) }));

    // Staff performance — keyed by resolved_by (mapped to staff name) + department
    const blocked = await dbAll(
      `SELECT phone, staff_name FROM hotel_blocked_numbers WHERE tenant_id = ?`,
      tenantId,
    ) as any[];
    const staffNames = new Map<string, string>();
    for (const b of blocked) if (b.staff_name) staffNames.set(b.phone, b.staff_name);

    const staffMap = new Map<string, { staff_name: string; department: string; mins: number[]; count: number }>();
    for (const r of cur) {
      const m = resolutionMinutes(r);
      if (m === null || !r.resolved_by) continue;
      const name = staffNames.get(r.resolved_by) || r.resolved_by || 'Dashboard';
      const dep = r.department || 'unknown';
      const key = `${name}__${dep}`;
      const s = staffMap.get(key) || { staff_name: name, department: dep, mins: [], count: 0 };
      s.mins.push(m);
      s.count += 1;
      staffMap.set(key, s);
    }
    const staff_perf = [...staffMap.values()]
      .map(s => ({
        staff_name: s.staff_name,
        department: s.department,
        resolved_count: s.count,
        total_count: s.count,
        avg_minutes: round(s.mins.reduce((a, b) => a + b, 0) / s.mins.length),
      }))
      .sort((a, b) => b.resolved_count - a.resolved_count)
      .slice(0, 10);

    ok(res, { by_dept, trend, staff_perf });
  } catch (e: any) { err(res, e.message, 500); }
});

function mode(nums: number[]): number {
  if (!nums.length) return 30;
  const counts = new Map<number, number>();
  let best = nums[0], bestC = 0;
  for (const n of nums) {
    const c = (counts.get(n) || 0) + 1;
    counts.set(n, c);
    if (c > bestC) { bestC = c; best = n; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Guests
// ---------------------------------------------------------------------------

// GET /hotel/guests
hotelRouter.get('/guests', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      `SELECT * FROM hotel_guest_stays WHERE tenant_id = ? AND status = 'checked_in' ORDER BY room_number`,
      tenantId,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /hotel/guests/checkin
hotelRouter.post('/guests/checkin', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { room_number, guest_name, guest_phone, check_in, check_out } = req.body as {
    room_number: string; guest_name: string; guest_phone: string;
    check_in: string; check_out: string;
  };
  if (!room_number || !guest_name || !guest_phone || !check_in || !check_out) {
    return err(res, 'room_number, guest_name, guest_phone, check_in, check_out are required');
  }
  try {
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO hotel_guest_stays
         (id, tenant_id, room_number, guest_name, guest_phone, check_in, check_out)
       VALUES (?,?,?,?,?,?,?)`,
      id, tenantId, room_number, guest_name, guest_phone, check_in, check_out,
    );
    const row = await dbGet('SELECT * FROM hotel_guest_stays WHERE id = ?', id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

// PATCH /hotel/guests/:id/checkout
hotelRouter.patch('/guests/:id/checkout', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun(
      `UPDATE hotel_guest_stays SET status = 'checked_out' WHERE id = ? AND tenant_id = ?`,
      req.params.id, tenantId,
    );
    ok(res, { checked_out: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /hotel/guests/:id/checkout-survey
// Marks guest as checked_out and immediately sends a 1-10 satisfaction survey via WhatsApp
hotelRouter.post('/guests/:id/checkout-survey', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    // Load guest + tenant — works for both checked_in and checked_out guests
    // (staff may check out via the Guests tab first, then send the survey separately)
    const guest = await dbGet(
      `SELECT gs.*, t.whatsapp_number, t.provider, t.twilio_account_sid, t.twilio_auth_token
       FROM hotel_guest_stays gs
       JOIN tenants t ON t.id = gs.tenant_id
       WHERE gs.id = ? AND gs.tenant_id = ?
         AND gs.status IN ('checked_in', 'checked_out')
         AND gs.survey_sent = 0`,
      req.params.id, tenantId,
    ) as any;

    if (!guest) return err(res, 'Guest not found or survey already sent', 404);

    // Load hotel config for hotel name
    const config = await dbGet('SELECT * FROM hotel_config WHERE tenant_id = ?', tenantId) as any;
    const hotelName = config?.hotel_name || 'our hotel';

    // Resolve the guest's actual phone number.
    // XLS-imported guests have guest_phone = '' — fall back to the conversation phone
    // matched by room_number, and also patch the stay so future lookups work.
    let guestPhone: string = guest.guest_phone ?? '';
    if (!guestPhone && guest.room_number) {
      const convForRoom = await dbGet(
        `SELECT guest_phone FROM hotel_conversations
         WHERE tenant_id = ? AND room_number = ?
         ORDER BY updated_at DESC LIMIT 1`,
        tenantId, guest.room_number,
      ) as any;
      if (convForRoom?.guest_phone) {
        guestPhone = convForRoom.guest_phone;
        // Patch the stay with the real phone so phone-based lookups work going forward
        await dbRun(
          `UPDATE hotel_guest_stays SET guest_phone = ? WHERE id = ? AND tenant_id = ?`,
          guestPhone, req.params.id, tenantId,
        );
      }
    }

    if (!guestPhone) return err(res, 'Cannot determine guest phone number — ask the guest to message the hotel first', 400);

    // Build survey message
    const surveyMessage = [
      `Thank you for staying with us at *${hotelName}*! 🏨`,
      ``,
      `We hope you had a wonderful stay.`,
      ``,
      `On a scale of *1 to 10*, how would you rate your experience with us?`,
      ``,
      `_(1 = very poor, 10 = exceptional)_`,
    ].join('\n');

    // ── Send WhatsApp FIRST — only update DB if the send succeeds ─────────────
    // (Prevents guests getting stuck as checked_out+survey_sent=1 with no message)
    const tenantObj = {
      id:                  tenantId,
      whatsapp_number:     guest.whatsapp_number,
      provider:            guest.provider,
      twilio_account_sid:  guest.twilio_account_sid,
      twilio_auth_token:   guest.twilio_auth_token,
    };
    await sendWhatsAppMessage(guestPhone, surveyMessage, tenantObj);

    // ── Now mark the stay as checked_out + survey_sent ────────────────────────
    const now = new Date().toISOString();
    if (guest.status === 'checked_in') {
      await dbRun(
        `UPDATE hotel_guest_stays
         SET status = 'checked_out', survey_sent = 1, survey_sent_at = ?
         WHERE id = ? AND tenant_id = ?`,
        now, req.params.id, tenantId,
      );
    } else {
      // Already checked_out (e.g. checked out via Guests tab) — just mark survey sent
      await dbRun(
        `UPDATE hotel_guest_stays
         SET survey_sent = 1, survey_sent_at = ?
         WHERE id = ? AND tenant_id = ?`,
        now, req.params.id, tenantId,
      );
    }

    // Log the survey message in hotel_conversations
    const convRow = await dbGet(
      'SELECT messages FROM hotel_conversations WHERE tenant_id = ? AND guest_phone = ?',
      tenantId, guestPhone,
    ) as any;

    if (convRow) {
      const msgs: any[] = Array.isArray(convRow.messages)
        ? convRow.messages
        : (() => { try { return JSON.parse(convRow.messages || '[]'); } catch { return []; } })();
      msgs.push({ role: 'assistant', content: surveyMessage, ts: now });
      await dbRun(
        'UPDATE hotel_conversations SET messages = ?, updated_at = ? WHERE tenant_id = ? AND guest_phone = ?',
        JSON.stringify(msgs), now, tenantId, guestPhone,
      );
    }

    ok(res, { checked_out: guest.status === 'checked_in', survey_sent: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /hotel/guests/import  — upload arrivals XLS/XLSX as base64 JSON body
hotelRouter.post('/guests/import', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { fileBase64 } = req.body as { fileBase64?: string };
  if (!fileBase64) return err(res, 'fileBase64 is required');

  try {
    const buffer = Buffer.from(fileBase64, 'base64');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });

    if (rows.length < 2) return err(res, 'File appears to have no data rows');

    // Expected columns (0-indexed):
    //  0: Arrival Date  1: Nights Staying  2: Room  3: Guest Name
    const dataRows = rows.slice(1).filter(r => r[3]);

    const guests = dataRows.map(row => {
      const arrivalStr  = String(row[0] ?? '').trim();
      const nights      = Math.max(1, parseInt(String(row[1] ?? '1'), 10) || 1);
      const roomRaw     = String(row[2] ?? '').trim();
      const guest_name  = String(row[3] ?? '').trim();

      // Room column: "Economy Double - 304" or "Deluxe Suite - 404Hotel Name"
      // Extract the trailing digits after the last " - "
      const roomMatch   = roomRaw.match(/ - (\d+)/);
      const room_number = roomMatch ? roomMatch[1] : roomRaw.replace(/\D/g, '').slice(0, 6);

      const checkIn  = new Date(arrivalStr);
      const checkOut = new Date(checkIn);
      checkOut.setDate(checkOut.getDate() + nights);

      const valid = !isNaN(checkIn.getTime()) && guest_name && room_number;
      return valid ? {
        guest_name,
        room_number,
        check_in:  checkIn.toISOString().slice(0, 10),
        check_out: checkOut.toISOString().slice(0, 10),
      } : null;
    }).filter(Boolean) as { guest_name: string; room_number: string; check_in: string; check_out: string }[];

    if (!guests.length) return err(res, 'No valid guest rows found in file');

    // Wipe all existing checked-in guests for this tenant, then replace
    await dbRun(`DELETE FROM hotel_guest_stays WHERE tenant_id = ? AND status = 'checked_in'`, tenantId);

    for (const g of guests) {
      await dbRun(
        `INSERT INTO hotel_guest_stays (id, tenant_id, room_number, guest_name, guest_phone, check_in, check_out)
         VALUES (?,?,?,?,?,?,?)`,
        crypto.randomUUID(), tenantId, g.room_number, g.guest_name, '', g.check_in, g.check_out,
      );
    }

    ok(res, { imported: guests.length });
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// GET /hotel/config
hotelRouter.get('/config', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const [row, tenantRow] = await Promise.all([
      dbGet('SELECT * FROM hotel_config WHERE tenant_id = ?', tenantId),
      dbGet('SELECT reviews_enabled, survey_enabled, menus_enabled, whatsapp_number, whatsapp_connected_at FROM tenants WHERE id = ?', tenantId),
    ]);
    ok(res, {
      ...(row || {}),
      tenant_id:       tenantId,
      reviews_enabled: (tenantRow as any)?.reviews_enabled ?? 0,
      survey_enabled:  (tenantRow as any)?.survey_enabled  ?? 0,
      menus_enabled:   (tenantRow as any)?.menus_enabled   ?? 0,
      whatsapp_number: (tenantRow as any)?.whatsapp_number || null,
      whatsapp_connected_at: (tenantRow as any)?.whatsapp_connected_at || null,
    });
  } catch (e: any) { err(res, e.message, 500); }
});

// PUT /hotel/config
hotelRouter.put('/config', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const {
    hotel_name, check_in_time = '14:00', check_out_time = '11:00',
    wifi_password = null, breakfast_hours = null, pool_hours = null,
    restaurant_hours = null, reception_phone = null, emergency_phone = null,
    location_url = null, menu_url = null,
    ask_guest_identity = 1,
    message_forward = 1,
    review_platform_url = null,
    review_platform_name = 'Booking.com',
    survey_positive_threshold = 8,
    survey_negative_message = null,
    survey_positive_message = null,
    front_office_phone = null,
    fallback_message = null,
    ask_maintenance_photo = 1,
    add_conversation_to_faq_enabled = 0,
  } = req.body;

  if (!hotel_name) return err(res, 'hotel_name is required');

  try {
    await dbRun(
      `INSERT INTO hotel_config
         (tenant_id, hotel_name, check_in_time, check_out_time, wifi_password,
          breakfast_hours, pool_hours, restaurant_hours, reception_phone, emergency_phone,
          location_url, menu_url, ask_guest_identity, message_forward,
          review_platform_url, review_platform_name, survey_positive_threshold,
          survey_negative_message, survey_positive_message,
          front_office_phone, fallback_message, ask_maintenance_photo,
          add_conversation_to_faq_enabled)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (tenant_id) DO UPDATE SET
         hotel_name = excluded.hotel_name,
         check_in_time = excluded.check_in_time,
         check_out_time = excluded.check_out_time,
         wifi_password = excluded.wifi_password,
         breakfast_hours = excluded.breakfast_hours,
         pool_hours = excluded.pool_hours,
         restaurant_hours = excluded.restaurant_hours,
         reception_phone = excluded.reception_phone,
         emergency_phone = excluded.emergency_phone,
         location_url = excluded.location_url,
         menu_url = excluded.menu_url,
         ask_guest_identity = excluded.ask_guest_identity,
         message_forward = excluded.message_forward,
         review_platform_url = excluded.review_platform_url,
         review_platform_name = excluded.review_platform_name,
         survey_positive_threshold = excluded.survey_positive_threshold,
         survey_negative_message = COALESCE(excluded.survey_negative_message, hotel_config.survey_negative_message),
         survey_positive_message = COALESCE(excluded.survey_positive_message, hotel_config.survey_positive_message),
         front_office_phone = excluded.front_office_phone,
         fallback_message = excluded.fallback_message,
         ask_maintenance_photo = excluded.ask_maintenance_photo,
         add_conversation_to_faq_enabled = excluded.add_conversation_to_faq_enabled`,
      tenantId, hotel_name, check_in_time, check_out_time, wifi_password,
      breakfast_hours, pool_hours, restaurant_hours, reception_phone, emergency_phone,
      location_url, menu_url, ask_guest_identity ? 1 : 0, message_forward ? 1 : 0,
      review_platform_url, review_platform_name,
      Number(survey_positive_threshold) || 8,
      survey_negative_message || null,
      survey_positive_message || null,
      front_office_phone || null,
      fallback_message || null,
      ask_maintenance_photo ? 1 : 0,
      add_conversation_to_faq_enabled ? 1 : 0,
    );
    ok(res, { updated: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

// GET /hotel/faq
hotelRouter.get('/faq', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      `SELECT * FROM hotel_faq WHERE tenant_id = ? ORDER BY category, question`,
      tenantId,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /hotel/faq
hotelRouter.post('/faq', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { question, answer, category } = req.body as {
    question: string; answer: string; category: string;
  };
  if (!question || !answer || !category) {
    return err(res, 'question, answer, and category are required');
  }
  try {
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO hotel_faq (id, tenant_id, question, answer, category) VALUES (?,?,?,?,?)`,
      id, tenantId, question, answer, category,
    );
    const row = await dbGet('SELECT * FROM hotel_faq WHERE id = ?', id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

// PUT /hotel/faq/:id
hotelRouter.put('/faq/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { question, answer, category } = req.body as {
    question: string; answer: string; category: string;
  };
  if (!question || !answer || !category)
    return err(res, 'question, answer and category are required');
  try {
    await dbRun(
      'UPDATE hotel_faq SET question = ?, answer = ?, category = ? WHERE id = ? AND tenant_id = ?',
      question, answer, category, req.params.id, tenantId,
    );
    const row = await dbGet('SELECT * FROM hotel_faq WHERE id = ?', req.params.id);
    ok(res, row);
  } catch (e: any) { err(res, e.message, 500); }
});

// DELETE /hotel/faq/:id
hotelRouter.delete('/faq/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun(
      'DELETE FROM hotel_faq WHERE id = ? AND tenant_id = ?',
      req.params.id, tenantId,
    );
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

const REQUEST_TYPES = ['room_service', 'housekeeping', 'maintenance', 'concierge_question', 'complaint', 'other'];

// GET /hotel/departments
hotelRouter.get('/departments', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      `SELECT * FROM hotel_departments WHERE tenant_id = ? ORDER BY name`,
      tenantId,
    ) as any[];
    // Parse request_types JSON string for each row
    ok(res, rows.map(r => ({ ...r, request_types: JSON.parse(r.request_types || '[]') })));
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /hotel/departments
hotelRouter.post('/departments', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const {
    name, whatsapp, request_types, response_time_minutes, language,
    scheduling_enabled = 0, after_hours_message = null, confirmation_mode = 'with_estimate',
  } = req.body as {
    name: string; whatsapp: string; request_types: string[];
    response_time_minutes?: number; language?: string;
    scheduling_enabled?: number; after_hours_message?: string | null;
    confirmation_mode?: string;
  };
  if (!name || !whatsapp || !Array.isArray(request_types) || !request_types.length) {
    return err(res, 'name, whatsapp, and request_types are required');
  }
  const invalid = request_types.filter(t => !REQUEST_TYPES.includes(t));
  if (invalid.length) return err(res, `Invalid request types: ${invalid.join(', ')}`);

  try {
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO hotel_departments
         (id, tenant_id, name, whatsapp, request_types, response_time_minutes, language, scheduling_enabled, after_hours_message, confirmation_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      id, tenantId, name, whatsapp, JSON.stringify(request_types),
      Number(response_time_minutes) || 30, language || 'en',
      scheduling_enabled ? 1 : 0, after_hours_message || null,
      confirmation_mode === 'notify_only' ? 'notify_only' : 'with_estimate',
    );
    const row = await dbGet('SELECT * FROM hotel_departments WHERE id = ?', id) as any;
    ok(res, { ...row, request_types: JSON.parse(row.request_types || '[]') });
  } catch (e: any) { err(res, e.message, 500); }
});

// PUT /hotel/departments/:id
hotelRouter.put('/departments/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const {
    name, whatsapp, request_types, is_active, response_time_minutes, language,
    scheduling_enabled = 0, after_hours_message = null, confirmation_mode = 'with_estimate',
  } = req.body as {
    name: string; whatsapp: string; request_types: string[];
    is_active?: boolean; response_time_minutes?: number; language?: string;
    scheduling_enabled?: number; after_hours_message?: string | null;
    confirmation_mode?: string;
  };
  if (!name || !whatsapp || !Array.isArray(request_types) || !request_types.length) {
    return err(res, 'name, whatsapp, and request_types are required');
  }
  try {
    await dbRun(
      `UPDATE hotel_departments
       SET name = ?, whatsapp = ?, request_types = ?, is_active = ?,
           response_time_minutes = ?, language = ?,
           scheduling_enabled = ?, after_hours_message = ?, confirmation_mode = ?
       WHERE id = ? AND tenant_id = ?`,
      name, whatsapp, JSON.stringify(request_types),
      is_active === false ? 0 : 1,
      Number(response_time_minutes) || 30, language || 'en',
      scheduling_enabled ? 1 : 0, after_hours_message || null,
      confirmation_mode === 'notify_only' ? 'notify_only' : 'with_estimate',
      req.params.id, tenantId,
    );
    ok(res, { updated: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// GET /hotel/departments/:id/schedules
hotelRouter.get('/departments/:id/schedules', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      `SELECT * FROM hotel_department_schedules
       WHERE department_id = ? AND tenant_id = ?
       ORDER BY display_order ASC, start_time ASC`,
      req.params.id, tenantId,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

// PUT /hotel/departments/:id/schedules  — full replace (send all windows)
hotelRouter.put('/departments/:id/schedules', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const deptId   = req.params.id;
  const { schedules } = req.body as {
    schedules: Array<{
      id?: string;
      day_type: string;
      start_time: string;
      end_time: string;
      response_time_minutes: number;
      display_order?: number;
    }>;
  };
  if (!Array.isArray(schedules)) return err(res, 'schedules array is required');

  // Validate day_type values
  const VALID_DAY_TYPES = ['weekday', 'weekend', 'both'];
  for (const s of schedules) {
    if (!VALID_DAY_TYPES.includes(s.day_type))
      return err(res, `Invalid day_type: ${s.day_type}`);
    if (!s.start_time || !s.end_time)
      return err(res, 'start_time and end_time are required for each schedule');
  }

  try {
    // Delete existing windows for this department
    await dbRun(
      'DELETE FROM hotel_department_schedules WHERE department_id = ? AND tenant_id = ?',
      deptId, tenantId,
    );

    // Insert all new windows
    for (let i = 0; i < schedules.length; i++) {
      const s = schedules[i];
      const windowId = s.id || crypto.randomUUID();
      await dbRun(
        `INSERT INTO hotel_department_schedules
           (id, department_id, tenant_id, day_type, start_time, end_time, response_time_minutes, display_order)
         VALUES (?,?,?,?,?,?,?,?)`,
        windowId, deptId, tenantId,
        s.day_type, s.start_time, s.end_time,
        Number(s.response_time_minutes) || 30,
        s.display_order ?? i,
      );
    }

    ok(res, { saved: schedules.length });
  } catch (e: any) { err(res, e.message, 500); }
});

// DELETE /hotel/departments/:id
hotelRouter.delete('/departments/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun(
      'DELETE FROM hotel_departments WHERE id = ? AND tenant_id = ?',
      req.params.id, tenantId,
    );
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// Blocked numbers — staff, suppliers, internal lines
// ---------------------------------------------------------------------------

// GET /hotel/blocked
hotelRouter.get('/blocked', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      `SELECT * FROM hotel_blocked_numbers WHERE tenant_id = ? ORDER BY label`,
      tenantId,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /hotel/blocked
hotelRouter.post('/blocked', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { phone, label, staff_name, staff_role, is_staff } = req.body as {
    phone: string; label?: string;
    staff_name?: string; staff_role?: string; is_staff?: boolean;
  };
  if (!phone) return err(res, 'phone is required');
  // Normalise — store with whatsapp: prefix for consistent lookup
  const normalised = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
  try {
    await dbRun(
      `INSERT INTO hotel_blocked_numbers (tenant_id, phone, label, staff_name, staff_role, is_staff)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT (tenant_id, phone) DO UPDATE SET
         label      = excluded.label,
         staff_name = excluded.staff_name,
         staff_role = excluded.staff_role,
         is_staff   = excluded.is_staff`,
      tenantId, normalised, label ?? null,
      staff_name ?? null, staff_role ?? null, is_staff === false ? 0 : 1,
    );
    ok(res, { blocked: true, phone: normalised });
  } catch (e: any) { err(res, e.message, 500); }
});

// DELETE /hotel/blocked/:phone
hotelRouter.delete('/blocked/:phone', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const phone = decodeURIComponent(req.params.phone);
  const normalised = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
  try {
    await dbRun(
      `DELETE FROM hotel_blocked_numbers WHERE tenant_id = ? AND (phone = ? OR phone = ?)`,
      tenantId, phone, normalised,
    );
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// Conversations — guest inbox
// ---------------------------------------------------------------------------

// GET /hotel/conversations  — inbox list, most recent first
// Optional ?channel=whatsapp|instagram|email server-side filter
hotelRouter.get('/conversations', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const tenantType = await getTenantType(tenantId);
    const table = getConversationsTable(tenantType);

    const channelFilter = req.query.channel as string | undefined;
    const channelClause = channelFilter
      ? (channelFilter === 'whatsapp'
          ? ' AND (c.channel IS NULL OR c.channel = ?)'
          : ' AND c.channel = ?')
      : '';
    const params: unknown[] = [tenantId];
    if (channelFilter) params.push(channelFilter);

    let rows: any[];

    if (table === 'hotel_conversations') {
      rows = await dbAll(
        `SELECT
           c.id,
           c.guest_phone,
           c.room_number,
           c.messages,
           c.last_message,
           c.updated_at,
           c.last_guest_message_at,
           c.ai_paused_until,
           c.ai_paused_by,
           c.channel,
           c.channel_user_id,
           c.guest_username,
           g.id           AS stay_id,
           COALESCE(g.guest_name, c.guest_name) AS guest_name,
           g.check_in,
           g.check_out,
           g.status       AS guest_status,
           g.survey_sent,
           g.survey_score,
           em.subject      AS email_subject,
           em.from_address AS email_from_address,
           em.from_name    AS email_from_name
         FROM hotel_conversations c
         LEFT JOIN hotel_guest_stays g
           ON g.id = (
             SELECT id FROM hotel_guest_stays
             WHERE tenant_id = c.tenant_id
               AND (
                 (guest_phone != '' AND guest_phone = c.guest_phone)
                 OR (guest_phone = '' AND c.room_number IS NOT NULL AND c.room_number != '' AND room_number = c.room_number)
               )
             ORDER BY
               CASE WHEN guest_phone != '' AND guest_phone = c.guest_phone THEN 0 ELSE 1 END,
               created_at DESC
             LIMIT 1
           )
         LEFT JOIN email_messages em ON c.channel = 'email' AND em.id = (
           SELECT id FROM email_messages
           WHERE conversation_id = c.id AND direction = 'inbound'
           ORDER BY created_at ASC LIMIT 1
         )
         WHERE c.tenant_id = ?${channelClause}
         ORDER BY c.updated_at DESC
         LIMIT 100`,
        ...params,
      ) as any[];
    } else {
      rows = await dbAll(
        `SELECT
           c.id,
           c.guest_phone,
           c.messages,
           c.last_message,
           c.updated_at,
           c.last_guest_message_at,
           c.ai_paused_until,
           c.ai_paused_by,
           c.channel,
           c.channel_user_id,
           c.guest_username,
           c.guest_name
         FROM ${table} c
         WHERE c.tenant_id = ?${channelClause}
         ORDER BY c.updated_at DESC
         LIMIT 100`,
        ...params,
      ) as any[];
    }

    const parseMessages = (raw: any): any[] => {
      if (Array.isArray(raw)) return raw;
      try { return JSON.parse(raw || '[]'); } catch { return []; }
    };

    const result = rows.map((r: any) => {
      const msgs = parseMessages(r.messages);
      const lastMsg = msgs[msgs.length - 1] ?? null;
      return {
        ...r,
        messages: undefined,
        last_message_preview: lastMsg,
        message_count: msgs.length,
        survey_sent: !!r.survey_sent,
      };
    });

    console.log(`[Conversations] Found ${result.length} for tenant ${tenantId} (type: ${tenantType}, table: ${table})`);
    ok(res, result);
  } catch (e: any) { err(res, e.message, 500); }
});

// GET /hotel/conversations/:phone  — full thread for one guest
hotelRouter.get('/conversations/:phone', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const phone = decodeURIComponent(req.params.phone);
  try {
    const tenantType = await getTenantType(tenantId);
    const table = getConversationsTable(tenantType);

    let row: any;
    if (table === 'hotel_conversations') {
      row = await dbGet(
        `SELECT
           c.*,
           g.id           AS stay_id,
           COALESCE(g.guest_name, c.guest_name) AS guest_name,
           g.check_in,
           g.check_out,
           g.status       AS guest_status,
           g.survey_sent,
           g.survey_score
         FROM hotel_conversations c
         LEFT JOIN hotel_guest_stays g
           ON g.id = (
             SELECT id FROM hotel_guest_stays
             WHERE tenant_id = c.tenant_id
               AND (
                 (guest_phone != '' AND guest_phone = c.guest_phone)
                 OR (guest_phone = '' AND c.room_number IS NOT NULL AND c.room_number != '' AND room_number = c.room_number)
               )
             ORDER BY
               CASE WHEN guest_phone != '' AND guest_phone = c.guest_phone THEN 0 ELSE 1 END,
               created_at DESC
             LIMIT 1
           )
         WHERE c.tenant_id = ? AND c.guest_phone = ?`,
        tenantId, phone,
      ) as any;
    } else {
      row = await dbGet(
        `SELECT * FROM ${table} WHERE tenant_id = ? AND guest_phone = ?`,
        tenantId, phone,
      ) as any;
    }

    if (!row) return ok(res, null);
    const parseMessages = (raw: any): any[] => {
      if (Array.isArray(raw)) return raw;
      try { return JSON.parse(raw || '[]'); } catch { return []; }
    };
    ok(res, {
      ...row,
      messages: parseMessages(row.messages),
      survey_sent: !!row.survey_sent,
    });
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /hotel/conversations/:id/reply  — staff sends manual message (WhatsApp or Instagram)
hotelRouter.post('/conversations/:id/reply', requireAuth, async (req: Request, res: Response) => {
  console.log('[Hotel Reply] Request received for conversation:', req.params.id);
  const tenantId = resolveTenantId(req);
  const convId   = req.params.id;
  const { message } = req.body as { message: string };

  if (!message?.trim()) return err(res, 'message is required');

  try {
    const tenantType = await getTenantType(tenantId);
    const table = getConversationsTable(tenantType);

    const conv = await dbGet(
      `SELECT channel, channel_user_id, guest_phone FROM ${table} WHERE tenant_id = ? AND (id = ? OR guest_phone = ?) LIMIT 1`,
      tenantId, convId, convId,
    ) as any;

    if (!conv) return err(res, 'Conversation not found', 404);

    if (conv.channel === 'instagram') {
      const cs = await dbGet(
        'SELECT access_token FROM hotel_channel_settings WHERE tenant_id = ? AND channel = ?',
        tenantId, 'instagram',
      ) as any;
      const accessToken = cs?.access_token;
      if (!accessToken) return err(res, 'No Instagram access token configured');
      await sendInstagramMessage(conv.channel_user_id, message.trim(), accessToken);

      // Append staff message to DB without relying on in-memory session
      // (Instagram conversations have no warm session — in-memory would be empty and overwrite history)
      const staffMsg = { role: 'staff', content: message.trim(), ts: new Date().toISOString() };
      if (isPg) {
        await dbRun(
          `UPDATE hotel_conversations
           SET messages     = messages || ?::jsonb,
               last_message = CURRENT_TIMESTAMP,
               updated_at   = CURRENT_TIMESTAMP
           WHERE tenant_id = ? AND guest_phone = ?`,
          JSON.stringify([staffMsg]), tenantId, conv.guest_phone,
        );
      } else {
        const convRow = await dbGet(
          'SELECT messages FROM hotel_conversations WHERE tenant_id = ? AND guest_phone = ?',
          tenantId, conv.guest_phone,
        ) as any;
        const prev: any[] = (() => { try { return JSON.parse(convRow?.messages ?? '[]'); } catch { return []; } })();
        await dbRun(
          `UPDATE hotel_conversations
           SET messages     = ?,
               last_message = CURRENT_TIMESTAMP,
               updated_at   = CURRENT_TIMESTAMP
           WHERE tenant_id = ? AND guest_phone = ?`,
          JSON.stringify([...prev, staffMsg].slice(-30)), tenantId, conv.guest_phone,
        );
      }
    } else if (conv.channel === 'email') {
      // Email — send via the tenant's email adapter, thread correctly
      const emailAccount = await dbGet(
        `SELECT * FROM tenant_email_accounts WHERE tenant_id = ? AND is_enabled ORDER BY created_at ASC LIMIT 1`,
        tenantId,
      ) as EmailAccountRow | undefined;
      if (!emailAccount) return err(res, 'No enabled email account configured for this tenant');

      const lastInbound = await dbGet(
        `SELECT rfc822_message_id, references_header, subject
         FROM email_messages
         WHERE conversation_id = ? AND direction = 'inbound'
         ORDER BY created_at DESC LIMIT 1`,
        convId,
      ) as any;
      if (!lastInbound) return err(res, 'No inbound email messages found to reply to');

      const adapter = emailAccount.provider === 'graph'
        ? new GraphAdapter(emailAccount)
        : new ImapSmtpAdapter(emailAccount);

      await adapter.connect();
      try {
        const referencesChain = [lastInbound.references_header, lastInbound.rfc822_message_id]
          .filter(Boolean).join(' ');
        const replySubject = lastInbound.subject.startsWith('Re:')
          ? lastInbound.subject
          : `Re: ${lastInbound.subject}`;

        const sendResult = await adapter.sendReply({
          to:                 { address: conv.guest_phone },
          from:               { address: emailAccount.email_address, name: emailAccount.display_name },
          subject:            replySubject,
          bodyText:           message.trim(),
          inReplyToMessageId: lastInbound.rfc822_message_id,
          referencesChain,
        });

        if (!adapter.capabilities.autoSavesSent && sendResult.rawMime) {
          try { await adapter.appendToSent(sendResult.rawMime, new Date()); } catch (e: any) {
            console.warn(`[Email] appendToSent failed (non-fatal): ${e.message}`);
          }
        }

        // Write outbound email_messages row
        await dbRun(
          `INSERT INTO email_messages
             (id, tenant_id, account_id, conversation_id, direction, rfc822_message_id,
              in_reply_to, references_header, from_address, from_name, to_address, subject, body_text, sent_message_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          crypto.randomUUID(), tenantId, emailAccount.id, convId, 'outbound',
          sendResult.sentMessageId,
          lastInbound.rfc822_message_id, referencesChain,
          emailAccount.email_address, emailAccount.display_name,
          conv.guest_phone, replySubject,
          message.trim(), sendResult.sentMessageId,
        );

        // Append staff message to hotel_conversations.messages JSONB
        const staffEmailMsg = {
          role: 'staff',
          content: message.trim(),
          subject: lastInbound.subject,
          ts: new Date().toISOString(),
          channel: 'email',
          from: emailAccount.email_address,
        };
        if (isPg) {
          await dbRun(
            `UPDATE hotel_conversations
             SET messages = messages || ?::jsonb,
                 last_message = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            JSON.stringify([staffEmailMsg]), convId,
          );
        } else {
          const convRow2 = await dbGet('SELECT messages FROM hotel_conversations WHERE id = ?', convId) as any;
          const prev: any[] = (() => { try { return JSON.parse(convRow2?.messages ?? '[]'); } catch { return []; } })();
          await dbRun(
            `UPDATE hotel_conversations
             SET messages = ?,
                 last_message = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            JSON.stringify([...prev, staffEmailMsg].slice(-200)), convId,
          );
        }
      } finally {
        await adapter.disconnect().catch(() => {});
      }

    } else {
      // WhatsApp — get full tenant row for per-tenant credentials
      const tenantRow = await dbGet('SELECT * FROM tenants WHERE id = ?', tenantId) as any;
      if (!tenantRow) return err(res, 'Tenant not found', 404);
      await sendWhatsAppMessage(conv.guest_phone, message.trim(), tenantRow);

      if (table === 'hotel_conversations') {
        await appendStaffMessage(tenantId, conv.guest_phone, message.trim());
      } else {
        const staffMsg = { role: 'staff', content: message.trim(), ts: new Date().toISOString() };
        if (isPg) {
          await dbRun(
            `UPDATE ${table}
             SET messages     = messages || ?::jsonb,
                 last_message = CURRENT_TIMESTAMP,
                 updated_at   = CURRENT_TIMESTAMP
             WHERE tenant_id = ? AND guest_phone = ?`,
            JSON.stringify([staffMsg]), tenantId, conv.guest_phone,
          );
        } else {
          const convRow = await dbGet(
            `SELECT messages FROM ${table} WHERE tenant_id = ? AND guest_phone = ?`,
            tenantId, conv.guest_phone,
          ) as any;
          const prev: any[] = (() => { try { return JSON.parse(convRow?.messages ?? '[]'); } catch { return []; } })();
          await dbRun(
            `UPDATE ${table}
             SET messages     = ?,
                 last_message = CURRENT_TIMESTAMP,
                 updated_at   = CURRENT_TIMESTAMP
             WHERE tenant_id = ? AND guest_phone = ?`,
            JSON.stringify([...prev, staffMsg].slice(-30)), tenantId, conv.guest_phone,
          );
        }
      }
    }
    ok(res, { sent: true });
  } catch (e: any) {
    console.error('[Hotel Reply] Error:', e.message, e.stack);
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /hotel/conversations/:phone/pause  — pause AI for 15 min (or custom)
hotelRouter.post('/conversations/:phone/pause', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const phone    = decodeURIComponent(req.params.phone);
  const minutes  = Number(req.body?.minutes) || 15;

  const pausedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();

  try {
    const table = getConversationsTable(await getTenantType(tenantId));
    await dbRun(
      `UPDATE ${table}
       SET ai_paused_until = ?, ai_paused_by = 'staff'
       WHERE tenant_id = ? AND guest_phone = ?`,
      pausedUntil, tenantId, phone,
    );
    console.log(`[Conversations] ⏸ AI paused for ${phone} until ${pausedUntil}`);
    ok(res, { paused: true, paused_until: pausedUntil, minutes_remaining: minutes });
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /hotel/conversations/:phone/resume  — resume AI immediately
hotelRouter.post('/conversations/:phone/resume', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const phone    = decodeURIComponent(req.params.phone);

  try {
    const table = getConversationsTable(await getTenantType(tenantId));
    await dbRun(
      `UPDATE ${table}
       SET ai_paused_until = NULL, ai_paused_by = NULL
       WHERE tenant_id = ? AND guest_phone = ?`,
      tenantId, phone,
    );
    console.log(`[Conversations] ▶ AI resumed for ${phone}`);
    ok(res, { paused: false });
  } catch (e: any) { err(res, e.message, 500); }
});

// GET /hotel/conversations/:phone/pause-status  — current pause state
hotelRouter.get('/conversations/:phone/pause-status', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const phone    = decodeURIComponent(req.params.phone);

  try {
    const table = getConversationsTable(await getTenantType(tenantId));
    const row = await dbGet(
      `SELECT ai_paused_until, ai_paused_by
       FROM ${table}
       WHERE tenant_id = ? AND guest_phone = ?`,
      tenantId, phone,
    ) as any;

    const pausedUntil = row?.ai_paused_until ?? null;
    const now         = new Date();
    const isPaused    = !!pausedUntil && new Date(pausedUntil) > now;
    const minutesRemaining = isPaused
      ? Math.ceil((new Date(pausedUntil).getTime() - now.getTime()) / 60000)
      : 0;

    ok(res, {
      paused:            isPaused,
      paused_until:      isPaused ? pausedUntil : null,
      minutes_remaining: minutesRemaining,
      paused_by:         row?.ai_paused_by ?? null,
    });
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /hotel/conversations/:id/extract-faq  — extract FAQ-worthy Q&A from conversation
hotelRouter.post('/conversations/:id/extract-faq', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const convId   = req.params.id;

  try {
    const conv = await dbGet(
      `SELECT messages FROM hotel_conversations WHERE tenant_id = ? AND id = ?`,
      tenantId, convId,
    ) as any;
    if (!conv) return err(res, 'Conversation not found', 404);

    const allMessages: any[] = Array.isArray(conv.messages)
      ? conv.messages
      : (() => { try { return JSON.parse(conv.messages || '[]'); } catch { return []; } })();

    if (allMessages.length === 0) return err(res, 'No messages in this conversation');

    // Filter to last 24h relative to the most recent message timestamp
    const maxTs = Math.max(0, ...allMessages.map((m: any) => m.ts ? new Date(m.ts).getTime() : 0));
    const cutoff = maxTs > 0 ? maxTs - 24 * 60 * 60 * 1000 : 0;
    const recent = maxTs > 0
      ? allMessages.filter((m: any) => m.ts && new Date(m.ts).getTime() >= cutoff)
      : allMessages; // no timestamps — use all

    if (recent.length === 0) {
      return err(res, 'No recent messages (last 24 hours) in this conversation to analyze');
    }

    // Get existing FAQ entries for categories + similarity check
    const faqs = await dbAll(
      `SELECT id, question, category FROM hotel_faq WHERE tenant_id = ? AND is_active = 1`,
      tenantId,
    ) as any[];
    const existingCategories = [...new Set(faqs.map((f: any) => f.category as string))];

    const conversationText = recent
      .map((m: any) => {
        const role = m.role === 'user' ? 'GUEST' : m.role === 'staff' ? 'STAFF' : 'AI';
        return `${role}: ${String(m.content ?? '').slice(0, 800)}`;
      })
      .join('\n');

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const anthropic = new (Anthropic as any)({ apiKey: process.env.CLAUDE_API_KEY });
    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

    const claudeRes = await anthropic.messages.create({
      model,
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `You are analyzing a hotel guest conversation to create ONE FAQ entry.

Here is the conversation (last 24 hours):
${conversationText}

Existing FAQ categories for this hotel:
${existingCategories.length > 0 ? existingCategories.join(', ') : '(none yet)'}

Your task:
1. Identify the SINGLE most useful, reusable question a guest asked that would make a good FAQ (something future guests would also ask). Ignore one-off or guest-specific requests (e.g. "bring towels to room 305"). Focus on general questions (wifi, check-out, amenities, how things work, etc.).
2. Write the QUESTION in clear, general English (not guest-specific).
3. Write the ANSWER: if hotel staff or the assistant gave a correct, useful answer in the conversation, base the answer on THAT (prefer a human staff correction over an earlier automated answer). If no useful answer was given, write a sensible common-sense answer and set answer_source to ai_suggested.
4. Always write the FAQ in ENGLISH, even if the conversation was in another language.
5. Suggest a category: pick from the existing categories if one fits, otherwise suggest a new sensible name.
6. Set answer_source to "staff" if the answer is based on a staff or AI reply in the conversation, or "ai_suggested" if you had to invent a common-sense answer.

Respond ONLY in JSON (no markdown, no code fence):
{"question":"...","answer":"...","suggested_category":"...","answer_source":"staff","found_faq_worthy_question":true}

If there is no FAQ-worthy general question, set found_faq_worthy_question to false and leave other fields as empty strings.`,
      }],
    });

    const textBlock = claudeRes.content.find((b: any) => b.type === 'text');
    if (!textBlock) return err(res, 'No response from Claude');

    let extracted: any;
    try {
      const raw = ((textBlock as any).text as string).trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      extracted = JSON.parse(raw);
    } catch {
      return err(res, 'Failed to parse Claude response');
    }

    if (!extracted.found_faq_worthy_question) {
      return ok(res, { no_question_found: true });
    }

    // Word-overlap (Jaccard) similarity against existing FAQs
    function jaccard(a: string, b: string): number {
      const wa = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
      const wb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
      const inter = [...wa].filter(w => wb.has(w)).length;
      const union = new Set([...wa, ...wb]).size;
      return union === 0 ? 0 : inter / union;
    }

    const similarFaqs = faqs
      .map((f: any) => ({ id: f.id, question: f.question, category: f.category, sim: jaccard(extracted.question, f.question) }))
      .filter((f: any) => f.sim > 0.3)
      .sort((a: any, b: any) => b.sim - a.sim)
      .slice(0, 3)
      .map(({ id, question, category }: any) => ({ id, question, category }));

    return ok(res, {
      question:            String(extracted.question  || ''),
      answer:              String(extracted.answer    || ''),
      suggested_category:  String(extracted.suggested_category || 'General'),
      answer_source:       extracted.answer_source === 'staff' ? 'staff' : 'ai_suggested',
      similar_faqs:        similarFaqs,
      existing_categories: existingCategories,
    });
  } catch (e: any) {
    err(res, e.message, 500);
  }
});

// ─────────────────────────────────────────
// CHANNEL SETTINGS
// ─────────────────────────────────────────

// GET /hotel/channels — list channel settings for this tenant
hotelRouter.get('/channels', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      'SELECT channel, ai_enabled, connected FROM hotel_channel_settings WHERE tenant_id = ? ORDER BY channel',
      tenantId,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

// GET /hotel/tenant/channels — which channels are active (for filter chip rendering)
// Returns { whatsapp: bool, instagram: bool, email: bool }
hotelRouter.get('/tenant/channels', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const channelRows = await dbAll(
      'SELECT channel, connected FROM hotel_channel_settings WHERE tenant_id = ?',
      tenantId,
    ) as any[];
    const cs: Record<string, boolean> = {};
    for (const r of channelRows) cs[r.channel] = !!r.connected;

    const emailAccount = await dbGet(
      'SELECT id FROM tenant_email_accounts WHERE tenant_id = ? AND is_enabled LIMIT 1',
      tenantId,
    ) as any;

    ok(res, {
      whatsapp:  !!cs.whatsapp,
      instagram: !!cs.instagram,
      email:     !!emailAccount,
    });
  } catch (e: any) { err(res, e.message, 500); }
});

// PUT /hotel/channels/:channel/ai-toggle — enable / disable AI for a channel
hotelRouter.put('/channels/:channel/ai-toggle', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { channel } = req.params;
  const { ai_enabled } = req.body as { ai_enabled: boolean };

  const valid = ['whatsapp', 'instagram', 'facebook', 'email'];
  if (!valid.includes(channel)) return err(res, 'Invalid channel');

  try {
    await dbRun(
      `UPDATE hotel_channel_settings
       SET ai_enabled = ?, updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND channel = ?`,
      ai_enabled ? 1 : 0, tenantId, channel,
    );
    ok(res, { channel, ai_enabled });
  } catch (e: any) { err(res, e.message, 500); }
});

// ─────────────────────────────────────────
// HOTEL REVIEWS
// ─────────────────────────────────────────

// GET /hotel/reviews?status=pending&flagged=true
hotelRouter.get('/reviews', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { status, flagged } = req.query as { status?: string; flagged?: string };

  const conditions: string[] = ['tenant_id = ?'];
  const params: unknown[] = [tenantId];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (flagged === 'true') {
    conditions.push('is_flagged = 1');
  }

  const sql = `SELECT * FROM hotel_reviews WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 100`;

  try {
    const rows = await dbAll(sql, ...params);
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

// GET /hotel/reviews/stats
hotelRouter.get('/reviews/stats', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const row = await dbGet(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN is_flagged = 1 THEN 1 ELSE 0 END) AS flagged,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replied,
         AVG(score) AS avg_score,
         AVG(sentiment_score) AS avg_sentiment
       FROM hotel_reviews
       WHERE tenant_id = ?`,
      tenantId,
    ) as any;

    ok(res, {
      total: row ? parseInt(String(row.total ?? 0), 10) : 0,
      flagged: row?.flagged ?? 0,
      pending: row?.pending ?? 0,
      replied: row?.replied ?? 0,
      avg_score: row?.avg_score != null ? Number(row.avg_score) : null,
      avg_sentiment: row?.avg_sentiment != null ? Number(row.avg_sentiment) : null,
    });
  } catch (e: any) { err(res, e.message, 500); }
});

// PATCH /hotel/reviews/:id
hotelRouter.patch('/reviews/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { status, final_response } = req.body as {
    status?: string;
    final_response?: string;
  };

  if (!status && final_response === undefined) {
    return err(res, 'At least one of status or final_response is required');
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (status !== undefined) {
    setClauses.push('status = ?');
    params.push(status);
    if (status === 'replied') {
      setClauses.push('replied_at = CURRENT_TIMESTAMP');
    }
  }
  if (final_response !== undefined) {
    setClauses.push('final_response = ?');
    params.push(final_response);
  }

  params.push(req.params.id, tenantId);

  try {
    await dbRun(
      `UPDATE hotel_reviews SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`,
      ...params,
    );
    ok(res, { updated: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /hotel/reviews/manual
hotelRouter.post('/reviews/manual', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const {
    source,
    reviewer_name,
    score,
    positive_text,
    negative_text,
    full_review_text,
  } = req.body as {
    source: string;
    reviewer_name?: string;
    score?: number;
    positive_text?: string;
    negative_text?: string;
    full_review_text?: string;
  };

  if (!source) return err(res, 'source is required');

  try {
    const { analyseReview } = await import('../reviews/reviewAnalyser.js');

    const reviewText = full_review_text
      || [positive_text, negative_text].filter(Boolean).join('\n\n')
      || '';

    const analysis = await analyseReview({
      source,
      reviewer_name: reviewer_name ?? null,
      score: score ?? null,
      score_max: 10,
      positive_text: positive_text ?? null,
      negative_text: negative_text ?? null,
      full_text: reviewText,
      review_date: new Date(),
      language: 'en',
    }, tenantId);

    const id = (await import('node:crypto')).randomUUID();

    await dbRun(
      `INSERT INTO hotel_reviews
         (id, tenant_id, source, reviewer_name, score, score_max, positive_text, negative_text,
          full_review_text, language, sentiment_score, is_flagged, flag_reason,
          suggested_response, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')`,
      id,
      tenantId,
      source,
      reviewer_name ?? null,
      score ?? null,
      10,
      positive_text ?? null,
      negative_text ?? null,
      reviewText || null,
      analysis.language,
      analysis.sentiment_score ?? null,
      analysis.is_flagged ? 1 : 0,
      analysis.flag_reason ?? null,
      analysis.suggested_response ?? null,
    );

    const saved = await dbGet('SELECT * FROM hotel_reviews WHERE id = ?', id);
    ok(res, saved);
  } catch (e: any) { err(res, e.message, 500); }
});

// POST /hotel/reviews/:id/regenerate
hotelRouter.post('/reviews/:id/regenerate', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const review = await dbGet(
      'SELECT * FROM hotel_reviews WHERE id = ? AND tenant_id = ?',
      req.params.id, tenantId,
    ) as any;

    if (!review) return err(res, 'Review not found', 404);

    const { analyseReview } = await import('../reviews/reviewAnalyser.js');

    const analysis = await analyseReview({
      source: review.source,
      reviewer_name: review.reviewer_name ?? null,
      score: review.score ?? null,
      score_max: review.score_max ?? 10,
      positive_text: review.positive_text ?? null,
      negative_text: review.negative_text ?? null,
      full_text: review.full_review_text ?? null,
      review_date: null,
      language: review.language ?? 'en',
    }, tenantId);

    await dbRun(
      'UPDATE hotel_reviews SET suggested_response = ? WHERE id = ? AND tenant_id = ?',
      analysis.suggested_response ?? null, req.params.id, tenantId,
    );

    ok(res, { suggested_response: analysis.suggested_response ?? null });
  } catch (e: any) { err(res, e.message, 500); }
});

// GET /hotel/reviews/config
hotelRouter.get('/reviews/config', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const row = await dbGet(
      'SELECT review_email_slug, owner_phone, review_notification_frequency FROM tenants WHERE id = ?',
      tenantId,
    ) as any;

    const slug: string | null = row?.review_email_slug ?? null;
    ok(res, {
      slug,
      email: slug ? `${slug}@reviews.skedai.net` : null,
      owner_phone: row?.owner_phone ?? null,
      notification_frequency: (row?.review_notification_frequency ?? 'immediate') as string,
    });
  } catch (e: any) { err(res, e.message, 500); }
});

// PUT /hotel/reviews/config
hotelRouter.put('/reviews/config', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { slug: rawSlug, owner_phone, notification_frequency } = req.body as {
    slug?: string;
    owner_phone?: string;
    notification_frequency?: string;
  };

  const VALID_FREQUENCIES = ['immediate', 'daily', 'twice_daily', 'weekly', 'mon_thu', 'never'];
  const slug      = rawSlug?.toLowerCase().replace(/[^a-z0-9-]/g, '') ?? null;
  const frequency = notification_frequency && VALID_FREQUENCIES.includes(notification_frequency)
    ? notification_frequency : null;

  try {
    await dbRun(
      `UPDATE tenants
       SET review_email_slug             = ?,
           owner_phone                   = ?,
           review_notification_frequency = COALESCE(?, review_notification_frequency)
       WHERE id = ?`,
      slug ?? null, owner_phone ?? null, frequency, tenantId,
    );

    const updated = await dbGet(
      'SELECT review_email_slug, owner_phone, review_notification_frequency FROM tenants WHERE id = ?',
      tenantId,
    ) as any;

    const updatedSlug = updated?.review_email_slug ?? null;
    ok(res, {
      slug: updatedSlug,
      email: updatedSlug ? `${updatedSlug}@reviews.skedai.net` : null,
      owner_phone: updated?.owner_phone ?? null,
      notification_frequency: (updated?.review_notification_frequency ?? 'immediate') as string,
    });
  } catch (e: any) { err(res, e.message, 500); }
});
