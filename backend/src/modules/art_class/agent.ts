// Art Class module WhatsApp agent — helps customers find and register for art classes.
// Fully isolated from the booking and art_event modules.
// Identical in structure to art_event/agent.ts — diverge freely as class needs change.

import Anthropic from '@anthropic-ai/sdk';
import { format } from 'date-fns';
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
    name: 'list_classes',
    description: 'List upcoming art classes with title, date, time, teacher, age range, available spots and description',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'register_for_class',
    description: "Register a child for an art class. Requires the child's name and parent contact details.",
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: { type: 'string', description: 'The class ID to register for' },
        child_name: { type: 'string', description: "Child's full name" },
        parent_name: { type: 'string', description: "Parent or guardian's full name" },
        notes: { type: 'string', description: 'Any additional notes (e.g. allergies, special needs)' },
      },
      required: ['event_id', 'child_name', 'parent_name'],
    },
  },
  {
    name: 'get_my_registrations',
    description: "Look up registrations for classes associated with this phone number. Phone is injected automatically.",
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'cancel_registration',
    description: 'Cancel a class registration by registration ID',
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
    case 'list_classes': {
      const rows = await dbAll(`
        SELECT e.id, e.title, e.description, e.date, e.start_time, e.end_time,
               e.age_min, e.age_max, e.max_capacity, COUNT(r.id) AS registration_count,
               s.name AS teacher_name
        FROM art_events e
        LEFT JOIN event_registrations r ON r.event_id = e.id
        LEFT JOIN specialists s ON s.id = e.teacher_id
        WHERE e.tenant_id = ? AND e.is_active = 1 AND e.date >= ?
        GROUP BY e.id
        ORDER BY e.date, e.start_time
        LIMIT 10
      `, tenantId, today) as any[];

      if (!rows.length) return JSON.stringify({ classes: [], message: 'No upcoming classes found.' });

      return JSON.stringify({
        classes: rows.map((r: any) => ({
          id: r.id,
          title: r.title,
          description: r.description || '',
          date: format(new Date(r.date), 'EEEE d MMMM yyyy'),
          time: `${r.start_time} – ${r.end_time}`,
          teacher: r.teacher_name || null,
          age_range: r.age_min != null || r.age_max != null
            ? `${r.age_min ?? '?'}–${r.age_max ?? '?'} years`
            : null,
          spots_left: r.max_capacity ? Math.max(0, r.max_capacity - Number(r.registration_count)) : 'unlimited',
          is_full: r.max_capacity ? Number(r.registration_count) >= r.max_capacity : false,
        }))
      });
    }

    case 'register_for_class': {
      const { event_id, child_name, parent_name, notes = '' } = input as any;

      const event = await dbGet('SELECT * FROM art_events WHERE id = ? AND tenant_id = ? AND is_active = 1', event_id, tenantId) as any;
      if (!event) return JSON.stringify({ error: 'Class not found' });
      if (new Date(event.date) < new Date(today)) return JSON.stringify({ error: 'This class has already passed' });

      if (event.max_capacity) {
        const cnt = await dbGet('SELECT COUNT(*) as cnt FROM event_registrations WHERE event_id = ?', event_id) as any;
        if (Number(cnt?.cnt || 0) >= event.max_capacity) return JSON.stringify({ error: 'This class is at full capacity' });
      }

      const id = crypto.randomUUID();
      await dbRun(
        'INSERT INTO event_registrations(id,event_id,tenant_id,participant_name,parent_phone,parent_name,notes) VALUES(?,?,?,?,?,?,?)',
        id, event_id, tenantId, child_name, customerPhone, parent_name, notes
      );

      return JSON.stringify({
        success: true,
        registration_id: id,
        summary: `✅ Registered! ${child_name} (parent: ${parent_name}) for "${event.title}" on ${format(new Date(event.date), 'EEEE d MMMM')} at ${event.start_time}`,
      });
    }

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

      if (!rows.length) return JSON.stringify({ found: false, message: 'No upcoming class registrations found for your number.' });

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
        }))
      });
    }

    case 'cancel_registration': {
      const { registration_id } = input as { registration_id: string };
      const reg = await dbGet(`
        SELECT r.*, e.title, e.date, e.start_time
        FROM event_registrations r
        JOIN art_events e ON e.id = r.event_id
        WHERE r.id = ?
      `, registration_id) as any;
      if (!reg) return JSON.stringify({ error: 'Registration not found' });

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
You help parents register their children for art classes.
Always respond in the same language the customer writes in.
Today is ${now}.

=== WHAT YOU CAN DO ===
- List upcoming classes with age range, teacher, date, time and available spots (call list_classes)
- Register a child for a class (call register_for_class)
- Show existing registrations for this number (call get_my_registrations)
- Cancel a registration (call cancel_registration)

=== RULES ===
1. Always call list_classes when a parent asks what classes are available.
2. Before registering, show class details (title, date, time, teacher, age range) and ask for confirmation.
3. Always ask for: child's full name and parent's full name before registering.
4. Never ask for the phone number — it is captured automatically.
5. Mention the age range when listing classes so parents can choose the right one.
6. If a class is full, say so clearly and suggest other available classes.
7. When a parent mentions cancellation, call get_my_registrations first, then confirm before cancelling.
8. Notes field is optional — only ask if parent mentions something special (allergies, etc).

=== MESSAGE STYLE ===
- Short and conversational — this is WhatsApp
- Plain text only, no markdown
- Use emojis sparingly (1-2 per message max)
- Be warm and friendly`;
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
// Main agent function
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
