// computeReportStats.ts — owner performance report metrics for a single tenant/period.
//
// Reads from each tenant type's own conversations table (never message_log,
// which only captures WhatsApp) so multi-channel tenants aren't undercounted.
// "Most common topics" is intentionally omitted — no FAQ-match-per-response
// tracking exists in the codebase yet, and fabricating it would be worse than
// leaving it out for v1.
import { isPg, query } from '../db/database.js';
import { getConversationsTable } from '../utils/conversationsTable.js';

export interface OwnerReportStats {
  tenantId: string;
  periodStart: string; // ISO date (inclusive)
  periodEnd: string;   // ISO date (exclusive)
  messagesAnswered: number;
  avgReplySeconds: number | null;
  conversationsByChannel: Record<string, number>;
  newConversations: number;
  requests: { created: number; resolved: number } | null;
}

interface RawMessage {
  role: 'user' | 'assistant' | 'staff';
  content: string;
  ts: string;
}

// shop_conversations predates the multi-channel `channel` column — every
// shop conversation is WhatsApp.
const HAS_CHANNEL_COLUMN: Record<string, boolean> = {
  hotel_conversations: true,
  shop_conversations: false,
  gb_conversations: true,
  art_class_conversations: true,
};

// Only hotel and general_business have a Requests feature.
const REQUEST_TABLES: Record<string, string> = {
  hotel: 'hotel_requests',
  general_business: 'gb_requests',
};

function parseMessages(raw: unknown): RawMessage[] {
  if (Array.isArray(raw)) return raw as RawMessage[];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as RawMessage[]; } catch { return []; }
  }
  return [];
}

function inPeriod(ts: string | null | undefined, start: Date, end: Date): boolean {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return false;
  return t >= start.getTime() && t < end.getTime();
}

export async function computeReportStats(
  tenantId: string,
  tenantType: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<OwnerReportStats> {
  const table = getConversationsTable(tenantType);
  const hasChannel = HAS_CHANNEL_COLUMN[table] ?? false;

  const stats: OwnerReportStats = {
    tenantId,
    periodStart: periodStart.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
    messagesAnswered: 0,
    avgReplySeconds: null,
    conversationsByChannel: {},
    newConversations: 0,
    requests: null,
  };

  if (!isPg) return stats; // report job only runs against the Postgres (production) DB

  // A conversation last touched before the period start cannot contain a
  // single message inside the period (messages are appended chronologically
  // and capped at the last 30), so this filter is safe and keeps rows sane.
  const rows = await query(
    `SELECT id, messages, created_at${hasChannel ? ', channel' : ''}
     FROM ${table}
     WHERE tenant_id = ? AND updated_at::timestamptz >= ?`,
    [tenantId, periodStart.toISOString()],
  ) as any[];

  const replyGaps: number[] = [];

  for (const row of rows) {
    const messages = parseMessages(row.messages);
    const channel = hasChannel ? (row.channel || 'whatsapp') : 'whatsapp';

    let sawActivityInPeriod = false;
    let pendingUserTs: number | null = null;

    for (const m of messages) {
      if (!m?.ts) continue;
      const ts = new Date(m.ts).getTime();
      if (Number.isNaN(ts)) continue;

      if (inPeriod(m.ts, periodStart, periodEnd)) sawActivityInPeriod = true;

      if (m.role === 'user') {
        pendingUserTs = ts;
      } else if (m.role === 'assistant') {
        if (inPeriod(m.ts, periodStart, periodEnd)) {
          stats.messagesAnswered++;
          if (pendingUserTs !== null && ts >= pendingUserTs) {
            replyGaps.push((ts - pendingUserTs) / 1000);
          }
        }
        pendingUserTs = null;
      }
    }

    if (sawActivityInPeriod) {
      stats.conversationsByChannel[channel] = (stats.conversationsByChannel[channel] || 0) + 1;
    }

    if (inPeriod(row.created_at, periodStart, periodEnd)) {
      stats.newConversations++;
    }
  }

  if (replyGaps.length > 0) {
    stats.avgReplySeconds = Math.round(replyGaps.reduce((a, b) => a + b, 0) / replyGaps.length);
  }

  const requestsTable = REQUEST_TABLES[tenantType];
  if (requestsTable) {
    // hotel_requests stores timestamps as TEXT; gb_requests as native TIMESTAMPTZ.
    const createdCol  = requestsTable === 'hotel_requests' ? 'created_at::timestamptz'  : 'created_at';
    const resolvedCol = requestsTable === 'hotel_requests' ? 'resolved_at::timestamptz' : 'resolved_at';

    const [createdRow] = await query(
      `SELECT COUNT(*)::int AS count FROM ${requestsTable}
       WHERE tenant_id = ? AND ${createdCol} >= ? AND ${createdCol} < ?`,
      [tenantId, periodStart.toISOString(), periodEnd.toISOString()],
    ) as any[];
    const [resolvedRow] = await query(
      `SELECT COUNT(*)::int AS count FROM ${requestsTable}
       WHERE tenant_id = ? AND ${resolvedCol} >= ? AND ${resolvedCol} < ?`,
      [tenantId, periodStart.toISOString(), periodEnd.toISOString()],
    ) as any[];

    stats.requests = { created: createdRow?.count ?? 0, resolved: resolvedRow?.count ?? 0 };
  }

  return stats;
}
