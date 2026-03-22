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
    description: 'Look up an existing booking by customer phone number',
    input_schema: {
      type: 'object' as const,
      properties: {
        customer_phone: { type: 'string', description: 'Customer WhatsApp phone number' },
      },
      required: ['customer_phone'],
    },
  },
  {
    name: 'cancel_booking',
    description: 'Cancel an existing booking by booking ID',
    input_schema: {
      type: 'object' as const,
      properties: {
        booking_id: { type: 'string', description: 'The booking ID to cancel' },
      },
      required: ['booking_id'],
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

      const slots: string[] = [];
      let cur = new Date(`${date}T${wh.start_time}:00`);
      const end = new Date(`${date}T${wh.end_time}:00`);

      while (new Date(cur.getTime() + duration_mins * 60000) <= end) {
        const slotEnd = new Date(cur.getTime() + duration_mins * 60000);
        const busy = booked.some((b: any) => {
          const bs = new Date(b.starts_at), be = new Date(b.ends_at);
          return cur < be && slotEnd > bs;
        });
        if (!busy) slots.push(format(cur, 'HH:mm'));
        cur = new Date(cur.getTime() + 15 * 60000);
      }

      return JSON.stringify({ date, specialist_id, available_slots: slots.slice(0, 12), total_available: slots.length });
    }

    case 'create_booking': {
      const { specialist_id, service_id, customer_name, starts_at, notes } = input as any;
      const svc = await dbGet('SELECT duration_mins,name FROM services WHERE id=?', service_id) as any;
      if (!svc) return JSON.stringify({ error: 'Service not found' });

      const endsAt = format(new Date(new Date(starts_at).getTime() + svc.duration_mins * 60000), "yyyy-MM-dd'T'HH:mm:ss");

      const conflict = await dbGet("SELECT id FROM bookings WHERE specialist_id=? AND status!='cancelled' AND starts_at < ? AND ends_at > ?", specialist_id, endsAt, starts_at);
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
      const { customer_phone } = input as { customer_phone: string };
      const rows = await dbAll(`
        SELECT b.id,b.starts_at,b.ends_at,b.status,s.name as specialist,sv.name as service
        FROM bookings b
        JOIN specialists s ON s.id=b.specialist_id
        JOIN services sv ON sv.id=b.service_id
        WHERE b.customer_phone=? AND b.status='confirmed'
        ORDER BY b.starts_at DESC LIMIT 3
      `, customer_phone) as any[];

      if (!rows.length) return JSON.stringify({ message: 'No upcoming bookings found for this number' });
      return JSON.stringify(rows.map((r: any) => ({
        id: r.id, service: r.service, specialist: r.specialist,
        date: format(new Date(r.starts_at), 'EEEE d MMMM'),
        time: `${format(new Date(r.starts_at), 'HH:mm')} – ${format(new Date(r.ends_at), 'HH:mm')}`,
        status: r.status,
      })));
    }

    case 'cancel_booking': {
      const { booking_id } = input as { booking_id: string };
      const booking = await dbGet(`
        SELECT b.*,s.name as specialist,sv.name as service
        FROM bookings b
        JOIN specialists s ON s.id=b.specialist_id
        JOIN services sv ON sv.id=b.service_id
        WHERE b.id=?
      `, booking_id) as any;
      if (!booking) return JSON.stringify({ error: 'Booking not found' });
      await dbRun("UPDATE bookings SET status='cancelled' WHERE id=?", booking_id);
      return JSON.stringify({
        success: true,
        message: `Cancelled: ${booking.service} with ${booking.specialist} on ${format(new Date(booking.starts_at), 'EEEE d MMMM')} at ${format(new Date(booking.starts_at), 'HH:mm')}`,
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
1. NEVER confirm, suggest, or imply a time slot is available without calling check_availability first.
2. NEVER call create_booking without first showing the customer a summary and getting explicit confirmation (e.g. "Yes", "Confirm", "OK").
3. NEVER invent or guess specialist names, service names, prices or durations — always use the lists above.
4. NEVER skip steps. Even if the customer says "same as last time" — still verify availability.
5. If a slot is taken, ALWAYS suggest at least 2 alternative times from check_availability results.
6. ALWAYS ask for the customer's name before creating a booking if you don't already know it. The customer's phone number is already captured automatically — never ask for it.

=== BOOKING FLOW — FOLLOW THIS EXACT ORDER ===
Step 1 — Greet and ask what service they want (match to service list above)
Step 2 — Ask which specialist they prefer, or offer "any available"
Step 3 — Ask their preferred date and time
Step 4 — Call check_availability with the correct specialist_id, date, duration_mins
Step 5 — If slot available: show summary, ask for name if needed, wait for confirmation
Step 6 — Only after explicit confirmation: call create_booking
Step 7 — Send confirmation message with: service, specialist, date, time, price

=== IF SLOT IS NOT AVAILABLE ===
- Say the slot is taken
- Show 2-3 available alternatives from the check_availability results
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
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
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
