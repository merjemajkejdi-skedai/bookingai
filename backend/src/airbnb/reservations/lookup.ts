// lookup_reservation_by_name — Path B (guest-initiated) check-in delivery.
//
// A name match can hand out a door code, so every ambiguous or unsafe case
// fails closed: "no_match" / "ambiguous" / "held_by_host" never reveal
// anything about any reservation, and the tool result never contains another
// guest's details.
import { isPg, prepare, query, queryOne, queryRun } from '../../db/database.js';
import { setConversationListing } from '../session.js';
import { nameScore, MATCH_THRESHOLD } from './nameMatch.js';
import { parseBlocks, sendInstructionBlocks } from './deliver.js';

async function dbAll(sql: string, ...p: unknown[]) { return (isPg ? query(sql, p) : prepare(sql).all(...p)) as any[]; }
async function dbGet(sql: string, ...p: unknown[]) { return (isPg ? queryOne(sql, p) : prepare(sql).get(...p)) as any; }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

type CreateRequest = (input: { listing_id: string; category: string; description: string }) => Promise<string>;

const digits = (s: string | null | undefined) => (s || '').replace(/\D/g, '');

function todayIn(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tirane', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
}

function readable(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

export async function tenantHasReservations(tenantId: string): Promise<boolean> {
  const row = await dbGet('SELECT 1 AS x FROM airbnb_reservations WHERE tenant_id = ? LIMIT 1', tenantId);
  return !!row;
}

export async function handleLookupReservation(
  input: { guest_name: string },
  tenantId: string,
  conversationId: string,
  createRequest: CreateRequest,
): Promise<string> {
  const out = (o: Record<string, unknown>) => JSON.stringify(o);
  const guestName = (input.guest_name || '').trim();
  if (!guestName) return out({ status: 'no_match' });

  const [tenant, conv] = await Promise.all([
    dbGet('SELECT * FROM tenants WHERE id = ?', tenantId),
    dbGet('SELECT id, channel, channel_user_id FROM airbnb_conversations WHERE id = ? AND tenant_id = ?', conversationId, tenantId),
  ]);
  if (!tenant || !conv) return out({ status: 'no_match' });

  const today = todayIn(tenant.timezone || 'Europe/Tirane');

  // Current or upcoming, confirmed reservations at active listings only.
  const rows = await dbAll(
    `SELECT r.id, r.listing_id, r.guest_name, r.guest_phone, r.do_not_send,
            to_char(r.checkin_date, 'YYYY-MM-DD') AS checkin_date,
            to_char(r.checkout_date, 'YYYY-MM-DD') AS checkout_date
     FROM airbnb_reservations r
     JOIN airbnb_listings l ON l.id = r.listing_id
     WHERE r.tenant_id = ? AND r.status = 'confirmed' AND l.is_active = true
       AND COALESCE(r.checkout_date, r.checkin_date) >= ?::date
     LIMIT 500`,
    tenantId, today,
  );

  const scored = rows
    .map(r => ({ r, s: nameScore(guestName, r.guest_name) }))
    .filter(x => x.s >= MATCH_THRESHOLD)
    .sort((a, b) => b.s - a.s || a.r.checkin_date.localeCompare(b.r.checkin_date));
  if (scored.length === 0) return out({ status: 'no_match' });

  // Among equally-good name matches, the one for a stay that has started
  // wins over a future one; if that still doesn't single one out, ask again.
  const top = scored.filter(x => x.s === scored[0].s);
  let best = top[0];
  if (top.length > 1) {
    const active = top.filter(x => x.r.checkin_date <= today);
    if (active.length === 1) best = active[0];
    else if (active.length === 0) {
      const earliest = top[0].r.checkin_date;
      const same = top.filter(x => x.r.checkin_date === earliest);
      if (same.length > 1) return out({ status: 'ambiguous' });
      best = same[0];
    } else return out({ status: 'ambiguous' });
  }
  const res = best.r;

  // Not yet check-in day: say when, reveal nothing else, link nothing.
  if (res.checkin_date > today) {
    return out({ status: 'future', checkin_date: readable(res.checkin_date) });
  }

  // From here the stay has started (or starts today).

  // Already linked to a different number — someone else with a similar name,
  // or the guest on another number. Treat as no match rather than send a door
  // code to a second person.
  const isWhatsApp = (conv.channel || 'whatsapp').toLowerCase() === 'whatsapp';
  if (isWhatsApp && res.guest_phone && digits(res.guest_phone) !== digits(conv.channel_user_id)) {
    return out({ status: 'no_match' });
  }

  const listing = await dbGet('SELECT id, name, checkin_instructions FROM airbnb_listings WHERE id = ? AND tenant_id = ?', res.listing_id, tenantId);
  if (!listing) return out({ status: 'no_match' });

  // Host said not to send: block this path too (deliberately doesn't link the
  // listing, or the listing's own door-code details would become answerable).
  if (res.do_not_send) {
    await createRequest({
      listing_id: listing.id, category: 'guest_issue',
      description: `Guest "${guestName}" messaged for check-in instructions, but this reservation is marked "Don't send check-in instructions". Please contact them directly.`,
    }).catch(() => {});
    return out({ status: 'held_by_host' });
  }

  const blocks = parseBlocks(listing.checkin_instructions);
  if (blocks.length === 0) {
    await setConversationListing(conversationId, listing.id);
    await createRequest({
      listing_id: listing.id, category: 'guest_issue',
      description: `Guest "${guestName}" is checking in today at ${listing.name} but no check-in instructions are configured for this listing. Please send them directly.`,
    }).catch(() => {});
    return out({ status: 'no_instructions_configured' });
  }

  try {
    await sendInstructionBlocks(tenant, conv, blocks);
  } catch (e: any) {
    console.error('[Reservations] Instruction send failed:', e.message);
    await setConversationListing(conversationId, listing.id);
    await createRequest({
      listing_id: listing.id, category: 'guest_issue',
      description: `Automatic check-in instructions failed to send to guest "${guestName}" at ${listing.name}. Please send them directly.`,
    }).catch(() => {});
    return out({ status: 'send_failed' });
  }

  // Sent: record it, backfill the guest's number (WhatsApp only — other
  // channels' ids aren't phone numbers), and pin the conversation to the
  // listing so every later question resolves to the right property.
  const phone = isWhatsApp ? (conv.channel_user_id || '').replace(/^whatsapp:/, '') : null;
  await dbRun(
    `UPDATE airbnb_reservations SET
       checkin_instructions_sent = true,
       guest_phone = COALESCE(?, guest_phone),
       updated_at = NOW()
     WHERE id = ?`,
    phone, res.id,
  );
  await setConversationListing(conversationId, listing.id);
  return out({ status: 'instructions_sent', listing_name: listing.name });
}
