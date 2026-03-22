import Anthropic from '@anthropic-ai/sdk';
import { format, addDays, parseISO } from 'date-fns';
import { prepare, isPg, query, queryOne, queryRun } from '../db/database.js';

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// ---------------------------------------------------------------------------
// Tools Claude can call to check availability and create bookings
// ---------------------------------------------------------------------------
const tools: Anthropic.Tool[] = [
  {
    name: 'get_specialists',
    description: 'Get the list of available specialists and their working hours',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_services',
    description: 'Get the list of services offered, including duration and price',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
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
        starts_at: { type: 'string', description: 'Start time in ISO format: YYYY-MM-DDTHH:mm:ss (e.g. 2026-03-23T09:00:00). Always use 2-digit hour, e.g. 09:00 not 9:00' },
        notes: { type: 'string', description: 'Any additional notes' },
      },
      required: ['specialist_id', 'service_id', 'customer_name', 'starts_at'],
    },
  },
  {
    name: 'get_booking',
    description: 'Look up the customer\'s upcoming bookings in the next 30 days. Always call this first when customer mentions cancel or modify. Phone is injected automatically — no input needed.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'cancel_booking',
    description: 'Cancel an existing booking by booking ID',
    input_schema: {
      type: 'object' as const,
      properties: {
        booking_id: { type: 'string', description: 'The booking ID to cancel' },
        reason: { type: 'string', description: 'Reason for cancellation to send to customer' },
      },
      required: ['booking_id'],
    },
  },
  {
    name: 'reschedule_booking',
    description: 'Reschedule an existing booking to a new date and time. First call check_availability to confirm the new slot is free.',
    input_schema: {
      type: 'object' as const,
      properties: {
        booking_id: { type: 'string', description: 'The booking ID to reschedule' },
        new_starts_at: { type: 'string', description: 'New start time in ISO format: YYYY-MM-DDTHH:mm:ss' },
      },
      required: ['booking_id', 'new_starts_at'],
    },
    // Cache the tools schema — it never changes between calls
    cache_control: { type: 'ephemeral' } as const,
  },
] as Anthropic.Tool[];

