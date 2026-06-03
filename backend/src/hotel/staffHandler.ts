import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StaffMessageInput {
  message:   string;
  staffPhone: string;
  staffName:  string | null;
  staffRole:  string | null;
  tenantId:   string;
}

interface ParsedCommand {
  roomNumber:   string | null;
  requestIndex: number | null; // 1-based, for "205-2 done" style indexed selection
  action:       'done' | 'in_progress' | 'note' | null;
  note:         string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTime(tz = 'Europe/Tirane'): string {
  return new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: tz,
  });
}

function fmtRequestType(t: string): string {
  return t.replace(/_/g, ' ');
}

/**
 * Parse staff message into a structured command.
 *
 * Patterns supported:
 *   "205 done"                 → room 205, action done
 *   "205 done AC replaced"     → room 205, action done, note
 *   "205 in progress"          → room 205, action in_progress
 *   "205 in progress checking" → room 205, action in_progress, note
 *   "205-2 done"               → room 205, request index 2, action done
 *   "205 AC needed a new part" → room 205, action note
 */
function parseStaffMessage(message: string): ParsedCommand {
  const clean = message.trim();

  // "205-2 done" or "205-1 in progress" — indexed selection from multi-request list
  const indexedDone = clean.match(/^(?:room\s*)?(\d+)-(\d+)\s+done(.*)?$/i);
  if (indexedDone) {
    return {
      roomNumber:   indexedDone[1],
      requestIndex: parseInt(indexedDone[2], 10),
      action:       'done',
      note:         indexedDone[3]?.trim().replace(/^[-–]\s*/, '') || null,
    };
  }

  const indexedProg = clean.match(/^(?:room\s*)?(\d+)-(\d+)\s+(?:in\s*progress|inprogress|started|working)(.*)?$/i);
  if (indexedProg) {
    return {
      roomNumber:   indexedProg[1],
      requestIndex: parseInt(indexedProg[2], 10),
      action:       'in_progress',
      note:         indexedProg[3]?.trim().replace(/^[-–]\s*/, '') || null,
    };
  }

  // "205 done [optional note]"
  const doneMatch = clean.match(/^(?:room\s*)?(\d+)\s+done(.*)?$/i);
  if (doneMatch) {
    return {
      roomNumber:   doneMatch[1],
      requestIndex: null,
      action:       'done',
      note:         doneMatch[2]?.trim().replace(/^[-–]\s*/, '') || null,
    };
  }

  // "205 in progress [optional note]" / "205 started" / "205 working"
  const progressMatch = clean.match(/^(?:room\s*)?(\d+)\s+(?:in\s*progress|inprogress|started|working)(.*)?$/i);
  if (progressMatch) {
    return {
      roomNumber:   progressMatch[1],
      requestIndex: null,
      action:       'in_progress',
      note:         progressMatch[2]?.trim().replace(/^[-–]\s*/, '') || null,
    };
  }

  // "205 [anything else]" → save as note
  const noteMatch = clean.match(/^(?:room\s*)?(\d+)\s+(.+)$/i);
  if (noteMatch) {
    return {
      roomNumber:   noteMatch[1],
      requestIndex: null,
      action:       'note',
      note:         noteMatch[2].trim(),
    };
  }

  return { roomNumber: null, requestIndex: null, action: null, note: null };
}

// ---------------------------------------------------------------------------
// Apply a status action to a single request
// ---------------------------------------------------------------------------

