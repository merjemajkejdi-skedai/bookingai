// Hotel side of the escalation timeout fallback: files the normal request when staff didn't answer.
// Reuses the create_request tool as-is, so department matching, translation and staff notification
// behave exactly as they do today.
import { query } from '../db/database.js';
import { executeHotelTool } from './tools.js';
import type { FallbackRow } from '../escalation/fallback.js';

async function rows(sql: string, params: unknown[]): Promise<any[]> {
  return (await query(sql, params)) as any[];
}

export async function createHotelFallbackRequest(row: FallbackRow): Promise<void> {
  const [conv] = await rows(
    `SELECT guest_phone, channel, channel_user_id, guest_name FROM hotel_conversations WHERE id = ? AND tenant_id = ?`,
    [row.conversation_id, row.tenant_id],
  );
  if (!conv) throw new Error('conversation not found');

  // The agent addresses email guests as "email:<address>" and every other channel by guest_phone.
  const phone: string = conv.channel === 'email' ? (conv.channel_user_id ?? `email:${conv.guest_phone}`) : conv.guest_phone;
  const plus = phone.startsWith('+') ? phone : `+${phone}`;
  const [stay] = await rows(
    `SELECT guest_name, room_number FROM hotel_guest_stays
     WHERE tenant_id = ? AND (guest_phone = ? OR guest_phone = ?) AND status = 'checked_in' LIMIT 1`,
    [row.tenant_id, phone, plus],
  );

  // allowMissingRoom is only ever passed here — never by the model — so normal chats still have to
  // collect a room number. The guest's phone number and question are enough for staff to follow up.
  const result = await executeHotelTool(
    'create_request',
    {
      request_type: row.kind === 'request' ? 'other' : 'concierge_question',
      description: row.guest_question,
      room_number: stay?.room_number || undefined,
      guest_name: stay?.guest_name || conv.guest_name || undefined,
    },
    row.tenant_id,
    phone,
    { allowMissingRoom: true },
  ) as any;

  if (!result?.success) throw new Error(`create_request did not succeed: ${JSON.stringify(result).slice(0, 200)}`);
}
