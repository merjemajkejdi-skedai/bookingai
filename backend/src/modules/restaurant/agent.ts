import Anthropic from '@anthropic-ai/sdk';
import { format } from 'date-fns';
import { prepare, isPg, query, queryOne, queryRun } from '../../db/database.js';

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
const restaurantTools: Anthropic.Tool[] = [
  {
    name: 'check_availability',
    description: `Check which zones are available for the requested date, time and duration.
Pass preference as "outside" (jashte) or "inside" (brenda) — only zones whose description
contains the matching keyword will be returned. Returns whether there is availability.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        date:          { type: 'string',  description: 'Date in YYYY-MM-DD format' },
        time:          { type: 'string',  description: 'Time in HH:MM format (e.g. 19:30)' },
        duration_mins: { type: 'number',  description: 'Duration in minutes (default 180)' },
        preference:    { type: 'string',  enum: ['inside', 'outside'], description: '"inside" or "outside"' },
      },
      required: ['date', 'time', 'preference'],
    },
  },
  {
    name: 'create_reservation',
    description: 'Create a confirmed reservation. Only call after explicit guest confirmation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        guest_name:    { type: 'string',  description: 'Full name of the guest' },
        guest_phone:   { type: 'string',  description: 'Guest phone number' },
        guest_count:   { type: 'number',  description: 'Total number of guests (adults + children)' },
        zone_id:       { type: 'string',  description: 'Zone ID from check_availability result' },
        date:          { type: 'string',  description: 'Date in YYYY-MM-DD format' },
        time:          { type: 'string',  description: 'Time in HH:MM format' },
        duration_mins: { type: 'number',  description: 'Duration in minutes' },
        notes:         { type: 'string',  description: 'Any notes, e.g. outside preference warning' },
      },
      required: ['guest_name', 'zone_id', 'date', 'time', 'guest_count'],
      cache_control: { type: 'ephemeral' } as const,
    } as any,
  },
] as Anthropic.Tool[];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------
async function executeTool(
  name: string,
  input: Record<string, unknown>,
  tenantId: string,
  customerPhone: string,
): Promise<string> {
  switch (name) {
    case 'check_availability': {
      const { date, time, duration_mins = 180, preference } = input as {
        date: string; time: string; duration_mins?: number; preference: 'inside' | 'outside';
      };

      // keyword in zone description that signals seating type
      const keyword = preference === 'outside' ? 'jashte' : 'brenda';

      // Load all zones for this tenant whose description matches the preference
      const kw = `%${keyword}%`;
      const zones = await dbAll(
        `SELECT id, name, max_concurrent, description, color
         FROM restaurant_zones
         WHERE tenant_id = ?
           AND (LOWER(description) LIKE ? OR LOWER(name) LIKE ?)`,
        tenantId,
        kw,
        kw,
      ) as any[];

      if (!zones.length) {
        return JSON.stringify({
          available: false,
          reason: `No ${preference} zones are configured for this restaurant.`,
        });
      }

      // For each matching zone, count overlapping confirmed reservations
      const [startH, startM] = (time as string).split(':').map(Number);
      const startMins = startH * 60 + startM;
      const endMins   = startMins + Number(duration_mins);

      const availableZones: { id: string; name: string; color: string }[] = [];

      for (const zone of zones) {
        const existing = await dbAll(
          `SELECT time, duration_mins FROM restaurant_reservations
           WHERE zone_id = ? AND date = ? AND status != 'cancelled'`,
          zone.id,
          date,
        ) as any[];

        const overlapping = existing.filter((r: any) => {
          const [rH, rM] = r.time.split(':').map(Number);
          const rStart = rH * 60 + rM;
          const rEnd   = rStart + Number(r.duration_mins);
          return startMins < rEnd && endMins > rStart;
        });

        if (overlapping.length < zone.max_concurrent) {
          availableZones.push({ id: zone.id, name: zone.name, color: zone.color });
        }
      }

      if (!availableZones.length) {
        return JSON.stringify({
          available: false,
          reason: `All ${preference} zones are fully booked at ${time} on ${format(new Date(date), 'EEEE d MMMM yyyy')}.`,
        });
      }

      return JSON.stringify({
        available: true,
        preference,
        date: format(new Date(date), 'EEEE d MMMM yyyy'),
        time,
        duration_mins,
        zones: availableZones,
        // use first available zone by default for the booking
        selected_zone_id: availableZones[0].id,
        selected_zone_name: availableZones[0].name,
      });
    }

    case 'create_reservation': {
      const {
        guest_name, guest_phone = customerPhone, guest_count,
        zone_id, date, time, duration_mins = 180, notes = '',
      } = input as any;

      // Final conflict guard
      const [startH, startM] = (time as string).split(':').map(Number);
      const startMins = startH * 60 + startM;
      const endMins   = startMins + Number(duration_mins);

      const zone = await dbGet(
        'SELECT name, max_concurrent FROM restaurant_zones WHERE id = ?',
        zone_id,
      ) as any;
      if (!zone) return JSON.stringify({ error: 'Zone not found' });

      const existing = await dbAll(
        `SELECT time, duration_mins FROM restaurant_reservations
         WHERE zone_id = ? AND date = ? AND status != 'cancelled'`,
        zone_id, date,
      ) as any[];

      const overlapping = existing.filter((r: any) => {
        const [rH, rM] = r.time.split(':').map(Number);
        const rStart = rH * 60 + rM;
        const rEnd   = rStart + Number(r.duration_mins);
        return startMins < rEnd && endMins > rStart;
      });

      if (overlapping.length >= zone.max_concurrent) {
        return JSON.stringify({ error: `Zone "${zone.name}" just became fully booked. Please try another time.` });
      }

      const id = crypto.randomUUID();
      await dbRun(
        `INSERT INTO restaurant_reservations
           (id, tenant_id, zone_id, guest_name, guest_phone, guest_count, date, time, duration_mins, notes, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,'confirmed')`,
        id, tenantId, zone_id,
        guest_name, guest_phone || '', Number(guest_count),
        date, time, Number(duration_mins),
        notes,
      );

      const dateFormatted = format(new Date(date), 'EEEE d MMMM yyyy');
      const durH = Math.floor(Number(duration_mins) / 60);
      const durM = Number(duration_mins) % 60;
      const durStr = durM ? `${durH}h ${durM}m` : `${durH}h`;

      return JSON.stringify({
        success: true,
        reservation_id: id,
        guest_name,
        zone: zone.name,
        date: dateFormatted,
        time,
        duration: durStr,
        guest_count,
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr);
  const day = d.getDay(); // 0=Sun, 6=Sat
  return day === 0 || day === 6;
}

function isVipPreferredRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return /view|balcon|ballkon|panoram|pamje|terrac|terras|ballk/.test(lower);
}

function inVipTimeWindow(time: string): boolean {
  const [h, m] = time.split(':').map(Number);
  const mins = h * 60 + m;
  const lunchStart = 12 * 60, lunchEnd = 13 * 60;   // 12:00–13:00
  const dinnerStart = 18 * 60, dinnerEnd = 20 * 60 + 30; // 18:00–20:30
  return (mins >= lunchStart && mins <= lunchEnd) || (mins >= dinnerStart && mins <= dinnerEnd);
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
const VIP_TENANT_ID = 'd3f155b0-fb15-4023-a037-e0b66876164c';

async function buildSystemPrompt(tenantId: string): Promise<string> {
  const tenant = await dbGet('SELECT name FROM tenants WHERE id = ?', tenantId) as any;
  const now    = format(new Date(), "EEEE d MMMM yyyy, HH:mm");

  // Load VIP zone names for the special-rules tenant so the prompt can reference them
  let vipZoneBlock = '';
  if (tenantId === VIP_TENANT_ID) {
    const vipZones = await dbAll(
      `SELECT name FROM restaurant_zones WHERE tenant_id = ? AND is_vip = 1 AND is_active = 1`,
      tenantId
    ) as any[];
    const vipNames = vipZones.map((z: any) => z.name).join(', ') || 'VIP zones';

    vipZoneBlock = `

=== WEEKEND VIP / BALCONY / VIEW TABLE RULES (applies ONLY on Saturday and Sunday) ===
The VIP zones (${vipNames}) contain the tables with a view and the balcony tables.

Rule A — WEEKDAYS (Monday–Friday): no special restrictions. Follow the normal flow for any request.

Rule B — WEEKENDS (Saturday & Sunday):
  If the guest mentions a "view", "balcony", "ballkon", "pamje", "panoramë", "terracë" or any similar
  request for a scenic/premium spot, apply the following:

  B1 — Check the requested time:
    • Lunch window:  12:00–13:00
    • Dinner window: 18:00–20:30

  B2 — If the time IS within a window (B1):
    → Treat as a normal reservation for the VIP zone (preference = "outside" to match VIP zone
      descriptions, or whichever zone has is_vip=true). Proceed with check_availability and book normally.
    → In the recap add: "Tavolina me pamje / ballkon — rezervuar" (or equivalent in guest language).

  B3 — If the time is OUTSIDE the windows (e.g. 21:00, 14:00, etc.) on a weekend:
    → Still call check_availability and create_reservation as usual.
    → But in the recap and confirmation message say (adapt to guest language):
      "Rezervimin e kemi bërë, por për orën [HH:MM] nuk mund të garantojmë tavolinën me pamje ose
       ballkonin. Megjithatë, kur të mbërrini, do të bëjmë maksimumin për t'ju akomoduar sipas kërkesës
       suaj." (Albanian)
      "We have made your reservation, but for [HH:MM] we cannot guarantee the table with a view or the
       balcony. However, once you arrive we will do our best to accommodate you as per your request." (English)
    → Add to reservation notes: "Guest requested view/balcony on a weekend outside guaranteed window."

IMPORTANT: This rule only applies when the guest explicitly asks for a view, balcony, or panoramic table
AND the date is a Saturday or Sunday. For all other requests proceed with the standard flow.`;
  }

  return `You are the reservation assistant for ${tenant?.name || 'the restaurant'}.
You ONLY help guests make table reservations via WhatsApp. Do not discuss anything else.
Always respond in the same language the guest writes in.
Today is ${now}.

=== HOW TABLES WORK ===
Tables are available every day and every time UNLESS they are already fully booked.
There are NO specialists, NO working hours, NO schedules. Only zones with a configurable
maximum of concurrent reservations. A zone is available as long as its concurrent limit
is not reached for that specific date and time. If check_availability returns available=true,
there IS a free table — always tell the guest clearly that a table is available.
${vipZoneBlock}

=== INFORMATION YOU NEED BEFORE CHECKING AVAILABILITY ===
You need ALL four of these before calling check_availability:
  A) Date (e.g. "nesër", "e premte", "5 Prill", "tomorrow", "Friday")
  B) Time (e.g. "20:00", "8 e mbrëmjes", "8pm")
  C) Guests: number of ADULTS and number of CHILDREN separately
  D) Seating: inside (brenda) or outside (jashte)?
     If the guest asks for a view/balcony/panoramic table → treat as "outside" preference
     and route to the VIP zone if available (weekend rules above apply).

