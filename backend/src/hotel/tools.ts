import Anthropic from '@anthropic-ai/sdk';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';

const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY });

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
export const hotelTools: Anthropic.Tool[] = [
  {
    name: 'get_hotel_info',
    description: 'Get hotel facility info: wifi password, breakfast hours, pool hours, restaurant hours, check-in/out times, or general contact info',
    input_schema: {
      type: 'object' as const,
      properties: {
        info_type: {
          type: 'string',
          enum: ['wifi', 'breakfast', 'pool', 'restaurant', 'checkin_checkout', 'general'],
        },
      },
      required: ['info_type'],
    },
  },
  {
    name: 'get_guest_info',
    description: 'Look up a checked-in guest to get their room number and stay details',
    input_schema: {
      type: 'object' as const,
      properties: {
        guest_phone: { type: 'string', description: 'Guest phone number' },
      },
      required: ['guest_phone'],
    },
  },
  {
    name: 'create_request',
    description: 'Log a guest service request or forward an unanswered question to the relevant department. The department is notified via WhatsApp with the guest\'s phone number. For housekeeping and maintenance, always collect the room number first. For concierge_question (unanswered questions), room_number and guest_name are optional.',
    input_schema: {
      type: 'object' as const,
      properties: {
        request_type: {
          type: 'string',
          enum: ['room_service', 'housekeeping', 'maintenance', 'concierge_question', 'complaint', 'other'],
        },
        description:  { type: 'string', description: 'Details of the request or the guest\'s question verbatim' },
        room_number:  { type: 'string', description: 'Guest room number — required for housekeeping and maintenance' },
        guest_name:   { type: 'string', description: 'Guest name if known' },
        priority:       { type: 'string', enum: ['high', 'normal', 'low'] },
        photo_url:      { type: 'string', description: 'URL of photo sent by guest, if any. Copy verbatim from the [Guest also sent a photo: ...] context in the message.' },
        photo_mime_type: { type: 'string', description: 'MIME type of the photo e.g. image/jpeg' },
      },
      required: ['request_type', 'description'],
    },
  },
  {
    name: 'get_faq_answer',
    description: 'Load the full hotel FAQ knowledge base. Call this for ANY guest question before doing anything else. Returns all Q&A pairs — you choose the best match semantically. If nothing is relevant, return null and decide whether to create a request instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        question: { type: 'string', description: 'The guest question, used for logging only' },
      },
      required: ['question'],
    },
  },
  {
    name: 'get_guest_requests',
    description: 'Get the status of open service requests for this guest',
    input_schema: {
      type: 'object' as const,
      properties: {
        guest_phone: { type: 'string' },
      },
      required: ['guest_phone'],
    },
  },
  {
    name: 'get_menu',
    description: 'Get hotel menu information when guest asks about food, drinks, room service, laundry, bar, breakfast, restaurant, or any menu. Returns menu details including file URL if available and list of items.',
    input_schema: {
      type: 'object' as const,
      properties: {
        menu_type: {
          type: 'string',
          enum: ['room_service', 'bar', 'restaurant', 'laundry', 'spa', 'breakfast', 'other', 'any'],
          description: 'Type of menu requested. Use "any" if unclear or guest just says "menu".',
        },
      },
      required: ['menu_type'],
    },
  },
];

// ---------------------------------------------------------------------------
// Routing maps
// ---------------------------------------------------------------------------
const DEPARTMENT_MAP: Record<string, string> = {
  room_service:       'food_beverage',
  housekeeping:       'housekeeping',
  maintenance:        'maintenance',
  concierge_question: 'reception',
  complaint:          'management',
  other:              'reception',
};

const DEFAULT_PRIORITY_MAP: Record<string, string> = {
  room_service:       'normal',
  housekeeping:       'normal',
  maintenance:        'high',
  concierge_question: 'normal',
  complaint:          'high',
  other:              'low',
};

function formatEta(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes === 60) return '1 hour';
  return `${Math.round((minutes / 60) * 10) / 10} hours`;
}

