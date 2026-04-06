import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';

// ---------------------------------------------------------------------------
// Hotel conversation sessions
// Dual-write: in-memory Map (speed) + Postgres (persistence / dashboard)
// ---------------------------------------------------------------------------

export interface HotelMessage {
  role: 'user' | 'assistant' | 'staff';
  content: string;
  ts: string; // ISO timestamp
}

interface HotelSession {
  messages: HotelMessage[];
  lastActivity: Date;
}

const sessions = new Map<string, HotelSession>();
const MAX_MESSAGES = 30;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// ---------------------------------------------------------------------------
// DB helpers (local — avoids circular import)
// ---------------------------------------------------------------------------
async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}
async function dbRun(sql: string, ...p: unknown[]) {
  if (isPg) return queryRun(sql, p);
  prepare(sql).run(...p);
}
async function dbAll(sql: string, ...p: unknown[]) {
  return isPg ? query(sql, p) : prepare(sql).all(...p);
}

// ---------------------------------------------------------------------------
// getHotelHistory — returns messages for Claude (role + content only)
// Loads from in-memory first, falls back to Postgres if session expired
// ---------------------------------------------------------------------------
export async function getHotelHistory(
  tenantId: string,
  phone: string,
): Promise<HotelMessage[]> {
  const key = `${tenantId}:${phone}`;
  const session = sessions.get(key);

  if (session && Date.now() - session.lastActivity.getTime() < SESSION_TTL_MS) {
    return session.messages;
  }

  // Not in memory — try Postgres
  try {
    const row = await dbGet(
      'SELECT messages FROM hotel_conversations WHERE tenant_id = ? AND guest_phone = ?',
      tenantId, phone,
    ) as any;
    if (row?.messages) {
      const msgs: HotelMessage[] = JSON.parse(row.messages);
      sessions.set(key, { messages: msgs.slice(-MAX_MESSAGES), lastActivity: new Date() });
      return msgs.slice(-MAX_MESSAGES);
    }
  } catch (e: any) {
    console.warn('[Hotel session] DB load failed:', e.message);
  }

  return [];
}

// ---------------------------------------------------------------------------
// saveHotelConversation — append user + assistant messages, dual-write
// ---------------------------------------------------------------------------
export async function saveHotelConversation(
  tenantId: string,
  phone: string,
  userMessage: string,
  assistantReply: string,
  roomNumber?: string | null,
): Promise<void> {
  const key = `${tenantId}:${phone}`;
  const existing = sessions.get(key);
  const now = new Date().toISOString();

  const prev: HotelMessage[] = existing?.messages ?? [];
  const updated: HotelMessage[] = [
    ...prev,
    { role: 'user',      content: userMessage,    ts: now },
    { role: 'assistant', content: assistantReply, ts: now },
  ].slice(-MAX_MESSAGES);

  // 1. In-memory update
  sessions.set(key, { messages: updated, lastActivity: new Date() });

  // 2. Postgres upsert
  try {
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO hotel_conversations
         (id, tenant_id, guest_phone, room_number, messages, last_message, updated_at)
       VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id, guest_phone) DO UPDATE SET
         messages     = excluded.messages,
         room_number  = COALESCE(excluded.room_number, hotel_conversations.room_number),
         last_message = CURRENT_TIMESTAMP,
         updated_at   = CURRENT_TIMESTAMP`,
      id, tenantId, phone, roomNumber ?? null, JSON.stringify(updated),
    );
  } catch (e: any) {
    console.warn('[Hotel session] DB save failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// appendStaffMessage — called by the reply route after staff sends manually
// ---------------------------------------------------------------------------
export async function appendStaffMessage(
  tenantId: string,
  phone: string,
  content: string,
): Promise<void> {
  const key = `${tenantId}:${phone}`;
  const existing = sessions.get(key);
  const now = new Date().toISOString();
  const staffMsg: HotelMessage = { role: 'staff', content, ts: now };

  const prev: HotelMessage[] = existing?.messages ?? [];
  const updated = [...prev, staffMsg].slice(-MAX_MESSAGES);

  sessions.set(key, { messages: updated, lastActivity: new Date() });

  try {
    await dbRun(
      `UPDATE hotel_conversations
       SET
         messages     = ?,
         last_message = CURRENT_TIMESTAMP,
         updated_at   = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND guest_phone = ?`,
      JSON.stringify(updated), tenantId, phone,
    );
  } catch (e: any) {
    console.warn('[Hotel session] staff append failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Periodic cleanup of expired in-memory sessions
// ---------------------------------------------------------------------------
setInterval(() => {
  const now = Date.now();
  for (const [key, s] of sessions.entries()) {
    if (now - s.lastActivity.getTime() > SESSION_TTL_MS) sessions.delete(key);
  }
}, 30 * 60 * 1000);
