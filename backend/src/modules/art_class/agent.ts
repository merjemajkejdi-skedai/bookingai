// Art Class module WhatsApp agent.
// Flow: ask child age → find matching available classes (week by week) →
//       present options → collect parent name + child name → register.

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
    name: 'find_classes_for_age',
    description:
      'Search for available art classes that match a child\'s age. ' +
      'Returns classes with open spots, ordered by date. ' +
      'If nothing is found in the searched window you will be told the next date to search from — call again with that date to look further ahead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        child_age: {
          type: 'number',
          description: "Child's age in years",
        },
        from_date: {
          type: 'string',
          description: 'Start of search window (YYYY-MM-DD). Defaults to today if omitted.',
        },
      },
      required: ['child_age'],
    },
  },
  {
    name: 'register_for_class',
    description:
      "Register a child for a specific art class. " +
      "Call only after the parent has confirmed their choice and you have both child_name and parent_name.",
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id:    { type: 'string', description: 'The class ID returned by find_classes_for_age' },
        child_name:  { type: 'string', description: "Child's full name" },
        parent_name: { type: 'string', description: "Parent or guardian's full name" },
        notes:       { type: 'string', description: 'Optional notes (allergies, special needs, etc.)' },
      },
      required: ['event_id', 'child_name', 'parent_name'],
    },
  },
  {
    name: 'get_my_registrations',
    description: "List upcoming class registrations for this phone number.",
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'cancel_registration',
    description: 'Cancel a class registration by registration ID.',
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

    // ── find_classes_for_age ───────────────────────────────────────────────
    case 'find_classes_for_age': {
      const childAge  = Number(input.child_age);
      const fromDate  = (input.from_date as string | undefined) || today;
      const toDate    = format(addDays(parseISO(fromDate), 27), 'yyyy-MM-dd'); // 4-week window

      // PostgreSQL needs all SELECT columns in GROUP BY when not using pg-specific tricks
      const groupByCols = 'e.id, e.tenant_id, e.teacher_id, e.title, e.description, e.date, ' +
        'e.start_time, e.end_time, e.age_min, e.age_max, e.max_capacity, e.is_active, e.created_at, ' +
        's.name, s.color';

      const rows = await dbAll(`
        SELECT e.id, e.title, e.description, e.date, e.start_time, e.end_time,
               e.age_min, e.age_max, e.max_capacity,
               COUNT(r.id) AS registration_count,
               s.name AS teacher_name
        FROM art_events e
        LEFT JOIN event_registrations r ON r.event_id = e.id
        LEFT JOIN specialists s ON s.id = e.teacher_id
        WHERE e.tenant_id = ?
          AND e.is_active = 1
          AND e.date >= ?
          AND e.date <= ?
          AND (e.age_min IS NULL OR e.age_min <= ?)
          AND (e.age_max IS NULL OR e.age_max >= ?)
        GROUP BY ${groupByCols}
        HAVING (e.max_capacity IS NULL OR COUNT(r.id) < e.max_capacity)
        ORDER BY e.date, e.start_time
      `, tenantId, fromDate, toDate, childAge, childAge) as any[];

      if (!rows.length) {
        const nextSearch = format(addDays(parseISO(toDate), 1), 'yyyy-MM-dd');
        return JSON.stringify({
          found: false,
          searched_from: fromDate,
          searched_to: toDate,
          next_from_date: nextSearch,
          message: `No available classes found for age ${childAge} between ${fromDate} and ${toDate}. To look further ahead call again with from_date="${nextSearch}".`,
        });
      }

      return JSON.stringify({
        found: true,
        child_age: childAge,
        searched_from: fromDate,
        searched_to: toDate,
        classes: rows.map((r: any) => {
          const spotsLeft = r.max_capacity
            ? Math.max(0, r.max_capacity - Number(r.registration_count))
            : null;
          return {
            id: r.id,
            title: r.title,
            description: r.description || '',
            date: r.date,
            date_label: format(new Date(r.date), 'EEEE d MMMM yyyy'),
            time: `${r.start_time} – ${r.end_time}`,
            teacher: r.teacher_name || null,
            age_range: (r.age_min != null || r.age_max != null)
              ? `${r.age_min ?? '?'}–${r.age_max ?? '?'} years`
              : 'all ages',
            spots_left: spotsLeft ?? 'unlimited',
          };
        }),
      });
    }

    // ── register_for_class ─────────────────────────────────────────────────
    case 'register_for_class': {
      const { event_id, child_name, parent_name, notes = '' } = input as any;

      const event = await dbGet(
        'SELECT * FROM art_events WHERE id = ? AND tenant_id = ? AND is_active = 1',
        event_id, tenantId
      ) as any;
      if (!event) return JSON.stringify({ error: 'Class not found' });
      if (event.date < today) return JSON.stringify({ error: 'This class has already passed' });

      if (event.max_capacity) {
        const cnt = await dbGet(
          'SELECT COUNT(*) as cnt FROM event_registrations WHERE event_id = ?', event_id
        ) as any;
        if (Number(cnt?.cnt || 0) >= event.max_capacity) {
          return JSON.stringify({ error: 'This class is now full. Please search for another class.' });
        }
      }

      const id = crypto.randomUUID();
      await dbRun(
        'INSERT INTO event_registrations(id,event_id,tenant_id,participant_name,parent_phone,parent_name,notes) VALUES(?,?,?,?,?,?,?)',
        id, event_id, tenantId, child_name, customerPhone, parent_name, notes
      );
      console.log(`📝 Art class registration id=${id} child="${child_name}" parent="${parent_name}" event="${event.title}" date=${event.date} tenant=${tenantId}`);

      return JSON.stringify({
        success: true,
        registration_id: id,
        child_name,
        parent_name,
        class_title: event.title,
        date_label: format(new Date(event.date), 'EEEE d MMMM yyyy'),
        time: `${event.start_time} – ${event.end_time}`,
      });
    }

    // ── get_my_registrations ───────────────────────────────────────────────
    case 'get_my_registrations': {
      const rows = await dbAll(`
        SELECT r.id, r.participant_name, r.parent_name, r.registered_at,
               e.id as event_id, e.title, e.date, e.start_time, e.end_time,
               s.name as teacher_name
        FROM event_registrations r
        JOIN art_events e ON e.id = r.event_id
        LEFT JOIN specialists s ON s.id = e.teacher_id
        WHERE r.parent_phone = ? AND e.date >= ? AND e.is_active = 1
        ORDER BY e.date, e.start_time
      `, customerPhone, today) as any[];

      if (!rows.length) return JSON.stringify({ found: false, message: 'No upcoming registrations found for your number.' });

      return JSON.stringify({
        found: true,
        registrations: rows.map((r: any) => ({
          id: r.id,
          child: r.participant_name,
          parent: r.parent_name,
          class: r.title,
          event_id: r.event_id,
          teacher: r.teacher_name || null,
          date: format(new Date(r.date), 'EEEE d MMMM yyyy'),
          time: `${r.start_time} – ${r.end_time}`,
        })),
      });
    }

    // ── cancel_registration ────────────────────────────────────────────────
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

  return `You are the class registration assistant for ${tenant?.name || 'our art studio'}.
You help parents register their children for art classes via WhatsApp.
Always respond in the same language the parent writes in.
Today is ${now}.

=== CONVERSATION FLOW — FOLLOW THIS EXACTLY ===

STEP 1 — GET THE CHILD'S AGE
If the parent has not mentioned the child's age, ask for it before anything else.
Do not list or mention any classes until you know the age.

STEP 2 — SEARCH FOR MATCHING CLASSES
Once you have the age, call find_classes_for_age with child_age.
- The tool searches the next 4 weeks for classes with matching age range AND available spots.
- If no classes found, call again with the returned next_from_date to look further ahead (up to 3 searches).
- If still nothing found after 3 searches, tell the parent there are no upcoming classes for that age and invite them to check back later.

STEP 3 — PRESENT OPTIONS
- If one class matches: describe it (title, description, date, time, teacher, spots left) and ask if they want to register.
- If multiple classes match: list them with number labels so the parent can pick one.
  Example:
    "I found 2 classes for your child:
    1. Drawing Basics — Mon 7 Apr, 10:00–11:00 (3 spots left)
       Great for beginners, ages 5–8.
    2. Watercolour Fun — Wed 9 Apr, 15:00–16:00 (5 spots left)
       Learn watercolour painting, ages 5–10.
    Which one interests you?"

STEP 4 — COLLECT NAMES
Once the parent has chosen a class, ask for:
- Child's full name
- Parent's full name
Phone number is captured automatically — never ask for it.

STEP 5 — REGISTER
Call register_for_class with event_id, child_name, parent_name.

STEP 6 — CONFIRM
After successful registration send a warm confirmation:
- Language matches parent
- Include: child name, class title, date, time
- Example (English): "Done! [child] is registered for [class] on [day date] at [time]. See you there! 🎨"
- Example (Albanian): "Gati! [child] është regjistruar për [class] të [ditën] [data] në orën [time]. Ju presim! 🎨"
NEVER send a confirmation without first calling register_for_class.

=== OTHER SITUATIONS ===
- Parent asks about existing bookings → call get_my_registrations
- Parent wants to cancel → call get_my_registrations first, confirm, then cancel_registration
- Class becomes full between search and registration → apologise, call find_classes_for_age again to find alternatives

=== RULES ===
1. Never mention a specific class until you know the child's age.
2. Only show classes that have available spots (the tool already filters full classes).
3. Never ask for the phone number — it is captured from WhatsApp automatically.
4. Notes (allergies, special needs) are optional — only ask if the parent volunteers the information.
5. Keep messages short and conversational — this is WhatsApp.
6. Plain text only, no markdown, no bullet dashes.
7. Emojis: max 1–2 per message.
8. Be warm and encouraging — parents love hearing their child will enjoy the class.`;
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
export async function runArtClassAgent(
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