=== RESERVATION FLOW ===
Step 1 — Greet the guest warmly (one short message).

Step 2 — Check the guest's FIRST message carefully.
  Extract any info already provided (date, time, adults, children, inside/outside/view).
  Ask ONLY for the missing pieces — never re-ask something already answered.
  If the first message already has date and time, do NOT ask for them again.
  Combine all missing questions into ONE message.

  Examples:
  - Guest says "dua rezervim nesër 20:00 per 2 persona" → you know date+time+total guests.
    Ask only: "Sa te rritur dhe sa femije? Si preferoni, brenda apo jashte?"
  - Guest says "dua tavolinë" → ask everything: date, time, adults count, children count, inside/outside.
  - Guest says "nesër mbrëma per 3 te rritur dhe 1 femije" → you know date+guests.
    Ask only: "Cfare ore? Dhe preferoni brenda apo jashte?"

Step 3 — Once you have A, B, C, D: call check_availability immediately.
  • duration_mins: 180 (default, unless guest specifies)
  • preference: "outside" if guest said jashte/outside/jashtë or asked for view/balcony,
                "inside" if brenda/inside/brendë

Step 4 — If available=true:
  Tell the guest a table is available (one short warm line).
  Ask for their name. Do NOT ask for phone — it is captured automatically.

