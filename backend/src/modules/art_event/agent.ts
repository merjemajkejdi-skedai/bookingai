// Art Event module WhatsApp agent.
// Flow: greet → customer asks for events by type or date →
//       search 2-week window → present options → collect name → register.

import Anthropic from '@anthropic-ai/sdk';
import { format, addDays, parseISO } from 'date-fns';
import { prepare, isPg, query, queryOne, queryRun } from '../../db/database.js';

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
const tools: Anthropic.Tool[] = [
  {
    name: 'find_events',
    description:
      'Search for upcoming art events with available spots. ' +
      'Searches a 2-week window from from_date. ' +
      'Use specific_date to look for events on a particular day. ' +
      'Use keyword to filter by type (e.g. "painting", "ceramics", "drawing"). ' +
      'If nothing found in this window, next_from_date tells you where to search next.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from_date: {
          type: 'string',
          description: 'Start of 2-week search window (YYYY-MM-DD). Defaults to today if omitted.',
        },
        specific_date: {
          type: 'string',
          description: 'Search only on this exact date (YYYY-MM-DD). Overrides the 2-week window.',
        },
        keyword: {
          type: 'string',
          description: 'Optional keyword to filter events by title or description.',
        },
      },
      required: [],
    },
  },
  {
    name: 'register_for_event',
    description:
      'Register a participant for a specific art event. ' +
      'Call only after the customer has confirmed their choice and you have their name.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id:         { type: 'string', description: 'The event ID returned by find_events' },
        participant_name: { type: 'string', description: "Participant's full name" },
        notes:            { type: 'string', description: 'Optional notes' },
      },
      required: ['event_id', 'participant_name'],
    },
  },
  {
    name: 'get_my_registrations',
    description: 'List upcoming event registrations for this phone number.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'cancel_registration',
    description: 'Cancel an event registration by registration ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        registration_id: { type: 'string', description: 'The registration ID to cancel' },
      },
      required: ['registration_id'],
      cache_control: { type: 'ephemeral' } as any,
    },
  },
] as Anthropic.Tool[];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------
async function executeTool(
  name: string,
  input: Record<string, unknown>,
  customerPhone: string,
  tenantId: string,
): Promise<string> {
  const today = format(new Date(), 'yyyy-MM-dd');

  switch (name) {

    // ── find_events ──────────────────────────────────────────────────────────
    case 'find_events': {
      const fromDate     = (input.from_date as string | undefined) || today;
      const specificDate = input.specific_date as string | undefined;
      const keyword      = (input.keyword as string | undefined)?.toLowerCase().trim();

      const dateFrom = specificDate || fromDate;
      const dateTo   = specificDate
        ? specificDate                                              // single day
        : format(addDays(parseISO(fromDate), 13), 'yyyy-MM-dd');  // 2-week window

      const groupByCols =
        'e.id, e.tenant_id, e.teacher_id, e.title, e.description, e.date, ' +
        'e.start_time, e.end_time, e.age_min, e.age_max, e.max_capacity, e.price, ' +
        'e.is_active, e.created_at, s.name, s.color';

      const keywordClause = keyword
        ? `AND (LOWER(e.title) LIKE ? OR LOWER(COALESCE(e.description,'')) LIKE ?)`
        : '';
      const keywordParams = keyword ? [`%${keyword}%`, `%${keyword}%`] : [];

      const rows = await dbAll(`
        SELECT e.id, e.title, e.description, e.date, e.start_time, e.end_time,
               e.max_capacity, e.price,
               COUNT(r.id) AS registration_count,
               s.name AS teacher_name
        FROM art_events e
        LEFT JOIN event_registrations r ON r.event_id = e.id
        LEFT JOIN specialists s ON s.id = e.teacher_id
        WHERE e.tenant_id = ?
          AND e.is_active = 1
          AND e.date >= ?
          AND e.date <= ?
          ${keywordClause}
        GROUP BY ${groupByCols}
        HAVING (e.max_capacity IS NULL OR COUNT(r.id) < e.max_capacity)
        ORDER BY e.date, e.start_time
      `, tenantId, dateFrom, dateTo, ...keywordParams) as any[];

      if (!rows.length) {
        // Check if there were events but all full
        const fullRows = await dbAll(`
          SELECT COUNT(*) AS total
          FROM art_events e
          LEFT JOIN event_registrations r ON r.event_id = e.id
          WHERE e.tenant_id = ? AND e.is_active = 1
            AND e.date >= ? AND e.date <= ?
            ${keywordClause}
          GROUP BY e.id
          HAVING e.max_capacity IS NOT NULL AND COUNT(r.id) >= e.max_capacity
        `, tenantId, dateFrom, dateTo, ...keywordParams) as any[];

        const nextFrom = format(addDays(parseISO(dateTo), 1), 'yyyy-MM-dd');
        return JSON.stringify({
          found: false,
          all_seats_taken: fullRows.length > 0,
          searched_from: dateFrom,
          searched_to: dateTo,
          next_from_date: nextFrom,
        });
      }

      return JSON.stringify({
        found: true,
        searched_from: dateFrom,
        searched_to: dateTo,
        events: rows.map((r: any) => ({
          id: r.id,
          title: r.title,
          description: r.description || '',
          date: r.date,
          date_label: format(new Date(r.date), 'EEEE d MMMM yyyy'),
          time: `${r.start_time} – ${r.end_time}`,
          teacher: r.teacher_name || null,
          price: r.price ? `${r.price} ALL` : null,
        })),
      });
    }

    // ── register_for_event ───────────────────────────────────────────────────
    case 'register_for_event': {
      const { event_id, participant_name, notes = '' } = input as any;

      const event = await dbGet(
        'SELECT * FROM art_events WHERE id = ? AND tenant_id = ? AND is_active = 1',
        event_id, tenantId
      ) as any;
      if (!event) return JSON.stringify({ error: 'Event not found' });
      if (event.date < today) return JSON.stringify({ error: 'This event has already passed' });

      if (event.max_capacity) {
        const cnt = await dbGet(
          'SELECT COUNT(*) as cnt FROM event_registrations WHERE event_id = ?', event_id
        ) as any;
        if (Number(cnt?.cnt || 0) >= event.max_capacity) {
          return JSON.stringify({ error: 'This event is now full. Please search for another event.' });
        }
      }

      const id = crypto.randomUUID();
      await dbRun(
        'INSERT INTO event_registrations(id,event_id,tenant_id,participant_name,parent_phone,parent_name,notes) VALUES(?,?,?,?,?,?,?)',
        id, event_id, tenantId, participant_name, customerPhone, '', notes
      );
      console.log(`📝 Art event registration id=${id} participant="${participant_name}" event="${event.title}" date=${event.date} tenant=${tenantId}`);

      return JSON.stringify({
        success: true,
        registration_id: id,
        participant_name,
        event_title: event.title,
        date_label: format(new Date(event.date), 'EEEE d MMMM yyyy'),
        time: `${event.start_time} – ${event.end_time}`,
        price: event.price ? `${event.price} ALL` : null,
      });
    }

    // ── get_my_registrations ─────────────────────────────────────────────────
    case 'get_my_registrations': {
      const rows = await dbAll(`
        SELECT r.id, r.participant_name, r.registered_at,
               e.id as event_id, e.title, e.date, e.start_time, e.end_time
        FROM event_registrations r
        JOIN art_events e ON e.id = r.event_id
        WHERE r.parent_phone = ? AND e.date >= ? AND e.is_active = 1
        ORDER BY e.date, e.start_time
      `, customerPhone, today) as any[];

      if (!rows.length) return JSON.stringify({ found: false, message: 'No upcoming event registrations found for your number.' });

      return JSON.stringify({
        found: true,
        registrations: rows.map((r: any) => ({
          id: r.id,
          participant: r.participant_name,
          event: r.title,
          event_id: r.event_id,
          date: format(new Date(r.date), 'EEEE d MMMM yyyy'),
          time: `${r.start_time} – ${r.end_time}`,
        })),
      });
    }

    // ── cancel_registration ──────────────────────────────────────────────────
    case 'cancel_registration': {
      const { registration_id } = input as { registration_id: string };
      const reg = await dbGet(`
        SELECT r.*, e.title, e.date, e.start_time
        FROM event_registrations r
        JOIN art_events e ON e.id = r.event_id
        WHERE r.id = ? AND r.parent_phone = ?
      `, registration_id, customerPhone) as any;
      if (!reg) return JSON.stringify({ error: 'Registration not found or does not belong to this number.' });

      await dbRun('DELETE FROM event_registrations WHERE id = ?', registration_id);
      return JSON.stringify({
        success: true,
        message: `Cancelled registration for ${reg.participant_name} from "${reg.title}" on ${format(new Date(reg.date), 'EEEE d MMMM')}.`,
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
async function buildSystemPrompt(tenantId: string): Promise<string> {
  const tenant = await dbGet('SELECT name FROM tenants WHERE id = ?', tenantId) as any;
  const now = format(new Date(), "EEEE d MMMM yyyy, HH:mm");

  return `You are the event registration assistant for ${tenant?.name || 'our art studio'}.
You help customers find upcoming art events and register for them via WhatsApp.
Always respond in the same language the customer writes in.
Today is ${now}.

=== GREETING ===
If the customer just says hi or hello, greet them warmly, briefly introduce the studio, and ask how you can help.
Do NOT list events or ask questions unprompted — wait until they express interest.

=== FLOW — follow this once the customer asks about events or registration ===

STEP 1 — UNDERSTAND WHAT THEY WANT
The customer may ask in two ways:
- By type/interest: "do you have painting events?", "what's coming up this week?"
  → call find_events with keyword (if they mentioned a type) and from_date = today
- By specific date: "what events do you have on Friday?" or "anything on 15 April?"
  → call find_events with specific_date

STEP 2 — SEARCH
Call find_events. The tool returns events with open spots.
If found=false and all_seats_taken=true → all seats are taken for that period.
If found=false and all_seats_taken=false → no events scheduled for that period.
You may call again with next_from_date up to 2 times to look further ahead if the customer asks.

STEP 3 — PRESENT OPTIONS
List found events clearly. Do NOT mention how many spots remain.
Always include the price per person.
- One event: describe it (title, description, date, time, price) and ask if they want to register.
- Multiple events: number them so the customer can pick.
  Example:
    "I found 2 events coming up:
    1. Watercolour Workshop — Monday 7 April, 18:00–20:00
       Learn watercolour basics with our resident artist. 1500 ALL per person.
    2. Ceramics Evening — Thursday 10 April, 19:00–21:00
       Hands-on pottery for beginners. 2000 ALL per person.
    Which one interests you?"

When no events are available:
- If all_seats_taken=true: "All spots are taken for that period. Would you like me to check a different date?"
- If no events at all: "There are no events scheduled for that period. Would you like me to check further ahead?"

STEP 4 — COLLECT NAME
Once the customer picks an event, ask for their full name.
Never ask for a phone number — it is captured automatically from WhatsApp.

STEP 5 — REGISTER
Call register_for_event with event_id and participant_name.

STEP 6 — CONFIRM
Send a warm closing message. Include their name, event title, date, time and price.
English:  "Done! You're registered for [event] on [day date] at [time]. See you there! 🎨"
Albanian: "Gati! Jeni regjistruar për [event] të [ditën] [data] në orën [time]. Ju presim! 🎨"
Never send a confirmation without first calling register_for_event.

=== OTHER SITUATIONS ===
- Customer asks about existing registrations → call get_my_registrations
- Customer wants to cancel → call get_my_registrations first, confirm event name and date, then cancel_registration
- Event turns full between search and registration → apologise, call find_events again

=== STYLE ===
- Short and conversational — this is WhatsApp
- Plain text only, no markdown
- Max 1–2 emojis per message
- Warm and helpful`;
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------
async function callClaudeWithRetry(
  params: Parameters<typeof client.messages.create>[0],
  maxRetries = 4,
): Promise<Anthropic.Message> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? 0;
      const isRetryable = status === 529 || status === 429 || status >= 500 ||
        err?.message?.includes('overloaded') || err?.message?.includes('rate limit');
      if (!isRetryable || attempt === maxRetries) break;
      const waitMs = Math.min(2000 * Math.pow(2, attempt), 16000);
      console.log(`⚠️  Claude overloaded (attempt ${attempt + 1}/${maxRetries + 1}) — retrying in ${waitMs / 1000}s...`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Main agent
// ---------------------------------------------------------------------------
export async function runArtEventAgent(
  customerMessage: string,
  conversationHistory: Anthropic.MessageParam[],
  customerPhone: string,
  tenantId: string,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...conversationHistory,
    { role: 'user', content: customerMessage },
  ];

  while (true) {
    const response = await callClaudeWithRetry({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [{ type: 'text' as const, text: await buildSystemPrompt(tenantId), cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
    });

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`🔧 Tool call: ${block.name}`, JSON.stringify(block.input).slice(0, 120));
          const result = await executeTool(block.name, block.input as Record<string, unknown>, customerPhone, tenantId);
          console.log(`✅ Tool result: ${result.slice(0, 120)}`);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        }
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    const textBlock = response.content.find(b => b.type === 'text');
    return textBlock && textBlock.type === 'text'
      ? textBlock.text
      : 'Sorry, I had trouble processing that. Please try again.';
  }
}
