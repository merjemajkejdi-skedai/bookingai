// Airbnb side of human escalation: context for the shared escalation core, and the prompt override.
// Only reached when the tenant enabled escalation (see getEscalationState in airbnb/agent.ts). Here the "staff"
// who answers is the host, so guests are told "the host" is being asked.
import { isPg, query } from '../db/database.js';
import { escalateFromToolInput, escalationToolResult } from '../escalation/alert.js';

async function rows(sql: string, params: unknown[]): Promise<any[]> {
  return (await query(sql, params)) as any[];
}

export const AIRBNB_WHO = 'the host';

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

export async function executeAirbnbEscalation(
  input: Record<string, unknown>,
  tenantId: string,
  conversationId: string,
): Promise<unknown> {
  const unreachable = escalationToolResult({ ok: false, reason: 'send_failed' }, AIRBNB_WHO);
  if (!isPg) return unreachable;

  try {
    const [conv] = await rows(
      `SELECT listing_id, channel, channel_user_id FROM airbnb_conversations WHERE id = ? AND tenant_id = ?`,
      [conversationId, tenantId],
    );
    if (!conv) return unreachable;

    let listingName: string | null = null;
    let guestName: string | null = null;
    if (conv.listing_id) {
      const [listing] = await rows(`SELECT name FROM airbnb_listings WHERE id = ? AND tenant_id = ?`, [conv.listing_id, tenantId]);
      listingName = listing?.name ?? null;

      // A guest whose reservation was matched by phone has a name on file.
      if (conv.channel === 'whatsapp') {
        const res = await rows(
          `SELECT guest_name, guest_phone FROM airbnb_reservations
           WHERE tenant_id = ? AND listing_id = ? AND guest_phone IS NOT NULL ORDER BY checkin_date DESC LIMIT 20`,
          [tenantId, conv.listing_id],
        );
        guestName = res.find(r => digits(r.guest_phone) === digits(conv.channel_user_id))?.guest_name ?? null;
      }
    }
    if (!guestName && typeof input.guest_name === 'string' && input.guest_name.trim()) guestName = input.guest_name.trim();

    let dept: any = null;
    if (typeof input.department === 'string' && input.department.trim()) {
      [dept] = await rows(
        `SELECT id, name, escalation_number FROM airbnb_departments
         WHERE tenant_id = ? AND is_active = true AND LOWER(name) = LOWER(?) LIMIT 1`,
        [tenantId, input.department.trim()],
      );
    }

    const [tenant] = await rows(`SELECT name FROM tenants WHERE id = ?`, [tenantId]);

    return await escalateFromToolInput({
      tenantId,
      conversationId,
      input,
      businessName: tenant?.name || 'Host',
      guestName,
      contextBits: [listingName ? `Listing: ${listingName}` : null, dept?.name ?? null],
      department: dept ? { id: String(dept.id), escalation_number: dept.escalation_number ?? null } : null,
      who: AIRBNB_WHO,
    });
  } catch (e: any) {
    console.error('[Airbnb escalation] failed — agent will fall back to a normal request:', e.message);
    return unreachable;
  }
}