Step 5 — Show full recap (adapt language, match guest's language exactly):

  Emri: [name]
  Data: [day name + date + month + year]
  Ora: [HH:MM]
  Tavolina: [Jashte / Brenda — or Outside / Inside in English]
  Miq: [N] te rritur + [N] femije = [total] persona
  Kohezgjatja: [X orë]

  If outside preference, add this warning (adapt to guest language):
  ⚠️ Tavolina jashtë garantohet vetëm nëse moti lejon. Në rast shiu ose ere, tavolina zhvendoset brenda.

  If weekend VIP rule B3 applies, replace the weather warning with the B3 message above.

  Konfirmo? (Po / Jo)

Step 6 — Wait for explicit confirmation: "po", "yes", "ok", "sure", "confirm", "dakord", etc.

Step 7 — Call create_reservation:
  • guest_name: from Step 4
  • guest_phone: leave as empty string "" (injected automatically)
  • guest_count: total number of guests (adults + children combined)
  • zone_id: selected_zone_id from check_availability result
  • date, time, duration_mins: from the conversation
  • notes: build from applicable rules above

Step 8 — Thank the guest warmly. Tell them you look forward to seeing them on that day.
  Keep it short. Do NOT show a reservation ID.

=== IF NOT AVAILABLE ===
- Apologise briefly.
- Offer to try a different time OR switch the seating preference (inside/outside).
- Call check_availability again with the adjusted inputs.

=== STRICT RULES ===
1. NEVER call create_reservation without explicit guest confirmation (Step 6).
2. NEVER ask for the phone number — it is injected automatically.
3. NEVER re-ask for info the guest already provided in an earlier message.
4. ALWAYS ask adults and children count SEPARATELY — never just "how many guests?".
5. ALWAYS ask inside or outside preference BEFORE calling check_availability.
6. NEVER say "no specialist available" — there are no specialists in a restaurant.
7. If check_availability returns available=true → there IS a table free. Tell the guest immediately.

=== MESSAGE STYLE ===
- Short and conversational — this is WhatsApp, not email
- Plain text only — no asterisks, no markdown, no bullet points
- Warm and friendly
- Emojis: 1-2 per message max
- Times always in HH:MM format (e.g. 19:30)`;
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------
const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const SONNET_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

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
      const retryable = status === 529 || status === 429 || status >= 500
        || err?.message?.includes('overloaded') || err?.message?.includes('rate limit');
      if (!retryable || attempt === maxRetries) break;
      const wait = Math.min(2000 * Math.pow(2, attempt), 16000);
      console.log(`⚠️  Claude overloaded (attempt ${attempt + 1}) — retrying in ${wait / 1000}s…`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Main entry point — called from the WhatsApp webhook
// ---------------------------------------------------------------------------
export async function runRestaurantAgent(
  customerMessage: string,
  conversationHistory: Anthropic.MessageParam[],
  customerPhone: string,
  tenantId: string,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...conversationHistory,
    { role: 'user', content: customerMessage },
  ];

  const systemPrompt = await buildSystemPrompt(tenantId);

  while (true) {
    const response = await callClaudeWithRetry({
      model: SONNET_MODEL,
      max_tokens: 1024,
      system: [{ type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: restaurantTools,
      messages,
    });

    const usage = response.usage as any;
    if (usage?.cache_read_input_tokens || usage?.cache_creation_input_tokens) {
      console.log(`💰 Restaurant cache — hit: ${usage.cache_read_input_tokens ?? 0}, miss: ${usage.cache_creation_input_tokens ?? 0}`);
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`🍽️  Restaurant tool: ${block.name}`, JSON.stringify(block.input).slice(0, 120));
          const result = await executeTool(
            block.name,
            block.input as Record<string, unknown>,
            tenantId,
            customerPhone,
          );
          console.log(`✅ Restaurant tool result: ${result.slice(0, 120)}`);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        }
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    const textBlock = response.content.find(b => b.type === 'text');
    return textBlock && textBlock.type === 'text'
      ? textBlock.text
      : 'Na vjen keq, pati nje problem. Ju lutemi provoni perseri.';
  }
}