async function applyAction(
  request: any,
  action: 'done' | 'in_progress' | 'note',
  rawNote: string | null,
  staffPhone: string,
  displayName: string,
  tz: string,
): Promise<string> {
  const now  = new Date().toISOString();
  const time = fmtTime(tz);

  // Build new notes string (append to existing)
  let updatedNotes: string | null = request.notes ?? null;
  if (rawNote) {
    const entry = `[${time}] ${displayName}: ${rawNote}`;
    updatedNotes = updatedNotes ? `${updatedNotes}\n${entry}` : entry;
  }

  const type  = fmtRequestType(request.request_type);
  const room  = request.room_number;

  if (action === 'done') {
    await dbRun(
      `UPDATE hotel_requests
       SET status = 'resolved', resolved_at = ?, resolved_by = ?, notes = ?
       WHERE id = ?`,
      now, staffPhone, updatedNotes, request.id,
    );
    return [
      `✅ Room ${room} — *${type}* marked as *resolved*.`,
      rawNote ? `Note saved: "${rawNote}"` : '',
    ].filter(Boolean).join('\n');
  }

  if (action === 'in_progress') {
    await dbRun(
      `UPDATE hotel_requests
       SET status = 'in_progress', in_progress_at = ?, notes = ?
       WHERE id = ?`,
      now, updatedNotes, request.id,
    );
    return [
      `🔄 Room ${room} — *${type}* marked as *in progress*.`,
      rawNote ? `Note saved: "${rawNote}"` : '',
    ].filter(Boolean).join('\n');
  }

  // action === 'note'
  await dbRun(
    'UPDATE hotel_requests SET notes = ? WHERE id = ?',
    updatedNotes, request.id,
  );
  return `📝 Note saved for room ${room} — *${type}*:\n"${rawNote}"`;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function handleStaffMessage({
  message, staffPhone, staffName, staffRole, tenantId,
}: StaffMessageInput): Promise<void> {
  const displayName = staffName || staffRole || 'Staff';
  console.log(`[Staff] 📱 From ${displayName} (${staffPhone}): "${message}"`);

  // Load tenant row (needed for sendWhatsAppMessage provider routing)
  const tenantRow = await dbGet('SELECT * FROM tenants WHERE id = ?', tenantId) as any;

  const parsed = parseStaffMessage(message);

  // No room number detected → send usage help
  if (!parsed.roomNumber) {
    await sendWhatsAppMessage(
      staffPhone,
      `Hi ${displayName}! To update a request, text:\n\n` +
      `📌 *[room] done* — mark resolved\n` +
      `📌 *[room] in progress* — mark in progress\n` +
      `📌 *[room] [note]* — add a note\n\n` +
      `Example: *205 done* or *205 AC fixed, needed new part*\n` +
      `Multiple requests? Use: *205-1 done* or *205-2 in progress*`,
      tenantRow,
    );
    return;
  }

  const room = parsed.roomNumber;

  // Load timezone from hotel config
  const cfgRow = await dbGet('SELECT timezone FROM hotel_config WHERE tenant_id = ?', tenantId) as any;
  const tz = cfgRow?.timezone || 'Europe/Tirane';

  // Find open / in-progress requests for this room
  const requests = await dbAll(
    `SELECT id, request_type, description, status, room_number, notes, created_at
     FROM hotel_requests
     WHERE tenant_id = ? AND room_number = ? AND status != 'resolved'
     ORDER BY created_at DESC`,
    tenantId, room,
  ) as any[];

  // No open requests for this room
  if (requests.length === 0) {
    await sendWhatsAppMessage(
      staffPhone,
      `No open requests found for room ${room}. ✅`,
      tenantRow,
    );
    return;
  }

  // Indexed selection — "205-2 done" means request #2 in the list for room 205
  if (parsed.requestIndex !== null) {
    const idx = parsed.requestIndex - 1; // 0-based
    if (idx < 0 || idx >= requests.length) {
      await sendWhatsAppMessage(
        staffPhone,
        `Invalid selection. Room ${room} has ${requests.length} open request${requests.length > 1 ? 's' : ''}. Use 1–${requests.length}.`,
        tenantRow,
      );
      return;
    }
    const reply = await applyAction(requests[idx], parsed.action!, parsed.note, staffPhone, displayName, tz);
    await sendWhatsAppMessage(staffPhone, reply, tenantRow);
    return;
  }

  // Multiple open requests + non-note action → show list and ask for indexed selection
  if (requests.length > 1 && parsed.action !== 'note') {
    const list = requests
      .map((r: any, i: number) =>
        `${i + 1}. *${fmtRequestType(r.request_type)}* — ${(r.description ?? '').slice(0, 60)}`,
      )
      .join('\n');

    await sendWhatsAppMessage(
      staffPhone,
      `Room ${room} has ${requests.length} open requests:\n\n${list}\n\n` +
      `To update a specific one, add the number:\n` +
      `📌 *${room}-1 done* or *${room}-2 in progress*`,
      tenantRow,
    );
    return;
  }

  // Single request (or note action — always applies to most recent)
  const reply = await applyAction(requests[0], parsed.action!, parsed.note, staffPhone, displayName, tz);
  await sendWhatsAppMessage(staffPhone, reply, tenantRow);

  console.log(`[Staff] ✅ Request ${requests[0].id} updated by ${displayName} → ${parsed.action}`);
}