// ---------------------------------------------------------------------------
// Tool execution — each tool maps to a real database/business operation
// ---------------------------------------------------------------------------
async function executeTool(name: string, input: Record<string, unknown>, customerPhone = ''): Promise<string> {
  const tenantId = process.env.TENANT_ID || 'tenant-demo-001';

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
        workingHours: (isPg ? (r.hours||[]) : JSON.parse(r.hours||'[]'))
          .filter((h: any) => h.working)
          .map((h: any) => `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][h.day]}: ${h.start}–${h.end}`)
          .join(', '),
      })));
    }

    case 'get_services': {
      const rows = await dbAll('SELECT id,name,duration_mins,price FROM services WHERE tenant_id=? AND is_active=1 ORDER BY name', tenantId);
      return JSON.stringify(rows.map((r: any) => ({
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

      // Log raw DB values so we can debug timezone issues
      console.log(`🔍 check_availability: date=${date}, specialist=${specialist_id}`);
      console.log(`🔍 booked raw:`, JSON.stringify(booked));

      // Normalize: strip timezone offset and use only first 19 chars e.g. "2026-03-24T09:00:00"
      const norm = (ts: string) => String(ts).slice(0, 19);

      const slots: string[] = [];
      let cur = new Date(`${date}T${wh.start_time}:00`);
      const end = new Date(`${date}T${wh.end_time}:00`);

      console.log(`🔍 working hours: ${wh.start_time} - ${wh.end_time}, dayOfWeek=${dayOfWeek}`);

      while (new Date(cur.getTime() + duration_mins * 60000) <= end) {
        const slotEnd = new Date(cur.getTime() + duration_mins * 60000);
        const curStr = format(cur, "yyyy-MM-dd'T'HH:mm:ss");
        const endStr = format(slotEnd, "yyyy-MM-dd'T'HH:mm:ss");
        const busy = booked.some((b: any) => {
          const bs = norm(b.starts_at), be = norm(b.ends_at);
          const overlap = curStr < be && endStr > bs;
          if (overlap) console.log(`🔍 slot ${curStr} blocked by booking ${bs} - ${be}`);
          return overlap;
        });
        if (!busy) slots.push(format(cur, 'HH:mm'));
        cur = new Date(cur.getTime() + 15 * 60000);
      }

      console.log(`🔍 available slots:`, slots);
      return JSON.stringify({ date, specialist_id, available_slots: slots, total_available: slots.length });
    }

    case 'create_booking': {
      const { specialist_id, service_id, customer_name, starts_at, notes } = input as any;
      const svc = await dbGet('SELECT duration_mins,name FROM services WHERE id=?', service_id) as any;
      if (!svc) return JSON.stringify({ error: 'Service not found' });

      const endsAt = format(new Date(new Date(starts_at).getTime() + svc.duration_mins * 60000), "yyyy-MM-dd'T'HH:mm:ss");

      // Use text comparison - both values are plain ISO strings without tz
      const conflict = await dbGet("SELECT id FROM bookings WHERE specialist_id=? AND status!='cancelled' AND LEFT(starts_at,19) < ? AND LEFT(ends_at,19) > ?", specialist_id, endsAt.slice(0,19), starts_at.slice(0,19));
      if (conflict) return JSON.stringify({ error: 'This slot was just taken. Please check availability again.' });

      const spec = await dbGet('SELECT name FROM specialists WHERE id=?', specialist_id) as any;
      const id = crypto.randomUUID();

      await dbRun(
        'INSERT INTO bookings(id,tenant_id,specialist_id,service_id,customer_name,customer_phone,starts_at,ends_at,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?)',
        id, tenantId, specialist_id, service_id, customer_name, customerPhone, starts_at, endsAt, 'confirmed', notes||''
      );

      return JSON.stringify({
        success: true, booking_id: id,
        summary: `✅ Booked! ${svc.name} with ${spec?.name} on ${format(new Date(starts_at), 'EEEE d MMMM')} at ${format(new Date(starts_at), 'HH:mm')}`,
      });
    }

    case 'get_booking': {
      // Phone is injected automatically from the WhatsApp request — no need to ask customer
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

      if (!rows.length) return JSON.stringify({
        found: false,
        message: 'No confirmed bookings found for your number in the next 30 days.'
      });

      return JSON.stringify({
        found: true,
        bookings: rows.map((r: any) => ({
          id: r.id,
          service: r.service,
          specialist: r.specialist,
          specialist_id: r.specialist_id,
          service_id: r.service_id,
          duration_mins: r.duration_mins,
          date: format(new Date(r.starts_at.slice(0,19)), 'EEEE d MMMM yyyy'),
          time: format(new Date(r.starts_at.slice(0,19)), 'HH:mm'),
          starts_at: r.starts_at.slice(0,19),
          ends_at: r.ends_at.slice(0,19),
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

      const dateStr = format(new Date(booking.starts_at.slice(0,19)), 'EEEE d MMMM');
      const timeStr = format(new Date(booking.starts_at.slice(0,19)), 'HH:mm');

      // No need to send WhatsApp — the customer IS the one cancelling via WhatsApp
      // We just confirm back to them in the conversation

      return JSON.stringify({
        success: true,
        message: `Cancelled: ${booking.service} with ${booking.specialist} on ${dateStr} at ${timeStr}.`,
        date: dateStr,
        time: timeStr,
      });
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

      // Calculate new end time
      const newEndsAt = format(
        new Date(new Date(new_starts_at).getTime() + booking.duration_mins * 60000),
        "yyyy-MM-dd'T'HH:mm:ss"
      );

      // Double-check no conflict (excluding this booking)
      const conflict = await dbGet(`
        SELECT id FROM bookings
        WHERE specialist_id = ?
          AND id != ?
          AND status != 'cancelled'
          AND LEFT(starts_at,19) < ?
          AND LEFT(ends_at,19) > ?
      `, booking.specialist_id, booking_id, newEndsAt, new_starts_at) as any;

      if (conflict) return JSON.stringify({
        error: 'That slot is no longer available. Please check availability and choose another time.'
      });

      await dbRun(
        'UPDATE bookings SET starts_at=?, ends_at=? WHERE id=?',
        new_starts_at, newEndsAt, booking_id
      );

      const newDateStr = format(new Date(new_starts_at), 'EEEE d MMMM yyyy');
      const newTimeStr = format(new Date(new_starts_at), 'HH:mm');

      return JSON.stringify({
        success: true,
        service: booking.service,
        specialist: booking.specialist,
        new_date: newDateStr,
        new_time: newTimeStr,
        message: `Rescheduled: ${booking.service} with ${booking.specialist} → ${newDateStr} at ${newTimeStr}`,
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ---------------------------------------------------------------------------
// System prompt — strict booking flow, customise this to change agent behaviour
// ---------------------------------------------------------------------------
async function buildSystemPrompt(): Promise<string> {
  const tenantId = process.env.TENANT_ID || 'tenant-demo-001';
  const tenant = await dbGet('SELECT name, type FROM tenants WHERE id = ?', tenantId) as any;
  const now = format(new Date(), "EEEE d MMMM yyyy, HH:mm");

  const specialists = await dbAll('SELECT id, name, role FROM specialists WHERE tenant_id = ? AND is_active = 1', tenantId) as any[];
  const services = await dbAll('SELECT id, name, duration_mins, price FROM services WHERE tenant_id = ? AND is_active = 1', tenantId) as any[];

  const specialistList = specialists
    .map((s: any) => `- ${s.name} (${s.role}) — id: ${s.id}`)
    .join('\n');

  const serviceList = services
    .map((s: any) => `- ${s.name}, ${s.duration_mins} min, ${s.price} ALL — id: ${s.id}`)
    .join('\n');

  return `You are the booking assistant for ${tenant?.name || 'the salon'}, a ${tenant?.type || 'barbershop'}.
You ONLY help customers book, reschedule, cancel, or check appointments. Do not discuss anything else.
Always respond in the same language the customer writes in.
Today is ${now}.

=== OUR TEAM ===
${specialistList}

=== OUR SERVICES ===
${serviceList}

=== STRICT RULES — NEVER BREAK THESE ===
0. ALWAYS trust check_availability tool results. If a slot appears in available_slots, it IS free. Never contradict tool results based on previous conversation or assumptions.
1. NEVER confirm, suggest, or imply a time slot is available without calling check_availability first. After calling it, TRUST the result completely.
2. NEVER call create_booking without first showing the customer a summary and getting explicit confirmation (e.g. "Yes", "Confirm", "OK").
3. NEVER invent or guess specialist names, service names, prices or durations — always use the lists above.
4. NEVER skip steps. Even if the customer says "same as last time" — still verify availability.
5. If a slot is taken, ALWAYS suggest at least 2 alternative times from check_availability results.
6. ALWAYS ask for the customer's name before creating a booking if you don't already know it. The customer's phone number is already captured automatically — never ask for it.
7. When customer mentions CANCEL or MODIFY or RESCHEDULE — ALWAYS call get_booking FIRST. No input needed. Never ask for booking ID or phone number.
8. NEVER cancel or reschedule without showing booking details and getting explicit confirmation.
9. After rescheduling always call check_availability for the new slot BEFORE calling reschedule_booking.

=== BOOKING FLOW — FOLLOW THIS EXACT ORDER ===
Step 1 — Greet and ask what service they want (match to service list above)
Step 2 — Ask which specialist they prefer, or offer "any available"
Step 3 — Ask their preferred date and time
Step 4 — Call check_availability with the correct specialist_id, date, duration_mins
Step 5 — Read the tool result carefully: the "available_slots" array contains EVERY slot that IS free.
          If the customer's requested time (e.g. "15:00") appears in available_slots → it IS available. Proceed to Step 6.
          If the customer's requested time does NOT appear in available_slots → it is taken. Suggest alternatives.
Step 6 — Show summary, ask for name if needed, wait for confirmation
Step 7 — Only after explicit confirmation: call create_booking
Step 8 — Send confirmation message with: service, specialist, date, time, price

=== CANCELLATION FLOW ===
Step 1 — Call get_booking (no input needed — phone is injected automatically)
Step 2 — Show booking(s) found, ask which to cancel if more than one
Step 3 — Ask "Are you sure you want to cancel?" and wait for yes/no
Step 4 — Only after confirmation: call cancel_booking with the booking_id
Step 5 — Confirm cancellation clearly with service, specialist, date and time

=== RESCHEDULE / MODIFY FLOW ===
Step 1 — Call get_booking (no input needed — phone is injected automatically)
Step 2 — Show booking(s) found, ask which to reschedule if more than one
Step 3 — Ask what new date and time they prefer
Step 4 — Call check_availability for same specialist_id, new date, same duration_mins
Step 5 — If new slot available: show summary (old time → new time) and ask to confirm
Step 6 — Only after confirmation: call reschedule_booking with booking_id and new_starts_at
Step 7 — Confirm reschedule clearly: old date/time → new date/time

=== HOW TO READ check_availability RESULTS ===
The tool returns: { "available_slots": ["09:00", "09:15", "10:00", ...] }
- Every time in this list IS FREE and can be booked
- If "15:00" is in the list → 15:00 IS available → tell the customer it's available
- NEVER say a slot is taken if it appears in available_slots
- Only say a slot is taken if it is MISSING from available_slots

=== READING check_availability RESULTS ===
The available_slots array contains EXACTLY the free slots for that day.
If '15:00' is in available_slots → it IS free → you MUST offer it.
If '15:00' is NOT in available_slots → it is taken → suggest alternatives.
Never say a slot is busy if it appears in available_slots. The tool is always correct.

=== IF SLOT IS NOT AVAILABLE ===
- The requested time is missing from available_slots
- Say the slot is taken
- Pick 2-3 times from available_slots and suggest them
- Ask which alternative they prefer
- Do NOT call create_booking until customer picks one and confirms

=== CONFIRMATION MESSAGE FORMAT ===
When showing a booking summary before confirmation, use EXACTLY this format:
Sherbimi: [service name]
Specialisti: [specialist name]
Data: [day name] [date] [month]
Ora: [HH:mm] (e.g. 09:00, 14:30)
Cmimi: [price] ALL
Konfirmo? (Po/Jo)

IMPORTANT: Write the time as HH:mm (e.g. 09:00). Never use quotes around the time. Never write just the hour digit alone.

=== EFFICIENCY — REDUCE MESSAGE COUNT ===
- On the FIRST message from a new customer, ask for ALL booking info at once in one message:
  "Pershendetje! Cfare sherbimi deshironi, me cilin specialist dhe kur? (dita + ora)"
  or in English: "Hi! What service, which specialist, and when? (day + time)"
- Never send one question per message if you can combine two into one
- If customer says "haircut tomorrow" → assume any available specialist, check availability immediately — do not ask which specialist first
- If customer says a time and date → go straight to check_availability, do not ask for confirmation first
- Skip greetings after the first exchange — just answer efficiently
- Confirmation summary must be ONE message only, never split across two

=== MESSAGE STYLE ===
- Short and conversational — this is WhatsApp, not email
- Plain text only — no asterisks, no markdown, no bullet points
- Use emojis sparingly (1-2 per message max)
- Be warm and friendly but efficient
- Always write times in HH:mm format (e.g. 09:00, 14:30) — never abbreviated`;
}

// ---------------------------------------------------------------------------
// Retry helper — exponential backoff for overloaded / rate-limit errors
// Waits 2s, 4s, 8s, 16s before giving up
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
      const isRetryable =
        status === 529 || status === 429 || status >= 500 ||
        err?.message?.includes('overloaded') ||
        err?.message?.includes('rate limit');

      if (!isRetryable || attempt === maxRetries) break;

      const waitMs = Math.min(2000 * Math.pow(2, attempt), 16000);
      console.log(`⚠️  Claude overloaded (attempt ${attempt + 1}/${maxRetries + 1}) — retrying in ${waitMs / 1000}s...`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Model routing — simple messages use Haiku (25x cheaper than Sonnet)
// Complex messages (tool use, availability, booking) use Sonnet
// ---------------------------------------------------------------------------
const HAIKU_MODEL  = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// Patterns that indicate a simple message safe for Haiku
const SIMPLE_PATTERNS = [
  // Greetings
  /^(hi|hello|hey|hej|allo|pershendetje|miredita|mirembrema|mirenat)/i,
  // Confirmations / yes / no
  /^(po|yes|ok|okay|sipo|jo|no|nope|sure|confirm|konfirmoj|konfirmo|dakord)/i,
  // Thanks
  /^(faleminderit|faleminderit shume|thanks|thank you|ty|thx|mersi)/i,
  // Simple acknowledgements
  /^(ok+|k|kk|👍|✅|done|mire|mire\s)/i,
  // Goodbyes
  /^(bye|ciao|mirupafshim|gjer|dag)/i,
];

function pickModel(message: string, hasHistory: boolean): string {
  const text = message.trim();

  // Very short messages with no booking intent → Haiku
  if (text.length < 30 && SIMPLE_PATTERNS.some(p => p.test(text))) {
    console.log(`🪶 Routing to Haiku: "${text.slice(0, 40)}"`);
    return HAIKU_MODEL;
  }

  // Everything else → Sonnet (booking logic, availability, tool use)
  return SONNET_MODEL;
}

// ---------------------------------------------------------------------------
// Main agent function — runs the agentic loop with tool use + auto retry
// ---------------------------------------------------------------------------
export async function runBookingAgent(
  customerMessage: string,
  conversationHistory: Anthropic.MessageParam[],
  customerPhone: string,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...conversationHistory,
    { role: 'user', content: customerMessage },
  ];

  while (true) {
    const response = await callClaudeWithRetry({
      model: pickModel(customerMessage, conversationHistory.length > 0),
      max_tokens: 1024,
      // Prompt caching — cached for 5 min by Anthropic, 0.1x price on cache hits
      system: [{ type: 'text' as const, text: await buildSystemPrompt(), cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
    });

    // Log cache usage so you can monitor savings in the console
    const usage = response.usage as any;
    if (usage?.cache_read_input_tokens || usage?.cache_creation_input_tokens) {
      const hit = usage.cache_read_input_tokens ?? 0;
      const miss = usage.cache_creation_input_tokens ?? 0;
      console.log(`💰 Cache — hit: ${hit} tokens (0.1x price), miss/write: ${miss} tokens`);
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`🔧 Tool call: ${block.name}`, JSON.stringify(block.input).slice(0, 100));
          const result = await executeTool(block.name, block.input as Record<string, unknown>, customerPhone);
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
