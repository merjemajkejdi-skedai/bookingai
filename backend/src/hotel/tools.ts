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
    description: 'Log a guest service request once you have their room number and last name. Assigns to the correct department and notifies via WhatsApp.',
    input_schema: {
      type: 'object' as const,
      properties: {
        request_type: {
          type: 'string',
          enum: ['room_service', 'housekeeping', 'maintenance', 'concierge_question', 'complaint', 'other'],
        },
        description:  { type: 'string', description: 'Details of the request' },
        room_number:  { type: 'string', description: 'Guest room number' },
        guest_name:   { type: 'string', description: 'Guest last name as provided' },
        priority:     { type: 'string', enum: ['high', 'normal', 'low'] },
      },
      required: ['request_type', 'description', 'room_number', 'guest_name'],
    },
  },
  {
    name: 'get_faq_answer',
    description: 'Search the hotel FAQ knowledge base for an answer to a guest question',
    input_schema: {
      type: 'object' as const,
      properties: {
        question: { type: 'string' },
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
        request_type: string; description: string; room_number: string; guest_name: string; priority?: string;
      };
      const department    = DEPARTMENT_MAP[request_type] || 'reception';
      const finalPriority = priority || DEFAULT_PRIORITY_MAP[request_type] || 'normal';

      const id = crypto.randomUUID();
      await dbRun(
        `INSERT INTO hotel_requests
           (id, tenant_id, stay_id, room_number, guest_name, guest_phone, request_type, description, department, priority)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id, tenantId, null, room_number, guest_name ?? null, guestPhone,
        request_type, description, department, finalPriority,
      );

      // Notify the matching department via WhatsApp
      try {
        const depts = await dbAll(
          `SELECT name, whatsapp, request_types FROM hotel_departments
           WHERE tenant_id = ? AND (is_active = 1 OR is_active = true)`,
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
          const time = new Date().toLocaleTimeString('en-GB', {
            hour: '2-digit', minute: '2-digit',
            timeZone: 'Europe/Tirane',
          });
          const guestLabel = guest_name ? ` · ${guest_name}` : '';
          const msg = `${EMOJI[request_type] || '📋'} *Room ${room_number}${guestLabel}*\n${description}\n_${time}_`;
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
        room:       room_number,
        department,
        priority:   finalPriority,
        eta:        ETA_MAP[finalPriority],
      };
    }

    case 'get_faq_answer': {
      const faqs = await dbAll(
        `SELECT question, answer FROM hotel_faq WHERE tenant_id = ? AND is_active = 1`,
        tenantId,
      ) as any[];

      const q = (input.question as string).toLowerCase();
      const match = faqs.find((f: any) =>
        f.question.toLowerCase().split(' ').some((w: string) => w.length > 3 && q.includes(w)),
      );

      return match ? { answer: match.answer } : { answer: null };
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

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
