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
    name: 'get_subscription_plans',
    description:
      'Fetch the active subscription plans configured for this studio. ' +
      'Call this when the parent asks about subscriptions, pricing, or plans. ' +
      'Returns plan name, description, number of classes per month, and monthly price.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'find_classes_for_age',
    description:
      'Search for available art classes that match a child\'s age in the next month. ' +
      'Returns classes with open spots, ordered by date. ' +
      'Use from_date = today and the tool will search a 4-week window automatically.',
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
      "IMPORTANT: call this ONLY after you have sent the full recap summary and the parent has replied with an explicit confirmation (yes/po or equivalent). Never call before confirmation.",
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

    // ── get_subscription_plans ─────────────────────────────────────────────
    case 'get_subscription_plans': {
      const plans = await dbAll(
        `SELECT name, description, classes_per_month, price FROM art_class_plans WHERE tenant_id = ? AND is_active = 1 ORDER BY price ASC`,
        tenantId,
      ) as any[];
      if (!plans.length) return JSON.stringify({ found: false, message: 'No subscription plans configured.' });
      return JSON.stringify({
        found: true,
        plans: plans.map((p: any) => ({
          name: p.name,
          description: p.description || '',
          classes_per_month: p.classes_per_month,
          price: `${p.price} ALL/month`,
        })),
      });
    }

    // ── find_classes_for_age ───────────────────────────────────────────────
    case 'find_classes_for_age': {
      const childAge  = Number(input.child_age);
      const fromDate  = (input.from_date as string | undefined) || today;
      const toDate    = format(addDays(parseISO(fromDate), 27), 'yyyy-MM-dd'); // 4-week window

      // PostgreSQL needs all SELECT columns in GROUP BY when not using pg-specific tricks
      const groupByCols = 'e.id, e.tenant_id, e.teacher_id, e.title, e.description, e.date, ' +
        'e.start_time, e.end_time, e.age_min, e.age_max, e.max_capacity, e.price, e.is_active, e.created_at, ' +
        's.name, s.color';

      const rows = await dbAll(`
        SELECT e.id, e.title, e.description, e.date, e.start_time, e.end_time,
               e.age_min, e.age_max, e.max_capacity, e.price,
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
        // Check if there were events for this age but all full
        const fullCheck = await dbAll(`
          SELECT COUNT(*) AS total
          FROM art_events e
          LEFT JOIN event_registrations r ON r.event_id = e.id
          WHERE e.tenant_id = ? AND e.is_active = 1
            AND e.date >= ? AND e.date <= ?
            AND (e.age_min IS NULL OR e.age_min <= ?)
            AND (e.age_max IS NULL OR e.age_max >= ?)
          GROUP BY e.id
          HAVING e.max_capacity IS NOT NULL AND COUNT(r.id) >= e.max_capacity
        `, tenantId, fromDate, toDate, childAge, childAge) as any[];
        const allFull = fullCheck.length > 0;
        return JSON.stringify({
          found: false,
          all_seats_taken: allFull,
          searched_from: fromDate,
          searched_to: toDate,
          next_from_date: nextSearch,
        });
      }

      return JSON.stringify({
        found: true,
        child_age: childAge,
        searched_from: fromDate,
        searched_to: toDate,
        classes: rows.map((r: any) => ({
          id: r.id,
          title: r.title,
          description: r.description || '',
          date: r.date,
          date_label: format(new Date(r.date), 'EEEE d MMMM yyyy'),
          time: `${r.start_time} – ${r.end_time}`,
          teacher: r.teacher_name || null,
          price: r.price ? `${r.price} ALL` : null,
          age_range: (r.age_min != null || r.age_max != null)
            ? `${r.age_min ?? '?'}–${r.age_max ?? '?'} years`
            : 'all ages',
        })),
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

  return `You are the registration assistant for ${tenant?.name || 'our art studio'}.
You help parents register their children for art classes via WhatsApp.
Always respond in the same language the parent writes in.
Today is ${now}.

=== GREETING ===
If the parent just says hi or hello, greet them warmly, introduce the studio as an art school for kids, and ask how you can help.
Do NOT ask for the child's age unprompted.

=== MAIN FLOW — when the parent asks about classes, subscriptions, prices, or registration ===

STEP 1 — ASK FOR THE CHILD'S AGE
If the age has not been mentioned, ask for it before doing anything else.

STEP 2 — EXPLAIN THE CLASS GROUP AND FETCH SUBSCRIPTION PLANS
Based on the child's age, tell the parent which group their child belongs to:
  - Age 0–3 years  → "Mom & Toddler" classes — every Tuesday and Thursday at 17:00 or 18:30 (1 hour each)
  - Age 0–8 years  → "Mix" classes — every Friday (check calendar for times)
  - Age 4–8 years  → regular classes — every Monday and Wednesday at 17:00 or 18:30 (1 hour each)

In the same message (or immediately after), call get_subscription_plans and present the available monthly subscription options clearly, including how many classes per month and the monthly price.

Ask the parent which plan interests them.

STEP 3 — CHECK AVAILABILITY
Once the parent expresses interest in a plan (or asks to see availability), call find_classes_for_age with the child's age and from_date = today. This returns all available slots in the next month.

Present the results as a clear list of available dates and times for that child's age group. Group by time slot if helpful.
Example format:
  "Here are the available slots for [child's age group] in the next month:
  Tuesdays at 17:00: 8 Apr, 15 Apr, 22 Apr, 29 Apr
  Tuesdays at 18:30: 8 Apr, 15 Apr, 22 Apr, 29 Apr
  Thursdays at 17:00: 10 Apr, 17 Apr, 24 Apr
  Thursdays at 18:30: 10 Apr, 17 Apr, 24 Apr"

Do NOT mention how many spots remain. Do NOT list individual class IDs to the parent.

STEP 4 — ASK FOR 4 PREFERRED DATES AND TIMES
Tell the parent that subscriptions are for 4 classes per month and ask them to choose 4 sessions from the available list.
Example: "A subscription covers 4 classes per month. Please choose 4 dates and times from the list above."

Wait for the parent to reply with their 4 chosen sessions.
If they choose fewer than 4, remind them to pick 4.
Match their chosen dates and times to the class IDs returned by find_classes_for_age.

STEP 5 — COLLECT NAMES
Ask for:
- Child's full name
- Parent's full name
Never ask for the phone number — it is captured from WhatsApp automatically.

STEP 6 — RECAP ALL 4 AND ASK FOR CONFIRMATION
Send a single recap message listing all 4 registrations and wait for the parent to confirm before calling register_for_class.
Format (adapt language):
  English:
    "Here is a summary of the registrations:
    👶 Child: [child name]
    👤 Parent: [parent name]
    1. [class title] — [day, date] at [time]
    2. [class title] — [day, date] at [time]
    3. [class title] — [day, date] at [time]
    4. [class title] — [day, date] at [time]
    💰 Plan: [plan name] — [price]
    Shall I complete all 4 registrations? (Yes / No)"
  Albanian:
    "Ja përmbledhja e regjistrimeve:
    👶 Fëmija: [emri]
    👤 Prindi: [emri]
    1. [klasa] — [dita, data] në orën [ora]
    2. [klasa] — [dita, data] në orën [ora]
    3. [klasa] — [dita, data] në orën [ora]
    4. [klasa] — [dita, data] në orën [ora]
    💰 Plani: [plani] — [çmimi]
    A i konfirmoj të 4 regjistrimet? (Po / Jo)"
Do NOT call register_for_class yet.

STEP 7 — REGISTER ALL 4
Only after the parent confirms — call register_for_class once for each of the 4 chosen classes, passing the same child_name and parent_name each time.

STEP 8 — SEND CLOSING MESSAGE
After all 4 registrations succeed, send one warm message confirming all 4 classes.
English: "Done! [child] is registered for all 4 classes. We look forward to seeing you! 🎨"
Albanian: "Gati! [child] është regjistruar për të 4 orët. Ju presim! 🎨"

=== OTHER SITUATIONS ===
- Parent asks about existing registrations → call get_my_registrations
- Parent wants to cancel → call get_my_registrations first, confirm class name and date, then cancel_registration
- A class is full between search and registration → apologise and call find_classes_for_age again to find alternatives

=== STYLE ===
- Short and conversational — this is WhatsApp
- Plain text only, no markdown
- Max 1–2 emojis per message
- Warm and encouraging`;
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
