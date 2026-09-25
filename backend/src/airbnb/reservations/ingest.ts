// Inbound reservation email pipeline. Called from the Mailgun inbound webhook
// (routes/emailWebhook.ts) before the hotel-review handler: if the recipient is
// a listing's dedicated address or a tenant's shared address, the email is ours
// and is consumed here; otherwise this returns false and the webhook carries
// on unchanged.
//
// Only Airbnb booking-confirmation and cancellation emails change any data.
// Guest-message notifications are logged and ignored; everything else (a
// "changed" email, Booking.com, anything unrecognised or failing a sanity
// check) lands in the review queue (airbnb_email_ingest_log, statuses
// unparsed / unmatched / error) and never creates or updates a reservation.
import { isPg, prepare, query, queryOne, queryRun } from '../../db/database.js';
import { htmlToText, normalizeEmailText, extractEmailAddress } from './emailText.js';
import { parseReservationEmail, type ParsedReservation } from './parseReservationEmail.js';
import { nameScore } from './nameMatch.js';
import { resolveSharedListing } from './resolveListing.js';
import { alertError } from '../../utils/errorMonitor.js';

async function dbAll(sql: string, ...p: unknown[]) { return (isPg ? query(sql, p) : prepare(sql).all(...p)) as any[]; }
async function dbGet(sql: string, ...p: unknown[]) { return (isPg ? queryOne(sql, p) : prepare(sql).get(...p)) as any; }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const MAX_BODY_CHARS = 100_000;
const DATE_WINDOW_DAYS = 3;

interface ExistingRow { id: string; listing_id: string; guest_name: string; checkin_date: string; status: string }

const EXISTING_COLS = `id, listing_id, guest_name, status, to_char(checkin_date, 'YYYY-MM-DD') AS checkin_date`;

async function findByCode(listingId: string, code: string): Promise<ExistingRow | null> {
  return await dbGet(
    `SELECT ${EXISTING_COLS} FROM airbnb_reservations WHERE listing_id = ? AND reservation_code = ? LIMIT 1`,
    listingId, code,
  ) ?? null;
}

// Airbnb confirmation codes are globally unique, so on the shared address a
// cancellation can be matched by code across the whole tenant — which also
// tells us the listing without any name matching.
async function findByCodeInTenant(tenantId: string, code: string): Promise<ExistingRow | null> {
  return await dbGet(
    `SELECT ${EXISTING_COLS} FROM airbnb_reservations WHERE tenant_id = ? AND reservation_code = ? LIMIT 1`,
    tenantId, code,
  ) ?? null;
}

// Used only to merge a confirmation into a reservation the host already added
// by hand (which has no confirmation code): same listing, same check-in date,
// confident fuzzy name match. Ties are treated as no match.
async function findManualByNameAndDate(listingId: string, name: string, checkin: string): Promise<ExistingRow | null> {
  const rows = await dbAll(
    `SELECT ${EXISTING_COLS} FROM airbnb_reservations
     WHERE listing_id = ? AND reservation_code IS NULL AND ABS(checkin_date - ?::date) <= ?`,
    listingId, checkin, DATE_WINDOW_DAYS,
  ) as ExistingRow[];
  const scored = rows
    .filter(r => r.checkin_date === checkin)
    .map(r => ({ r, s: nameScore(name, r.guest_name) }))
    .filter(x => x.s >= 85)
    .sort((a, b) => b.s - a.s);
  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0].s === scored[1].s) return null;
  return scored[0].r;
}

async function setLog(id: string, status: string, reason: string | null, reservationId: string | null) {
  await dbRun(
    'UPDATE airbnb_email_ingest_log SET status = ?, reason = ?, reservation_id = ? WHERE id = ?',
    status, reason, reservationId, id,
  );
}

async function apply(
  data: ParsedReservation,
  listing: { id: string; tenant_id: string },
  logId: string,
  found: ExistingRow | null,
): Promise<{ status: string; reason: string | null; reservationId: string | null }> {
  const { kind, reservationCode, guestName, guestCount, checkinDate, checkoutDate, platform } = data;

  if (kind === 'cancellation') {
    // Matched by confirmation code only. No match (e.g. the original
    // confirmation was never forwarded) goes to review — never an orphan row.
    const existing = found ?? await findByCode(listing.id, reservationCode);
    if (!existing) return { status: 'unmatched', reason: 'no_cancellation_target', reservationId: null };
    await dbRun(
      "UPDATE airbnb_reservations SET status = 'cancelled', source_email_ref = ?, updated_at = NOW() WHERE id = ?",
      logId, existing.id,
    );
    return { status: 'parsed', reason: null, reservationId: existing.id };
  }

  // Confirmation: same code again (host forwarded it twice) or a reservation
  // the host entered by hand -> update; otherwise create.
  let existing = await findByCode(listing.id, reservationCode);
  if (!existing && guestName && checkinDate) existing = await findManualByNameAndDate(listing.id, guestName, checkinDate);

  if (existing) {
    await dbRun(
      `UPDATE airbnb_reservations SET
         status = 'confirmed', checkin_date = ?::date, checkout_date = ?::date,
         reservation_code = COALESCE(reservation_code, ?),
         guest_count = COALESCE(guest_count, ?),
         source_email_ref = ?, updated_at = NOW()
       WHERE id = ?`,
      checkinDate, checkoutDate, reservationCode, guestCount, logId, existing.id,
    );
    return { status: 'parsed', reason: 'updated_existing', reservationId: existing.id };
  }

  const id = crypto.randomUUID();
  await dbRun(
    `INSERT INTO airbnb_reservations
       (id, tenant_id, listing_id, platform, reservation_code, guest_name, guest_count,
        checkin_date, checkout_date, source, source_email_ref)
     VALUES (?,?,?,?,?,?,?, ?::date,?::date, 'email_forward', ?)`,
    id, listing.tenant_id, listing.id, platform, reservationCode, guestName, guestCount,
    checkinDate, checkoutDate, logId,
  );
  return { status: 'parsed', reason: null, reservationId: id };
}

