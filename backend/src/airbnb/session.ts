import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';

// ---------------------------------------------------------------------------
// Airbnb conversation sessions
// Independent of hotel/session.ts and generalBusiness/session.ts — no shared
// code, following the same "built independently" pattern as general_business.
// Identity is (tenant_id, channel, channel_user_id) rather than a phone
// number, since a host's channels are shared across every listing they own.
// ---------------------------------------------------------------------------

export interface AirbnbMessage {
  role: 'user' | 'assistant' | 'staff';
  content: string;
  ts: string; // ISO timestamp
}

interface AirbnbSession {
  messages: AirbnbMessage[];
  lastActivity: Date;
}

const sessions = new Map<string, AirbnbSession>();
const MAX_MESSAGES = 30;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function parseMessages(raw: any): AirbnbMessage[] {
  if (Array.isArray(raw)) return raw as AirbnbMessage[];
  try { return JSON.parse(raw || '[]') as AirbnbMessage[]; } catch { return []; }
}

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}
async function dbRun(sql: string, ...p: unknown[]) {
  if (isPg) return queryRun(sql, p);
  prepare(sql).run(...p);
}

function key(tenantId: string, channel: string, channelUserId: string): string {
  return `${tenantId}:${channel}:${channelUserId}`;
}

export interface AirbnbConversationRow {
  id: string;
  tenant_id: string;
  listing_id: string | null;
  channel: string;
  channel_user_id: string;
  messages: AirbnbMessage[];
  ai_paused_until: string | null;
}

// ---------------------------------------------------------------------------
// getOrCreateConversation — the one place that resolves a conversation row.
// Returns the row (with parsed messages) whether it already existed or not.
// ---------------------------------------------------------------------------
export async function getOrCreateConversation(
  tenantId: string,
  channel: string,
  channelUserId: string,
): Promise<AirbnbConversationRow> {
  const existing = await dbGet(
    'SELECT * FROM airbnb_conversations WHERE tenant_id = ? AND channel = ? AND channel_user_id = ?',
    tenantId, channel, channelUserId,
  ) as any;

  if (existing) {
    return { ...existing, messages: parseMessages(existing.messages) };
  }

  const id = crypto.randomUUID();
  await dbRun(
    `INSERT INTO airbnb_conversations (id, tenant_id, listing_id, channel, channel_user_id, messages)
     VALUES (?,?,NULL,?,?,'[]')`,
    id, tenantId, channel, channelUserId,
  );
  return { id, tenant_id: tenantId, listing_id: null, channel, channel_user_id: channelUserId, messages: [], ai_paused_until: null };
}

// ---------------------------------------------------------------------------
// getAirbnbHistory — messages for Claude (role + content only), in-memory
// first, falling back to Postgres if the session expired.
// ---------------------------------------------------------------------------
export async function getAirbnbHistory(conversationId: string): Promise<AirbnbMessage[]> {
  const session = sessions.get(conversationId);
  if (session && Date.now() - session.lastActivity.getTime() < SESSION_TTL_MS) {
    return session.messages;
  }

  try {
    const row = await dbGet('SELECT messages FROM airbnb_conversations WHERE id = ?', conversationId) as any;
    if (row?.messages) {
      const msgs = parseMessages(row.messages).slice(-MAX_MESSAGES);
      sessions.set(conversationId, { messages: msgs, lastActivity: new Date() });
      return msgs;
    }
  } catch (e: any) {
    console.warn('[Airbnb session] DB load failed:', e.message);
  }
  return [];
}

// ---------------------------------------------------------------------------
// saveAirbnbGuestMessage — write ONLY the incoming guest message immediately,
// so the dashboard shows it before the AI responds.
// ---------------------------------------------------------------------------
export async function saveAirbnbGuestMessage(conversationId: string, userMessage: string): Promise<void> {
  const now = new Date().toISOString();
  try {
    const existing = await dbGet('SELECT messages FROM airbnb_conversations WHERE id = ?', conversationId) as any;
    const prev = parseMessages(existing?.messages);

    const last = prev[prev.length - 1];
    if (last?.role === 'user' && last.content === userMessage) return; // idempotency

    const updated = [...prev, { role: 'user' as const, content: userMessage, ts: now }].slice(-MAX_MESSAGES);
    await dbRun(
      'UPDATE airbnb_conversations SET messages = ?, updated_at = NOW() WHERE id = ?',
      JSON.stringify(updated), conversationId,
    );
  } catch (e: any) {
    console.warn('[Airbnb session] Guest message save failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// saveAirbnbConversation — append user + assistant turn, dual-write.
// ---------------------------------------------------------------------------
export async function saveAirbnbConversation(
  conversationId: string,
  userMessage: string,
  assistantReply: string,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = sessions.get(conversationId);
  const prev = existing?.messages ?? [];
  const updated = [
    ...prev,
    { role: 'user' as const, content: userMessage, ts: now },
    { role: 'assistant' as const, content: assistantReply, ts: now },
  ].slice(-MAX_MESSAGES);

  sessions.set(conversationId, { messages: updated, lastActivity: new Date() });

  try {
    await dbRun(
      'UPDATE airbnb_conversations SET messages = ?, updated_at = NOW() WHERE id = ?',
      JSON.stringify(updated), conversationId,
    );
  } catch (e: any) {
    console.warn('[Airbnb session] DB save failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// setConversationListing — persists the identified listing_id once the
// identify_listing tool resolves a confident match. All later turns in this
// conversation load that listing's FAQ/config without re-asking.
// ---------------------------------------------------------------------------
export async function setConversationListing(conversationId: string, listingId: string): Promise<void> {
  try {
    await dbRun('UPDATE airbnb_conversations SET listing_id = ? WHERE id = ?', listingId, conversationId);
  } catch (e: any) {
    console.warn('[Airbnb session] setConversationListing failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// appendAirbnbStaffMessage — called after a host manually replies from the
// dashboard while AI is paused.
// ---------------------------------------------------------------------------
export async function appendAirbnbStaffMessage(conversationId: string, content: string): Promise<void> {
  const now = new Date().toISOString();
  const existing = sessions.get(conversationId);
  const prev = existing?.messages ?? [];
  const updated = [...prev, { role: 'staff' as const, content, ts: now }].slice(-MAX_MESSAGES);

  sessions.set(conversationId, { messages: updated, lastActivity: new Date() });

  try {
    await dbRun(
      'UPDATE airbnb_conversations SET messages = ?, updated_at = NOW() WHERE id = ?',
      JSON.stringify(updated), conversationId,
    );
  } catch (e: any) {
    console.warn('[Airbnb session] staff append failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Periodic cleanup of expired in-memory sessions
// ---------------------------------------------------------------------------
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions.entries()) {
    if (now - s.lastActivity.getTime() > SESSION_TTL_MS) sessions.delete(k);
  }
}, 30 * 60 * 1000);
