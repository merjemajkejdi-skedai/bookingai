// SkedAI session store — in-memory with TTL, Redis-compatible if REDIS_URL is set
// Stores per-phone: conversation messages (last 20) + detected route

const SESSION_TTL_MS = 60 * 60 * 4 * 1000; // 4 hours

export interface SkedAISession {
  messages: Array<{ role: 'user' | 'assistant'; content: string; ts: string }>;
  route: 'support' | 'sales' | null;
}

// ── In-memory fallback ────────────────────────────────────────────────────────
const store = new Map<string, { data: SkedAISession; expiresAt: number }>();

function memGet(phone: string): SkedAISession {
  const entry = store.get(phone);
  if (!entry) return { messages: [], route: null };
  if (Date.now() > entry.expiresAt) { store.delete(phone); return { messages: [], route: null }; }
  return entry.data;
}

function memSet(phone: string, data: SkedAISession) {
  store.set(phone, { data, expiresAt: Date.now() + SESSION_TTL_MS });
}

// ── Redis (optional) ──────────────────────────────────────────────────────────
let redis: any = null;
let redisReady = false;

if (process.env.REDIS_URL) {
  import('redis').then(({ createClient }) => {
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on('error', (e: any) => console.warn('[SkedAI session] Redis error:', e.message));
    redis.connect().then(() => { redisReady = true; console.log('[SkedAI session] Redis connected'); });
  }).catch(() => { /* Redis package not installed — use memory */ });
}

const SESSION_TTL_S = SESSION_TTL_MS / 1000;

// ── Public API ────────────────────────────────────────────────────────────────
export async function getSession(phone: string): Promise<SkedAISession> {
  if (redisReady) {
    try {
      const raw = await redis.get(`skedai:${phone}`);
      return raw ? JSON.parse(raw) : { messages: [], route: null };
    } catch { /* fall through */ }
  }
  return memGet(phone);
}

export async function saveSession(phone: string, session: SkedAISession): Promise<void> {
  const trimmed: SkedAISession = { ...session, messages: session.messages.slice(-20) };
  if (redisReady) {
    try {
      await redis.setEx(`skedai:${phone}`, SESSION_TTL_S, JSON.stringify(trimmed));
      return;
    } catch { /* fall through */ }
  }
  memSet(phone, trimmed);
}