export async function handleReservationEmail(opts: {
  recipient: string; from: string; subject: string; textBody: string; htmlBody?: string;
  sentAt?: Date | null;
}): Promise<boolean> {
  const address = extractEmailAddress(opts.recipient);
  if (!address) return false;

  // A listing's own dedicated address is unambiguous. Failing that, the address
  // may be a tenant's shared one, in which case the listing is worked out below.
  let listing: any = null;
  let sharedTenantId: string | null = null;
  try {
    listing = await dbGet(
      `SELECT l.id, l.tenant_id, l.name FROM airbnb_listings l
       JOIN tenants t ON t.id = l.tenant_id
       WHERE l.confirmation_forward_email = ? AND t.deleted_at IS NULL`,
      address,
    );
    if (!listing) {
      const t = await dbGet(
        'SELECT id FROM tenants WHERE shared_confirmation_forward_email = ? AND deleted_at IS NULL',
        address,
      );
      sharedTenantId = t?.id ?? null;
    }
  } catch {
    return false; // e.g. table missing in a non-Postgres dev DB — not ours
  }
  if (!listing && !sharedTenantId) return false;

  const tenantId: string = listing?.tenant_id ?? sharedTenantId;
  const rawBody = opts.textBody?.trim() ? opts.textBody : htmlToText(opts.htmlBody || '');
  const body = normalizeEmailText(rawBody);
  const logId = crypto.randomUUID();

  try {
    await dbRun(
      `INSERT INTO airbnb_email_ingest_log (id, tenant_id, listing_id, status, from_address, subject, body_text)
       VALUES (?,?,?, 'received', ?,?,?)`,
      logId, tenantId, listing?.id ?? null, opts.from, opts.subject, body.slice(0, MAX_BODY_CHARS),
    );

    const parsed = parseReservationEmail({ from: opts.from, subject: opts.subject, body, sentAt: opts.sentAt });

    if (parsed.status === 'ignored') {
      await setLog(logId, 'ignored', parsed.reason, null);
      return true;
    }
    if (parsed.status === 'review') {
      await setLog(logId, 'unparsed', parsed.reason, null);
      console.warn(`[Reservations] Email for tenant ${tenantId} sent to review: ${parsed.reason}`);
      return true;
    }
    const data = parsed.data;

    // Shared address: work out the listing now that we know what the email is.
    let found: ExistingRow | null = null;
    if (!listing) {
      if (data.kind === 'cancellation') {
        found = await findByCodeInTenant(tenantId, data.reservationCode);
        if (!found) {
          await setLog(logId, 'unmatched', 'no_cancellation_target', null);
          return true;
        }
        listing = { id: found.listing_id, tenant_id: tenantId };
      } else {
        // Only this tenant's listings that opted in are candidates — a listing
        // on its own dedicated address is never matched through the shared inbox.
        const candidates = await dbAll(
          `SELECT id, tenant_id, name, address, airbnb_listing_number FROM airbnb_listings
           WHERE tenant_id = ? AND use_shared_forward_email = true`,
          tenantId,
        );
        const resolved = resolveSharedListing(`${opts.subject}\n${body}`, candidates, data.airbnbListingNumber);
        if (!resolved.ok) {
          await setLog(logId, 'unmatched', resolved.reason, null);
          console.warn(`[Reservations] Shared-address email for tenant ${tenantId}: ${resolved.reason}`);
          return true;
        }
        listing = candidates.find(c => c.id === resolved.listing.id);
      }
      await dbRun('UPDATE airbnb_email_ingest_log SET listing_id = ? WHERE id = ?', listing.id, logId);
    }

    const outcome = await apply(data, listing, logId, found);
    await setLog(logId, outcome.status, outcome.reason, outcome.reservationId);
    console.log(`[Reservations] airbnb ${data.kind} → ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ''} [listing ${listing.id}]`);
  } catch (e: any) {
    console.error('[Reservations] Ingest error:', e.message);
    alertError(e, 'handleReservationEmail', { listingId: listing?.id ?? null, tenantId });
    await setLog(logId, 'error', e.message?.slice(0, 200) ?? 'error', null).catch(() => {});
  }
  return true;
}
