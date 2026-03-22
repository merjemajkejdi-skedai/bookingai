import Anthropic from '@anthropic-ai/sdk';
import { format, addDays, parseISO } from 'date-fns';
import { prepare } from '../db/database.js';

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
        customer_phone: { type: 'string', description: 'Phone number of the customer (WhatsApp number)' },
        starts_at: { type: 'string', description: 'Start time in ISO format: YYYY-MM-DDTHH:mm:ss' },
        notes: { type: 'string', description: 'Any additional notes' },
      },
      required: ['specialist_id', 'service_id', 'customer_name', 'customer_phone', 'starts_at'],
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
  },
];

// ---------------------------------------------------------------------------
// Tool execution — each tool maps to a real database/business operation
// ---------------------------------------------------------------------------
async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  const tenantId = process.env.TENANT_ID || 'tenant-demo-001';

  switch (name) {
    case 'get_specialists': {
      const rows = prepare(`
        SELECT s.id, s.name, s.role,
          json_group_array(json_object(
            'day', wh.day_of_week,
            'start', wh.start_time,
            'end', wh.end_time,
            'working', wh.is_working
          )) as hours
        FROM specialists s
        LEFT JOIN working_hours wh ON wh.specialist_id = s.id
        WHERE s.tenant_id = ? AND s.is_active = 1
        GROUP BY s.id
      `).all(tenantId);

      const specialists = rows.map((r: any) => ({
        id: r.id, name: r.name, role: r.role,
        workingHours: JSON.parse(r.hours as string)
          .filter((h: any) => h.working)
          .map((h: any) => `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][h.day]}: ${h.start}–${h.end}`)
          .join(', '),
      }));
      return JSON.stringify(specialists);
    }

    case 'get_services': {
      const rows = prepare(`
        SELECT id, name, duration_mins, price FROM services
        WHERE tenant_id = ? AND is_active = 1 ORDER BY name
      `).all(tenantId);
      return JSON.stringify(rows.map((r: any) => ({
        id: r.id, name: r.name,
        duration: `${r.duration_mins} min`,
        price: `${(r.price / 100).toFixed(0)} ALL`,
      })));
    }

    case 'check_availability': {
      const { specialist_id, date, duration_mins } = input as { specialist_id: string; date: string; duration_mins: number };
      const dayOfWeek = new Date(date).getDay();

      const wh = prepare(`
        SELECT start_time, end_time, is_working FROM working_hours
        WHERE specialist_id = ? AND day_of_week = ?
      `).get(specialist_id, dayOfWeek) as any;

      if (!wh || !wh.is_working) {
        return JSON.stringify({ available: false, message: 'Specialist does not work on this day' });
      }

      // Get booked slots for the day
      const booked = prepare(`
        SELECT starts_at, ends_at FROM bookings
        WHERE specialist_id = ? AND date(starts_at) = ? AND status != 'cancelled'
      `).all(specialist_id, date) as any[];

      // Generate 15-min grid slots
      const [sh, sm] = wh.start_time.split(':').map(Number);
      const [eh, em] = wh.end_time.split(':').map(Number);
      const slots: string[] = [];
      let cur = new Date(`${date}T${wh.start_time}:00`);
      const end = new Date(`${date}T${wh.end_time}:00`);

      while (new Date(cur.getTime() + duration_mins * 60000) <= end) {
        const slotEnd = new Date(cur.getTime() + duration_mins * 60000);
        const busy = booked.some(b => {
          const bs = new Date(b.starts_at), be = new Date(b.ends_at);
          return cur < be && slotEnd > bs;
        });
        if (!busy) slots.push(format(cur, 'HH:mm'));
        cur = new Date(cur.getTime() + 15 * 60000);
      }

      return JSON.stringify({
        date, specialist_id,
        available_slots: slots.slice(0, 12), // Return first 12 slots to keep response concise
        total_available: slots.length,
      });
    }

    case 'create_booking': {
      const { specialist_id, service_id, customer_name, customer_phone, starts_at, notes } = input as any;

      const svc = prepare('SELECT duration_mins, name FROM services WHERE id = ?').get(service_id) as any;
      if (!svc) return JSON.stringify({ error: 'Service not found' });

      const endsAt = format(
        new Date(new Date(starts_at).getTime() + svc.duration_mins * 60000),
        "yyyy-MM-dd'T'HH:mm:ss"
      );

      // Double-check slot is still free
      const conflict = prepare(`
        SELECT id FROM bookings
        WHERE specialist_id = ? AND status != 'cancelled'
        AND starts_at < ? AND ends_at > ?
      `).get(specialist_id, endsAt, starts_at);

      if (conflict) {
        return JSON.stringify({ error: 'This slot was just taken. Please check availability again.' });
      }

      const spec = prepare('SELECT name FROM specialists WHERE id = ?').get(specialist_id) as any;
      const id = crypto.randomUUID();

      prepare(`
        INSERT INTO bookings(id,tenant_id,specialist_id,service_id,customer_name,customer_phone,starts_at,ends_at,status,notes)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(id, tenantId, specialist_id, service_id, customer_name, customer_phone,
        starts_at, endsAt, 'confirmed', notes || '');

      return JSON.stringify({
        success: true,
        booking_id: id,
        summary: `✅ Booked! ${svc.name} with ${spec?.name} on ${format(new Date(starts_at), 'EEEE d MMMM')} at ${format(new Date(starts_at), 'HH:mm')}`,
      });
    }

    case 'get_booking': {
      const { customer_phone } = input as { customer_phone: string };
      const rows = prepare(`
        SELECT b.id, b.starts_at, b.ends_at, b.status,
               s.name as specialist, sv.name as service
        FROM bookings b
        JOIN specialists s ON s.id = b.specialist_id
        JOIN services sv ON sv.id = b.service_id
        WHERE b.customer_phone = ? AND b.status = 'confirmed'
        ORDER BY b.starts_at DESC LIMIT 3
      `).all(customer_phone) as any[];

      if (!rows.length) return JSON.stringify({ message: 'No upcoming bookings found for this number' });

      return JSON.stringify(rows.map(r => ({
        id: r.id, service: r.service, specialist: r.specialist,
        date: format(new Date(r.starts_at), 'EEEE d MMMM'),
        time: `${format(new Date(r.starts_at), 'HH:mm')} – ${format(new Date(r.ends_at), 'HH:mm')}`,
        status: r.status,
      })));
    }

    case 'cancel_booking': {
      const { booking_id } = input as { booking_id: string };
      const booking = prepare(`
        SELECT b.*, s.name as specialist, sv.name as service
        FROM bookings b
        JOIN specialists s ON s.id = b.specialist_id
        JOIN services sv ON sv.id = b.service_id
        WHERE b.id = ?
      `).get(booking_id) as any;

      if (!booking) return JSON.stringify({ error: 'Booking not found' });

      prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking_id);

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
// System prompt — defines the agent's personality and behaviour
// ---------------------------------------------------------------------------
function buildSystemPrompt(): string {
  const tenantId = process.env.TENANT_ID || 'tenant-demo-001';
  const tenant = prepare('SELECT name, type FROM tenants WHERE id = ?').get(tenantId) as any;
  const now = format(new Date(), "EEEE d MMMM yyyy, HH:mm");

  return `You are a friendly booking assistant for ${tenant?.name || 'the salon'}, a ${tenant?.type || 'barbershop'}.
You help customers book, reschedule, and cancel appointments via WhatsApp.

Today is ${now}.

Your job:
- Greet customers warmly and find out what service they need
- Check specialist availability for their preferred date/time
- If their preferred slot is taken, suggest 3 alternative times in the same week
- Confirm all booking details before creating — name, service, specialist, date and time
- Keep messages SHORT and conversational — this is WhatsApp, not email
- Use simple formatting: no markdown, no asterisks, just plain text with emojis occasionally
- Always respond in the same language the customer uses

When booking:
1. Ask what service they want (use get_services if unsure)
2. Ask their preferred date and time
3. Ask which specialist (or suggest one if they don't mind)
4. Check availability with check_availability
5. Confirm all details with the customer before calling create_booking
6. After booking, send a clear confirmation with date, time, specialist and service

Never make up availability. Always use the tools to check real data.`;
}

// ---------------------------------------------------------------------------
// Main agent function — runs the agentic loop with tool use
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

  // Agentic loop — Claude can call multiple tools before giving final reply
  while (true) {
    const response = await client.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: buildSystemPrompt(),
      tools,
      messages,
    });

    // If Claude wants to use tools, execute them and loop back
    if (response.stop_reason === 'tool_use') {
      const assistantMessage: Anthropic.MessageParam = {
        role: 'assistant',
        content: response.content,
      };
      messages.push(assistantMessage);

      // Execute all tool calls in this response
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`🔧 Tool call: ${block.name}`, JSON.stringify(block.input).slice(0, 100));
          const result = await executeTool(block.name, block.input as Record<string, unknown>);
          console.log(`✅ Tool result: ${result.slice(0, 100)}`);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
      continue; // Loop back to get Claude's next response
    }

    // Claude is done — extract the text response
    const textBlock = response.content.find(b => b.type === 'text');
    return textBlock && textBlock.type === 'text' ? textBlock.text : 'Sorry, I had trouble processing that. Please try again.';
  }
}
