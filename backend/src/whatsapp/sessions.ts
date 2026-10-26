import type Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// In-memory conversation sessions — one per WhatsApp phone number
// Each session stores the last N messages so Claude has context
// ---------------------------------------------------------------------------

interface Session {
  history: Anthropic.MessageParam[];
  lastActivity: Date;
}

const sessions = new Map<string, Session>();

const MAX_HISTORY = 20;      // Max messages to keep per session
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour inactivity = new session

export function getSession(phone: string): Anthropic.MessageParam[] {
  const session = sessions.get(phone);
  if (!session) return [];

  // Expire old sessions so Claude starts fresh
  if (Date.now() - session.lastActivity.getTime() > SESSION_TTL_MS) {
    sessions.delete(phone);
    return [];
  }

  return session.history;
}

export function updateSession(
  phone: string,
  userMessage: string,
  assistantReply: string,
): void {
  const existing = sessions.get(phone);
  const history: Anthropic.MessageParam[] = existing?.history ?? [];

  // Append this turn
  history.push({ role: 'user',      content: userMessage });
  history.push({ role: 'assistant', content: assistantReply });

  // Trim to last MAX_HISTORY messages
  const trimmed = history.slice(-MAX_HISTORY);

  sessions.set(phone, { history: trimmed, lastActivity: new Date() });
}

// Adds an assistant message sent outside a normal agent turn (e.g. a staff answer relayed after an escalation).
// Only into a live session: creating one would start the history with an assistant turn, which the API rejects.
// The database keeps the full conversation either way.
export function appendAssistantToSession(phone: string, content: string): void {
  const session = sessions.get(phone);
  if (!session || Date.now() - session.lastActivity.getTime() > SESSION_TTL_MS) return;
  session.history.push({ role: 'assistant', content });
  sessions.set(phone, { history: session.history.slice(-MAX_HISTORY), lastActivity: new Date() });
}

export function clearSession(phone: string): void {
  sessions.delete(phone);
}

// Periodic cleanup of expired sessions (runs every 30 min)
setInterval(() => {
  const now = Date.now();
  for (const [phone, session] of sessions.entries()) {
    if (now - session.lastActivity.getTime() > SESSION_TTL_MS) {
      sessions.delete(phone);
    }
  }
}, 30 * 60 * 1000);
