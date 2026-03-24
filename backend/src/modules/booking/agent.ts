// Booking module WhatsApp agent — handles appointment booking, rescheduling, cancellation.
// Extracted from whatsapp/agent.ts so booking changes never touch art_event or art_class.

import Anthropic from '@anthropic-ai/sdk';
import { format } from 'date-fns';
import { prepare, isPg, query, queryOne, queryRun } from '../../db/database.js';

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// ---------------------------------------------------------------------------
// Tools Claude can call
// ---------------------------------------------------------------------------
const tools: Anthropic.Tool[] = [
  {
    name: 'get_specialists',
    description: 'Get the list of available specialists and their working hours',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_services',
    description: 'Get the list of services offered, including duration and price',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'check_availability',
    description: 'Check available time slots for a specialist on a given date',
    input_schema: {
      type: 'object' as const,
      properties: {
        specialist_id: { type: 'string', description: 'The specialist ID' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        duration_mins: { type: 'number', description: 'Duration of the service in minutes' },
      },
      required: ['specialist_id', 'date', 'duration_mins'],
    },
  },
  {
    name: 'create_booking',
    description: 'Create a confirmed booking for a customer',
    input_schema: {
      type: 'object' as const,
      properties: {
        specialist_id: { type: 'string', description: 'The specialist ID' },
        service_id: { type: 'string', description: 'The service ID' },
        customer_name: { type: 'string', description: 'Full name of the customer' },
        starts_at: { type: 'string', description: 'Start time in ISO format: YYYY-MM-DDTHH:mm:ss' },
        notes: { type: 'string', description: 'Any additional notes' },
      },
      required: ['specialist_id', 'service_id', 'customer_name', 'starts_at'],
    },
  },
  {
    name: 'get_booking',
    description: "Look up the customer's upcoming bookings in the next 30 days. Phone is injected automatically.",
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'cancel_booking',
    description: 'Cancel an existing booking by booking ID',
    input_schema: {
      type: 'object' as const,
      properties: {
        booking_id: { type: 'string', description: 'The booking ID to cancel' },
        reason: { type: 'string', description: 'Reason for cancellation' },
      },
      required: ['booking_id'],
    },
  },
  {
    name: 'reschedule_booking',
    description: 'Reschedule an existing booking to a new date and time.',
    input_schema: {
      type: 'object' as const,
      properties: {
        booking_id: { type: 'string', description: 'The booking ID to reschedule' },
        new_starts_at: { type: 'string', description: 'New start time in ISO format: YYYY-MM-DDTHH:mm:ss' },
      },
      required: ['booking_id', 'new_starts_at'],
    },
    cache_control: { type: 'ephemeral' } as const,
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
  switch (name) {
    case 'get_specialists': {
      let rows: any[];
      if (isPg) {
        rows = await query(`
          SELECT s.id, s.name, s.role,
            json_agg(json_build_object('day',wh.day_of_week,'start',wh.start_time,'end',wh.end_time,'working',wh.is_working))
            FILTER (WHERE wh.id IS NOT NULL) AS hours
          FROM specialists s
          LEFT JOIN working_hours wh ON wh.specialist_id = s.id
          WHERE s.tenant_id = $1 AND s.is_active = 1
          GROUP BY s.id
        `, [tenantId]);
      } else {
        rows = prepare(`
          SELECT s.id, s.name, s.role,
            json_group_array(json_object('day',wh.day_of_week,'start',wh.start_time,'end',wh.end_time,'working',wh.is_working)) as hours
          FROM specialists s
          LEFT JOIN working_hours wh ON wh.specialist_id = s.id
          WHERE s.tenant_id = ? AND s.is_active = 1
          GROUP BY s.id
        `).all(tenantId);
      }
      return JSON.stringify(rows.map((r: any) => ({
        id: r.id, name: r.name, role: r.role,
        workingHours: (isPg ? (r.hours || []) : JSON.parse(r.hours || '[]'))
          .filter((h: any) => h.working)
          .map((h: any) => `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][h.day]}: ${h.start}–${h.end}`)
          .join(', '),
      })));
    }

    case 'get_services': {
      const rows = await dbAll('SELECT id,name,duration_mins,price FROM services WHERE tenant_id=? AND is_active=1 ORDER BY name', tenantId);
      return JSON.stringify((rows as any[]).map((r: any) => ({
        id: r.id, name: r.name,
        duration: `${r.duration_mins} min`,
        price: `${r.price} ALL`,
      })));
    }

    case 'check_availability': {
      const { specialist_id, date, duration_mins } = input as { specialist_id: string; date: string; duration_mins: number };
      const dayOfWeek = new Date(date).getDay();

      const wh = await dbGet('SELECT start_time,end_time,is_working FROM working_hours WHERE specialist_id=? AND day_of_week=?', specialist_id, dayOfWeek) as any;
      if (!wh || !wh.is_working) return JSON.stringify({ available: false, message: 'Specialist does not work on this day' });

      const booked = await dbAll("SELECT starts_at,ends_at FROM bookings WHERE specialist_id=? AND starts_at LIKE ? AND status!='cancelled'", specialist_id, `${date}%`) as any[];

      const norm = (ts: string) => String(ts).slice(0, 19);
      const slots: string[] = [];
      let cur = new Date(`${date}T${wh.start_time}:00`);
      const end = new Date(`${date}T${wh.end_time}:00`);

      while (new Date(cur.getTime() + duration_mins * 60000) <= end) {
        const slotEnd = new Date(cur.getTime() + duration_mins * 60000);
        const curStr = format(cur, "yyyy-MM-dd'T'HH:mm:ss");
        const endStr = format(slotEnd, "yyyy-MM-dd'T'HH:mm:ss");
        const busy = booked.some((b: any) => {
          const bs = norm(b.starts_at), be = norm(b.ends_at);
          return curStr < be && endStr > bs;
        });
        if (!busy) slots.push(format(cur, 'HH:mm'));
        cur = new Date(cur.getTime() + 15 * 60000);
      }

      return JSON.stringify({ date, specialist_id, available_slots: slots, total_available: slots.length });
    }

    case 'create_booking': {
      const { specialist_id, service_id, customer_name, starts_at, notes } = input as any;
      console.log(`📅 create_booking called — tenant:${tenantId} specialist:${specialist_id} service:${service_id} starts_at:${starts_at} customer:${customer_name}`);

      const svc = await dbGet('SELECT duration_mins,name FROM services WHERE id=?', service_id) as any;
      if (!svc) {
        console.error(`❌ create_booking: service not found id=${service_id}`);
        return JSON.stringify({ error: 'Service not found' });
      }

      const endsAt = format(new Date(new Date(starts_at).getTime() + svc.duration_mins * 60000), "yyyy-MM-dd'T'HH:mm:ss");

      // Conflict check — use SUBSTRING for cross-DB compat (PostgreSQL supports both LEFT and SUBSTRING)
      const conflict = await dbGet(
        "SELECT id FROM bookings WHERE specialist_id=? AND status!='cancelled' AND SUBSTRING(starts_at,1,19) < ? AND SUBSTRING(ends_at,1,19) > ?",
        specialist_id, endsAt.slice(0, 19), starts_at.slice(0, 19)
      );
      if (conflict) return JSON.stringify({ error: 'This slot was just taken. Please check availability again.' });

      const spec = await dbGet('SELECT name FROM specialists WHERE id=?', specialist_id) as any;
      const id = crypto.randomUUID();
      try {
        await dbRun(
          'INSERT INTO bookings(id,tenant_id,specialist_id,service_id,customer_name,customer_phone,starts_at,ends_at,status,notes,recurrence_rule) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          id, tenantId, specialist_id, service_id, customer_name || 'Customer', customerPhone, starts_at, endsAt, 'confirmed', notes || '', 'none'
        );
        console.log(`✅ Booking created id=${id} tenant=${tenantId} starts_at=${starts_at}`);
      } catch (insertErr: any) {
        console.error(`❌ create_booking INSERT failed:`, insertErr.message);
        return JSON.stringify({ error: `Failed to save booking: ${insertErr.message}` });
      }

      return JSON.stringify({
        success: true, booking_id: id,
        summary: `✅ Booked! ${svc.name} with ${spec?.name} on ${format(new Date(starts_at), 'EEEE d MMMM')} at ${format(new Date(starts_at), 'HH:mm')}`,
      });
    }

    case 'get_booking': {
      const now = format(new Date(), "yyyy-MM-dd'T'HH:mm:ss");
      const in30 = format(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), "yyyy-MM-dd'T'HH:mm:ss");

      const rows = await dbAll(`
        SELECT b.id, b.starts_at, b.ends_at, b.status, b.specialist_id, b.service_id,
               s.name as specialist, sv.name as service, sv.duration_mins
        FROM bookings b
        JOIN specialists s ON s.id = b.specialist_id
        JOIN services sv ON sv.id = b.service_id
        WHERE b.customer_phone = ?
          AND b.status = 'confirmed'
          AND b.starts_at >= ?
          AND b.starts_at <= ?
        ORDER BY b.starts_at ASC
        LIMIT 5
      `, customerPhone, now, in30) as any[];

      if (!rows.length) return JSON.stringify({ found: false, message: 'No confirmed bookings found in the next 30 days.' });

      return JSON.stringify({
        found: true,
        bookings: rows.map((r: any) => ({
          id: r.id, service: r.service, specialist: r.specialist,
          specialist_id: r.specialist_id, service_id: r.service_id, duration_mins: r.duration_mins,
          date: format(new Date(r.starts_at.slice(0, 19)), 'EEEE d MMMM yyyy'),
          time: format(new Date(r.starts_at.slice(0, 19)), 'HH:mm'),
          starts_at: r.starts_at.slice(0, 19), ends_at: r.ends_at.slice(0, 19),
        }))
      });
    }

    case 'cancel_booking': {
      const { booking_id, reason = '' } = input as { booking_id: string; reason?: string };
      const booking = await dbGet(`
        SELECT b.*, s.name as specialist, sv.name as service
        FROM bookings b
        JOIN specialists s ON s.id = b.specialist_id
        JOIN services sv ON sv.id = b.service_id
        WHERE b.id = ?
      `, booking_id) as any;
      if (!booking) return JSON.stringify({ error: 'Booking not found' });

      await dbRun("UPDATE bookings SET status='cancelled' WHERE id=?", booking_id);
      const dateStr = format(new Date(booking.starts_at.slice(0, 19)), 'EEEE d MMMM');
      const timeStr = format(new Date(booking.starts_at.slice(0, 19)), 'HH:mm');
      return JSON.stringify({ success: true, message: `Cancelled: ${booking.service} with ${booking.specialist} on ${dateStr} at ${timeStr}.` });
    }

    case 'reschedule_booking': {
      const { booking_id, new_starts_at } = input as { booking_id: string; new_starts_at: string };
      const booking = await dbGet(`
        SELECT b.*, s.name as specialist, sv.name as service, sv.duration_mins
        FROM bookings b
        JOIN specialists s ON s.id = b.specialist_id
        JOIN services sv ON sv.id = b.service_id
        WHERE b.id = ? AND b.status = 'confirmed'
      `, booking_id) as any;
      if (!booking) return JSON.stringify({ error: 'Booking not found or already cancelled' });

      const newEndsAt = format(
        new Date(new Date(new_starts_at).getTime() + booking.duration_mins * 60000),
        "yyyy-MM-dd'T'HH:mm:ss"
      );
      const conflict = await dbGet(`
        SELECT id FROM bookings
        WHERE specialist_id = ? AND id != ? AND status != 'cancelled'
          AND LEFT(starts_at,19) < ? AND LEFT(ends_at,19) > ?
      `, booking.specialist_id, booking_id, newEndsAt, new_starts_at) as any;

      if (conflict) return JSON.stringify({ error: 'That slot is no longer available. Please check availability.' });

      await dbRun('UPDATE bookings SET starts_at=?, ends_at=? WHERE id=?', new_starts_at, newEndsAt, booking_id);
      const newDateStr = format(new Date(new_starts_at), 'EEEE d MMMM yyyy');
      const newTimeStr = format(new Date(new_starts_at), 'HH:mm');
      return JSON.stringify({ success: true, message: `Rescheduled: ${booking.service} with ${booking.specialist} → ${newDateStr} at ${newTimeStr}` });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
async function buildSystemPrompt(tenantId: string): Promise<string> {
  const tenant = await dbGet('SELECT name, type FROM tenants WHERE id = ?', tenantId) as any;
  const now = format(new Date(), "EEEE d MMMM yyyy, HH:mm");

  const specialists = await dbAll('SELECT id, name, role FROM specialists WHERE tenant_id = ? AND is_active = 1', tenantId) as any[];
  const services = await dbAll('SELECT id, name, duration_mins, price FROM services WHERE tenant_id = ? AND is_active = 1', tenantId) as any[];

  const specialistList = specialists.map((s: any) => `- ${s.name} (${s.role}) — id: ${s.id}`).join('\n');
  const serviceList = services.map((s: any) => `- ${s.name}, ${s.duration_mins} min, ${s.price} ALL — id: ${s.id}`).join('\n');

  return `You are the booking assistant for ${tenant?.name || 'the salon'}, a ${tenant?.type || 'barbershop'}.
You ONLY help customers book, reschedule, cancel, or check appointments. Do not discuss anything else.
Always respond in the same language the customer writes in.
Today is ${now}.

=== OUR TEAM ===
${specialistList}

=== OUR SERVICES ===
${serviceList}

=== GOLDEN RULE — MINIMUM MESSAGES ===
Every extra message you send is friction. Your goal is to complete a booking in 3 customer messages maximum:
  1. Customer says what they want
  2. You show the summary and ask "Confirm? (Yes/No)"
  3. Customer says yes → you book it and confirm

=== BOOKING — HOW TO HANDLE ===
On the VERY FIRST message, ask for ALL missing info at once in a single message:
  "Name, service, specialist (or any available), and when? (day + time)"
Never send one question per message.

Once you have: name + service + specialist + date/time
→ Immediately call check_availability (do NOT ask permission first)
→ If the slot is free: show the summary and ask "Confirm? (Yes/No)" — ONE message
→ If the customer says yes/po/ok/confirm/dakord/sure → YOU MUST call create_booking immediately.
  DO NOT send any confirmation text without calling create_booking first.
  The booking only exists after create_booking is called. Without calling the tool, nothing is saved.
→ After create_booking returns success, THEN send the confirmation message. Done.

If the requested slot is taken:
→ Pick 2-3 alternatives from check_availability results and offer them in ONE message
→ When customer picks one → book it immediately without asking again

If customer gives everything in the first message (e.g. "haircut with Gent Monday 10:00"):
→ Skip asking questions entirely — go straight to check_availability then summary

=== NAME RULE ===
Ask for the customer's name ONLY if you don't have it yet — combine it with other questions, never alone.
Never ask for phone number (it is captured automatically).

=== CANCELLATION — 2 MESSAGES MAX ===
Customer says cancel → call get_booking immediately (no input needed)
→ Show booking(s) and ask "Cancel this? (Yes/No)" in ONE message
→ Yes → call cancel_booking immediately and confirm. Done.

=== RESCHEDULE — 3 MESSAGES MAX ===
Customer says reschedule → call get_booking immediately
→ Show current booking, ask for new date/time in ONE message
→ Call check_availability → if free, show "New time: X. Confirm? (Yes/No)"
→ Yes → call reschedule_booking immediately and confirm. Done.

=== RULES ===
- ALWAYS trust check_availability results. If a slot is in available_slots it IS free — never doubt it.
- NEVER invent names, services, prices or durations — use the lists above only.
- NEVER ask for confirmation more than once per booking.
- If a slot is free and customer already said yes (or their first message implied confirmation) → book it.
- NEVER send a booking confirmation text without first calling create_booking. The database is only updated when you call the tool — your text alone saves nothing.
- If you see a conversation history showing a pre-booking summary and the customer just said yes/po/ok/dakord, you MUST call create_booking with the details from that summary before replying.

=== MESSAGE STYLE ===
- Short and conversational — this is WhatsApp, not email
- Plain text only — no markdown, no bullet points
- Use emojis sparingly (1-2 max)
- Always write times in HH:mm format (e.g. 09:00, 14:30)
- Pre-booking summary format (before customer confirms):
  Service: [name]
  Specialist: [name]
  Date: [day] [date] [month]
  Time: [HH:mm]
  Price: [price] ALL
  Confirm? (Yes/No)

=== AFTER BOOKING IS CREATED ===
Once create_booking succeeds, send a warm closing message in the SAME language the customer used.
It must contain exactly three things — nothing more, nothing less:
  1. A thank-you (e.g. "Faleminderit!" / "Thank you!")
  2. The confirmed details: service, specialist, date, time
  3. A friendly see-you (e.g. "Deri të premten!" / "See you on Friday!" / "Ju presim!")

Examples:
  Albanian: "Faleminderit! Takimi juaj për [service] me [specialist] është konfirmuar për [ditën] [data] në orën [HH:mm]. Ju presim! 👋"
  English:  "Thank you! Your [service] with [specialist] is confirmed for [day] [date] at [HH:mm]. See you then! 👋"

NEVER say just "e pret" or leave an incomplete sentence. Always write a full, warm closing.`;
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

const HAIKU_MODEL  = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// NOTE: agreement/confirmation words (yes/po/ok/confirm/dakord) are intentionally
// excluded here — they look simple but trigger create_booking/cancel_booking tool
// calls that Haiku handles unreliably. Only true greetings and sign-offs use Haiku.
const SIMPLE_PATTERNS = [
  /^(hi|hello|hey|hej|allo|pershendetje|miredita|mirembrema|mirenat)\b/i,
  /^(faleminderit|thanks|thank you|ty|thx|mersi)\b/i,
  /^(bye|ciao|mirupafshim|gjer|dag)\b/i,
];

function pickModel(message: string): string {
  const text = message.trim();
  if (text.length < 30 && SIMPLE_PATTERNS.some(p => p.test(text))) {
    console.log(`🪶 Routing to Haiku: "${text.slice(0, 40)}"`);
    return HAIKU_MODEL;
  }
  return SONNET_MODEL;
}

// ---------------------------------------------------------------------------
// Main agent function
// ---------------------------------------------------------------------------
export async function runBookingAgent(
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
      model: pickModel(customerMessage),
      max_tokens: 1024,
      system: [{ type: 'text' as const, text: await buildSystemPrompt(tenantId), cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
    });

    const usage = response.usage as any;
    if (usage?.cache_read_input_tokens || usage?.cache_creation_input_tokens) {
      const hit = usage.cache_read_input_tokens ?? 0;
      const miss = usage.cache_creation_input_tokens ?? 0;
      console.log(`💰 Cache — hit: ${hit} tokens, miss: ${miss} tokens`);
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`🔧 Tool call: ${block.name}`, JSON.stringify(block.input).slice(0, 100));
          const result = await executeTool(block.name, block.input as Record<string, unknown>, customerPhone, tenantId);
          console.log(`✅ Tool result: ${result.slice(0, 100)}`);
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
