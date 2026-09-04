import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';

// ---------------------------------------------------------------------------
// General Business conversation sessions
// Dual-write: in-memory Map (speed) + Postgres (persistence / dashboard)
// ---------------------------------------------------------------------------

export interface GbMessage {
  role: 'user' | 'assistant' | 'staff';
  content: string;
  ts: string; // ISO timestamp
}

interface GbSession {
  messages: GbMessage[];
  lastActivity: Date;
}

const sessions = new Map<string, GbSession>();
const MAX_MESSAGES = 30;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function parseMessages(raw: any): GbMessage[] {
  if (Array.isArray(raw)) return raw as GbMessage[];
  try { return JSON.parse(raw || '[]') as GbMessage[]; } catch { return []; }
}

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

// ---------------------------------------------------------------------------
// getGbHistory — returns messages for Claude (role + content only)
// Loads from in-memory first, falls back to Postgres if session expired
// ---------------------------------------------------------------------------
export async function getGbHistory(
  tenantId: string,
  phone: string,
): Promise<GbMessage[]> {
  const key = `${tenantId}:${phone}`;
  const session = sessions.get(key);

  if (session && Date.now() - session.lastActivity.getTime() < SESSION_TTL_MS) {
    return session.messages;
  }

  // Not in memory — try Postgres
  try {
    const row = await dbGet(
      'SELECT messages FROM gb_conversations WHERE tenant_id = ? AND guest_phone = ?',
      tenantId, phone,
    ) as any;
    if (row?.messages) {
      const allMsgs = parseMessages(row.messages);
      // Strip any trailing user message — the agent appends the current user message
      // explicitly; including it here would cause duplication in the Claude context.
      const lastIdx = allMsgs.length - 1;
      const msgs = (lastIdx >= 0 && allMsgs[lastIdx].role === 'user')
        ? allMsgs.slice(0, lastIdx)
        : allMsgs;
      sessions.set(key, { messages: msgs.slice(-MAX_MESSAGES), lastActivity: new Date() });
      return msgs.slice(-MAX_MESSAGES);
    }
  } catch (e: any) {
    console.warn('[GB session] DB load failed:', e.message);
  }

  return [];
}

// ---------------------------------------------------------------------------
// saveGbGuestMessage — write ONLY the incoming user message to the DB.
//
// Called immediately when a message arrives (before AI processing) so the
// dashboard shows guest messages in real time.
// Does NOT update the in-memory session to avoid duplication.
// ---------------------------------------------------------------------------
export async function saveGbGuestMessage(
  tenantId: string,
  phone: string,
  userMessage: string,
  guestName?: string | null,
  guestUsername?: string | null,
  guestEmail?: string | null,
  channel?: string | null,
  channelUserId?: string | null,
): Promise<void> {
  if (phone.startsWith('email:')) return;
  const now = new Date().toISOString();
  try {
    const existing = await dbGet(
      'SELECT messages FROM gb_conversations WHERE tenant_id = ? AND guest_phone = ?',
      tenantId, phone,
    ) as any;

    const prev: GbMessage[] = parseMessages(existing?.messages);

    // Idempotency: don't duplicate if the last stored message is identical
    const last = prev[prev.length - 1];
    if (last?.role === 'user' && last.content === userMessage) return;

    const updated: GbMessage[] = [
      ...prev,
      { role: 'user' as const, content: userMessage, ts: now },
    ].slice(-MAX_MESSAGES);

    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO gb_conversations
         (id, tenant_id, guest_phone, guest_name, guest_username, guest_email, channel, channel_user_id,
          messages, last_message, updated_at, last_guest_message_at)
       VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id, guest_phone) DO UPDATE SET
         messages              = excluded.messages,
         guest_name            = COALESCE(excluded.guest_name, gb_conversations.guest_name),
         guest_username        = COALESCE(excluded.guest_username, gb_conversations.guest_username),
         guest_email           = COALESCE(excluded.guest_email, gb_conversations.guest_email),
         channel               = COALESCE(excluded.channel, gb_conversations.channel),
         channel_user_id       = COALESCE(excluded.channel_user_id, gb_conversations.channel_user_id),
         last_message          = CURRENT_TIMESTAMP,
         updated_at            = CURRENT_TIMESTAMP,
         last_guest_message_at = CURRENT_TIMESTAMP`,
      id, tenantId, phone, guestName ?? null, guestUsername ?? null, guestEmail ?? null,
      channel ?? null, channelUserId ?? null, JSON.stringify(updated),
    );
  } catch (e: any) {
    console.warn('[GB session] Guest message DB save failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// saveGbConversation — append user + assistant messages, dual-write
// ---------------------------------------------------------------------------
export async function saveGbConversation(
  tenantId: string,
  phone: string,
  userMessage: string,
  assistantReply: string,
  guestName?: string | null,
  guestUsername?: string | null,
  guestEmail?: string | null,
  channel?: string | null,
  channelUserId?: string | null,
): Promise<void> {
  if (phone.startsWith('email:')) return;
  const key = `${tenantId}:${phone}`;
  const existing = sessions.get(key);
  const now = new Date().toISOString();

  const prev: GbMessage[] = existing?.messages ?? [];
  const updated: GbMessage[] = [
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
      `INSERT INTO gb_conversations
         (id, tenant_id, guest_phone, guest_name, guest_username, guest_email, channel, channel_user_id,
          messages, last_message, updated_at, last_guest_message_at)
       VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id, guest_phone) DO UPDATE SET
         messages              = excluded.messages,
         guest_name            = COALESCE(excluded.guest_name, gb_conversations.guest_name),
         guest_username        = COALESCE(excluded.guest_username, gb_conversations.guest_username),
         guest_email           = COALESCE(excluded.guest_email, gb_conversations.guest_email),
         channel               = COALESCE(excluded.channel, gb_conversations.channel),
         channel_user_id       = COALESCE(excluded.channel_user_id, gb_conversations.channel_user_id),
         last_message          = CURRENT_TIMESTAMP,
         updated_at            = CURRENT_TIMESTAMP,
         last_guest_message_at = CURRENT_TIMESTAMP`,
      id, tenantId, phone, guestName ?? null, guestUsername ?? null, guestEmail ?? null,
      channel ?? null, channelUserId ?? null, JSON.stringify(updated),
    );
  } catch (e: any) {
    console.warn('[GB session] DB save failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// appendGbStaffMessage — called by the reply route after staff sends manually
// ---------------------------------------------------------------------------
export async function appendGbStaffMessage(
  tenantId: string,
  phone: string,
  content: string,
): Promise<void> {
  const key = `${tenantId}:${phone}`;
  const existing = sessions.get(key);
  const now = new Date().toISOString();
  const staffMsg: GbMessage = { role: 'staff', content, ts: now };

  const prev: GbMessage[] = existing?.messages ?? [];
  const updated = [...prev, staffMsg].slice(-MAX_MESSAGES);

  sessions.set(key, { messages: updated, lastActivity: new Date() });

  try {
    await dbRun(
      `UPDATE gb_conversations
       SET
         messages     = ?,
         last_message = CURRENT_TIMESTAMP,
         updated_at   = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND guest_phone = ?`,
      JSON.stringify(updated), tenantId, phone,
    );
  } catch (e: any) {
    console.warn('[GB session] staff append failed:', e.message);
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
