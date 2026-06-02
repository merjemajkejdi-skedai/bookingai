import Anthropic from '@anthropic-ai/sdk';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';

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
        priority:     { type: 'string', enum: ['high', 'normal', 'low'] },
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

const ETA_MAP: Record<string, string> = {
  high:   '10 minutes',
  normal: '30 minutes',
  low:    '1 hour',
};

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
      const { request_type, description, room_number, guest_name, priority } = input as {
        request_type: string; description: string; room_number?: string; guest_name?: string; priority?: string;
      };
      const department    = DEPARTMENT_MAP[request_type] || 'reception';
      const finalPriority = priority || DEFAULT_PRIORITY_MAP[request_type] || 'normal';
      const finalRoom     = room_number || null;

      const id = crypto.randomUUID();
      await dbRun(
        `INSERT INTO hotel_requests
           (id, tenant_id, stay_id, room_number, guest_name, guest_phone, request_type, description, department, priority)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id, tenantId, null, finalRoom, guest_name ?? null, guestPhone,
        request_type, description, department, finalPriority,
      );

      // Notify the matching department via WhatsApp
      try {
        const depts = await dbAll(
          `SELECT name, whatsapp, request_types FROM hotel_departments
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

        if (match?.whatsapp) {
          const EMOJI: Record<string, string> = {
            room_service:       '🍽️',
            housekeeping:       '🛏️',
            maintenance:        '🔧',
            concierge_question: '💬',
            complaint:          '⚠️',
            other:              '📋',
          };
          const TYPE_LABEL: Record<string, string> = {
            room_service:       'Room Service',
            housekeeping:       'Housekeeping',
            maintenance:        'Maintenance',
            concierge_question: 'Guest Question',
            complaint:          'Complaint',
            other:              'Request',
          };
          const time = new Date().toLocaleTimeString('en-GB', {
            hour: '2-digit', minute: '2-digit',
            timeZone: 'Europe/Tirane',
          });

          const emoji      = EMOJI[request_type] || '📋';
          const typeLabel  = TYPE_LABEL[request_type] || request_type;
          const roomLabel  = finalRoom ? `Room ${finalRoom}` : 'Room N/A';
          const nameLabel  = guest_name ? ` · ${guest_name}` : '';
          const cleanPhone = guestPhone.replace(/^whatsapp:/, '');

          const msg = [
            `${emoji} *${typeLabel} — ${roomLabel}${nameLabel}*`,
            `📱 Guest: ${cleanPhone}`,
            ``,
            description,
            ``,
            `_${time}_`,
          ].join('\n');

          console.log(`[Hotel notify] Sending to ${match.whatsapp} (dept: ${match.name})`);
          await sendWhatsAppMessage(match.whatsapp, msg);
          console.log(`[Hotel notify] ✅ Sent to ${match.name}`);
        } else {
          console.warn(`[Hotel notify] ⚠️ No active department matched request_type="${request_type}"`);
        }
      } catch (notifyErr: any) {
        console.error('[Hotel notify] ❌ Failed:', notifyErr?.message, notifyErr?.status ?? '');
      }

      return {
        success:    true,
        request_id: id,
        room:       finalRoom,
        department,
        priority:   finalPriority,
        eta:        ETA_MAP[finalPriority],
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