/**
 * Sanitizes a string for use as a Twilio template variable value.
 * Removes characters that break JSON or exceed Twilio limits.
 */
function sanitizeTemplateVar(value: string | null | undefined): string {
  return (value || '')
    .replace(/"/g, "'")           // double quotes break JSON — replace with single
    .replace(/\\/g, '')           // backslashes can break JSON
    .replace(/\n/g, ' ')          // newlines — replace with space
    .replace(/\r/g, '')           // carriage returns — remove
    .replace(/[\x00-\x1F]/g, '')  // control characters — remove
    .trim()
    .slice(0, 1024);              // Twilio max variable value length
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------
export async function executeHotelTool(
  name: string,
  input: Record<string, unknown>,
  tenantId: string,
  guestPhone: string,
): Promise<unknown> {
  switch (name) {

    case 'get_hotel_info': {
      const config = await dbGet('SELECT * FROM hotel_config WHERE tenant_id = ?', tenantId) as any;
      if (!config) return { error: 'Hotel configuration not found' };

      const infoMap: Record<string, unknown> = {
        wifi:             { password: config.wifi_password },
        breakfast:        { hours: config.breakfast_hours },
        pool:             { hours: config.pool_hours },
        restaurant:       { hours: config.restaurant_hours },
        checkin_checkout: { check_in: config.check_in_time, check_out: config.check_out_time },
        general: {
          name:      config.hotel_name,
          reception: config.reception_phone,
          emergency: config.emergency_phone,
        },
      };

      return infoMap[input.info_type as string] ?? { error: 'Info type not available' };
    }

    case 'get_guest_info': {
      const phone = (input.guest_phone as string) || guestPhone;
      const guest = await dbGet(
        `SELECT room_number, guest_name, check_in, check_out
         FROM hotel_guest_stays
         WHERE tenant_id = ? AND guest_phone = ? AND status = 'checked_in' LIMIT 1`,
        tenantId, phone,
      ) as any;
      return guest || { error: 'Guest not found or not currently checked in' };
    }

    case 'create_request': {
      const { request_type, description, room_number, guest_name, priority, photo_url, photo_mime_type } = input as {
        request_type: string; description: string; room_number?: string; guest_name?: string; priority?: string;
        photo_url?: string; photo_mime_type?: string;
      };
      const department    = DEPARTMENT_MAP[request_type] || 'reception';
      const finalPriority = priority || DEFAULT_PRIORITY_MAP[request_type] || 'normal';
      const finalRoom     = room_number || null;
      const finalPhoto    = photo_url    || null;
      const finalMime     = photo_mime_type || null;

      const id = crypto.randomUUID();
      await dbRun(
        `INSERT INTO hotel_requests
           (id, tenant_id, stay_id, room_number, guest_name, guest_phone, request_type, description, department, priority, photo_url, photo_mime_type)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, tenantId, null, finalRoom, guest_name ?? null, guestPhone,
        request_type, description, department, finalPriority, finalPhoto, finalMime,
      );

      let etaMinutes = 30; // default, overwritten below if department found

      // Notify the matching department via WhatsApp
      try {
        const depts = await dbAll(
          `SELECT name, whatsapp, request_types, response_time_minutes, language FROM hotel_departments
           WHERE tenant_id = ? AND is_active = 1`,
          tenantId,
        ) as any[];

        console.log(`[Hotel notify] ${depts.length} active dept(s) for tenant ${tenantId}, request_type=${request_type}`);

        const match = depts.find((d: any) => {
          const types: string[] = typeof d.request_types === 'string'
            ? JSON.parse(d.request_types)
            : d.request_types;
          console.log(`[Hotel notify] dept "${d.name}" handles: ${JSON.stringify(types)}`);
          return types.includes(request_type);
        });

        if (match?.response_time_minutes) {
          etaMinutes = Number(match.response_time_minutes) || 30;
        }

        if (match?.whatsapp) {
          // Load full tenant row so per-tenant Twilio credentials are used
          const tenantRow = await dbGet('SELECT * FROM tenants WHERE id = ?', tenantId) as any;

          const accountSid  = tenantRow?.twilio_account_sid || process.env.TWILIO_ACCOUNT_SID;
          const authToken   = tenantRow?.twilio_auth_token  || process.env.TWILIO_AUTH_TOKEN;
          const fromNumber  = tenantRow?.whatsapp_number?.startsWith('whatsapp:')
            ? tenantRow.whatsapp_number
            : `whatsapp:${tenantRow?.whatsapp_number}`;
          const toNumber    = match.whatsapp.startsWith('whatsapp:')
            ? match.whatsapp
            : `whatsapp:${match.whatsapp}`;

          const { default: twilio } = await import('twilio');
          const client = twilio(accountSid, authToken);

          const TYPE_LABELS: Record<string, string> = {
            room_service:       'Room Service',
            housekeeping:       'Housekeeping',
            maintenance:        'Maintenance',
            concierge_question: 'Guest Question',
            complaint:          'Complaint',
            other:              'General',
          };
          const time = new Date().toLocaleTimeString('en-GB', {
            hour: '2-digit', minute: '2-digit',
            timeZone: 'Europe/Tirane',
          });

          const templateSid = (tenantRow?.twilio_dept_template_sid as string | null)
            || process.env.TWILIO_DEPT_TEMPLATE_SID;

          console.log(`[Hotel notify] Sending to ${match.whatsapp} (dept: ${match.name})`);
          if (templateSid) {
            // Translate description to department language if not English
            const deptLang = (match.language as string) || 'en';
            let translatedDescription = description;

            if (deptLang !== 'en') {
              try {
                const LANG_NAMES: Record<string, string> = {
                  sq: 'Albanian', it: 'Italian', de: 'German',
                  fr: 'French',   es: 'Spanish', tr: 'Turkish',
                  ru: 'Russian',  ar: 'Arabic',
                };
                const langName = LANG_NAMES[deptLang] || deptLang;
                const translation = await anthropicClient.messages.create({
                  model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
                  max_tokens: 200,
                  messages: [{
                    role:    'user',
                    content: `You are a translator. Translate the following text to ${langName}.

Rules:
- Reply with ONLY the translated text
- No explanations, no notes, no parentheses, no commentary
- No quotation marks
- If the text is already in ${langName}, return it exactly as is with no changes and no comments
- Do not say "this is already in ${langName}" or anything similar
- Just the translation, nothing else

Text to translate: ${description}`,
                  }],
                });
                const textBlock = translation.content.find((b: any) => b.type === 'text');
                if (textBlock?.type === 'text' && (textBlock as any).text.trim()) {
                  let translated = (textBlock as any).text.trim();
                  // Safety trim — strip any explanation text that slips through
                  translated = translated
                    .replace(/\s*---.*$/s, '')          // remove after ---
                    .replace(/\s*\(This is.*$/s, '')    // remove explanation in parentheses
                    .replace(/\s*\(Note:.*$/s, '')      // remove notes
                    .replace(/\s*If you.*$/s, '')       // remove "If you meant..." explanations
                    .trim();
                  translatedDescription = translated || description; // fallback to original if empty
                }
                console.log(`[Hotel notify] Translated to ${langName}: "${translatedDescription}"`);
              } catch (err: any) {
                console.warn('[Hotel notify] Translation failed, using original:', err.message);
              }
            }

            // Sanitize all variable values before building contentVariables
            const templateVars = {
              '1': sanitizeTemplateVar(room_number || 'N/A'),
              '2': sanitizeTemplateVar(TYPE_LABELS[request_type] || request_type),
              '3': sanitizeTemplateVar(translatedDescription),
              '4': sanitizeTemplateVar(time),
            };
            console.log('[Hotel notify] contentVariables:', JSON.stringify(templateVars));

            try {
              await client.messages.create({
                from:             fromNumber,
                to:               toNumber,
                contentSid:       templateSid,
                contentVariables: JSON.stringify(templateVars),
              });
              console.log(`[Hotel notify] ✅ Template sent to ${match.name} in ${deptLang}`);
            } catch (err: any) {
              console.error(`[Hotel notify] ❌ Template send failed:`, err.message);
            }
          } else {
            // Fallback to free-form if no template SID configured
            const EMOJI: Record<string, string> = {
              room_service:       '🍽️',
              housekeeping:       '🛏️',
              maintenance:        '🔧',
              concierge_question: '💬',
              complaint:          '⚠️',
              other:              '📋',
            };
            const roomLabel  = finalRoom ? `Room ${finalRoom}` : 'Room N/A';
            const nameLabel  = guest_name ? ` · ${guest_name}` : '';
            const cleanPhone = guestPhone.replace(/^whatsapp:/, '');
            const msg = [
              `${EMOJI[request_type] || '📋'} *${TYPE_LABELS[request_type] || request_type} — ${roomLabel}${nameLabel}*`,
              `📱 Guest: ${cleanPhone}`,
              ``,
              description,
              ``,
              `_${time}_`,
            ].join('\n');
            try {
              await client.messages.create({ from: fromNumber, to: toNumber, body: msg });
              console.log(`[Hotel notify] ✅ Free-form sent to ${match.name}`);
            } catch (err: any) {
              console.error(`[Hotel notify] ❌ Free-form send failed:`, err.message);
            }
          }
        } else {
          console.warn(`[Hotel notify] ⚠️ No active department matched request_type="${request_type}"`);
        }
      } catch (notifyErr: any) {
        console.error('[Hotel notify] ❌ Failed:', notifyErr?.message, notifyErr?.status ?? '');
      }

      return {
        success:     true,
        request_id:  id,
        room:        finalRoom,
        department,
        priority:    finalPriority,
        eta:         formatEta(etaMinutes),
        photo_saved: !!finalPhoto,
      };
    }

    case 'get_faq_answer': {
      const faqs = await dbAll(
        `SELECT question, answer, category FROM hotel_faq WHERE tenant_id = ? AND is_active = 1 ORDER BY category, question`,
        tenantId,
      ) as any[];

      if (!faqs.length) return { found: false, faqs: [], note: 'No FAQ entries configured yet.' };

      // Return ALL FAQs — Claude does the semantic matching
      return { found: true, faqs };
    }

    case 'get_guest_requests': {
      const phone = (input.guest_phone as string) || guestPhone;
      const requests = await dbAll(
        `SELECT request_type, description, status, department, created_at
         FROM hotel_requests
         WHERE tenant_id = ? AND guest_phone = ? AND status != 'resolved'
         ORDER BY created_at DESC LIMIT 5`,
        tenantId, phone,
      ) as any[];

      return { requests };
    }

    case 'get_menu': {
      const { menu_type } = input as { menu_type: string };
      const menus = await dbAll(
        menu_type === 'any'
          ? `SELECT * FROM hotel_menus WHERE tenant_id = ? AND is_active = 1 ORDER BY display_order ASC`
          : `SELECT * FROM hotel_menus WHERE tenant_id = ? AND is_active = 1 AND menu_type = ? ORDER BY display_order ASC`,
        ...(menu_type === 'any' ? [tenantId] : [tenantId, menu_type]),
      ) as any[];

      if (!menus.length) return { found: false, message: 'No menu available for this category.' };

      const result = await Promise.all(menus.map(async (menu: any) => {
        const items = await dbAll(
          `SELECT name, description, price, currency, category
           FROM hotel_menu_items
           WHERE menu_id = ? AND is_available = 1
           ORDER BY category, display_order`,
          menu.id,
        ) as any[];
        return {
          id:          menu.id,
          name:        menu.name,
          menu_type:   menu.menu_type,
          description: menu.description,
          has_file:    !!menu.file_url,
          file_url:    menu.file_url  || null,
          file_type:   menu.file_type || null,
          has_items:   items.length > 0,
          items,
        };
      }));

      return { found: true, menus: result };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
