import type Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// In-memory hotel guest sessions — keyed by tenantId:phone
// Separate from shared sessions.ts to allow per-hotel context (4h TTL)
// ---------------------------------------------------------------------------

interface HotelSession {
  messages: Anthropic.MessageParam[];
  lastActivity: Date;
}

const hotelSessions = new Map<string, HotelSession>();

const MAX_MESSAGES = 20;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export function getHotelSession(tenantId: string, phone: string): Anthropic.MessageParam[] {
  const key = `${tenantId}:${phone}`;
  const session = hotelSessions.get(key);
  if (!session) return [];

  if (Date.now() - session.lastActivity.getTime() > SESSION_TTL_MS) {
    hotelSessions.delete(key);
    return [];
  }

  return session.messages;
}

export function updateHotelSession(
  tenantId: string,
  phone: string,
  userMessage: string,
  assistantReply: string,
): void {
  const key = `${tenantId}:${phone}`;
  const existing = hotelSessions.get(key);
  const messages: Anthropic.MessageParam[] = existing?.messages ?? [];

  messages.push({ role: 'user', content: userMessage });
  messages.push({ role: 'assistant', content: assistantReply });

  hotelSessions.set(key, {
    messages: messages.slice(-MAX_MESSAGES),
    lastActivity: new Date(),
  });
}

// Periodic cleanup every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of hotelSessions.entries()) {
    if (now - session.lastActivity.getTime() > SESSION_TTL_MS) {
      hotelSessions.delete(key);
    }
  }
}, 30 * 60 * 1000);
