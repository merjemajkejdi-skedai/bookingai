// Inbound reservation email pipeline. Called from the Mailgun inbound webhook
// (routes/emailWebhook.ts) before the hotel-review handler: if the recipient is
// a listing's confirmation_forward_email, the email is ours and is consumed
// here; otherwise this returns false and the webhook carries on unchanged.
import { isPg, prepare, query, queryOne, queryRun } from '../../db/database.js';
import { htmlToText, normalizeEmailText, extractEmailAddress } from './emailText.js';
import { parseReservationEmail, type ParsedReservation } from './parseReservationEmail.js';
import { nameScore, MATCH_THRESHOLD } from './nameMatch.js';
import { alertError } from '../../utils/errorMonitor.js';

async function dbAll(sql: string, ...p: unknown[]) { return (isPg ? query(sql, p) : prepare(sql).all(...p)) as any[]; }
async function dbGet(sql: string, ...p: unknown[]) { return (isPg ? queryOne(sql, p) : prepare(sql).get(...p)) as any; }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const MAX_BODY_CHARS = 100_000;
const DATE_WINDOW_DAYS = 3;

interface ExistingRow { id: string; guest_name: string; checkin_date: string; status: string }

async function findByCode(listingId: string, code: string): Promise<ExistingRow | null> {
  return await dbGet(
    `SELECT id, guest_name, status, to_char(checkin_date, 'YYYY-MM-DD') AS checkin_date
     FROM airbnb_reservations WHERE listing_id = ? AND reservation_code = ? LIMIT 1`,
    listingId, code,
  ) ?? null;
}

// Fallback when the email has no parseable code: same listing, close-enough
// check-in date, confident fuzzy name match. Ties are treated as no match —
// never guess which of two look-alike bookings an email refers to.
async function findByNameAndDate(listingId: string, name: string, checkin: string, minScore: number): Promise<ExistingRow | null> {
  const rows = await dbAll(
    `SELECT id, guest_name, status, to_char(checkin_date, 'YYYY-MM-DD') AS checkin_date
     FROM airbnb_reservations
     WHERE listing_id = ? AND ABS(checkin_date - ?::date) <= ?`,
    listingId, checkin, DATE_WINDOW_DAYS,
  ) as ExistingRow[];
  const scored = rows
    .map(r => ({ r, s: nameScore(name, r.guest_name) }))
    .filter(x => x.s >= minScore)
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
  parsed: ParsedReservation, listing: { id: string; tenant_id: string }, logId: string,
): Promise<{ status: string; reason: string | null; reservationId: string | null }> {
  const { kind, reservationCode, guestName, checkinDate, checkoutDate, platform } = parsed;

  let existing: ExistingRow | null = null;
  if (reservationCode) existing = await findByCode(listing.id, reservationCode);
  if (!existing && guestName && checkinDate) {
    // Confirmations only dedupe against an equally-confident, same-day row;
    // cancels/changes accept a looser match since the email is about
    // something that already exists.
    existing = await findByNameAndDate(listing.id, guestName, checkinDate, kind === 'confirmation' ? 85 : MATCH_THRESHOLD);
    if (existing && kind === 'confirmation' && existing.checkin_date !== checkinDate) existing = null;
  }

  if (kind === 'confirmation') {
    if (existing) {
      await dbRun(
        `UPDATE airbnb_reservations SET
           status = 'confirmed', checkin_date = ?::date, checkout_date = ?::date,
           reservation_code = COALESCE(reservation_code, ?), source_email_ref = ?, updated_at = NOW()
         WHERE id = ?`,
        checkinDate, checkoutDate, reservationCode, logId, existing.id,
      );
      return { status: 'parsed', reason: 'updated_existing', reservationId: existing.id };
    }
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO airbnb_reservations
         (id, tenant_id, listing_id, platform, reservation_code, guest_name, checkin_date, checkout_date, source_email_ref)
       VALUES (?,?,?,?,?,?,?::date,?::date,?)`,
      id, listing.tenant_id, listing.id, platform, reservationCode, guestName, checkinDate, checkoutDate, logId,
    );
    return { status: 'parsed', reason: null, reservationId: id };
  }

  if (!existing) return { status: 'unmatched', reason: `no_${kind}_target`, reservationId: null };

  if (kind === 'cancellation') {
    await dbRun(
      "UPDATE airbnb_reservations SET status = 'cancelled', source_email_ref = ?, updated_at = NOW() WHERE id = ?",
      logId, existing.id,
    );
  } else {
    // change: only overwrite dates the email actually supplied
    await dbRun(
      `UPDATE airbnb_reservations SET
         checkin_date = COALESCE(?::date, checkin_date),
         checkout_date = COALESCE(?::date, checkout_date),
         source_email_ref = ?, updated_at = NOW()
       WHERE id = ?`,
      checkinDate, checkoutDate, logId, existing.id,
    );
  }
  return { status: 'parsed', reason: null, reservationId: existing.id };
}

export async function handleReservationEmail(opts: {
  recipient: string; from: string; subject: string; textBody: string; htmlBody?: string;
}): Promise<boolean> {
  const address = extractEmailAddress(opts.recipient);
  if (!address) return false;

  let listing: any;
  try {
    listing = await dbGet(
      `SELECT l.id, l.tenant_id, l.name FROM airbnb_listings l
       JOIN tenants t ON t.id = l.tenant_id
       WHERE l.confirmation_forward_email = ? AND t.deleted_at IS NULL`,
      address,
    );
  } catch {
    return false; // e.g. table missing in a non-Postgres dev DB — not ours
  }
  if (!listing) return false;

  const rawBody = opts.textBody?.trim() ? opts.textBody : htmlToText(opts.htmlBody || '');
  const body = normalizeEmailText(rawBody);
  const logId = crypto.randomUUID();

  try {
    await dbRun(
      `INSERT INTO airbnb_email_ingest_log (id, tenant_id, listing_id, status, from_address, subject, body_text)
       VALUES (?,?,?, 'received', ?,?,?)`,
      logId, listing.tenant_id, listing.id, opts.from, opts.subject, body.slice(0, MAX_BODY_CHARS),
    );

    const result = parseReservationEmail({
      from: opts.from, subject: opts.subject, body, listingName: listing.name,
    });
    if (!result.ok) {
      await setLog(logId, 'unparsed', result.reason, null);
      console.warn(`[Reservations] Unparsed email for listing ${listing.id}: ${result.reason}`);
      return true;
    }

    const outcome = await apply(result.data, listing, logId);
    await setLog(logId, outcome.status, outcome.reason, outcome.reservationId);
    console.log(`[Reservations] ${result.data.platform} ${result.data.kind} → ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ''} [listing ${listing.id}]`);
  } catch (e: any) {
    console.error('[Reservations] Ingest error:', e.message);
    alertError(e, 'handleReservationEmail', { listingId: listing.id });
    await setLog(logId, 'error', e.message?.slice(0, 200) ?? 'error', null).catch(() => {});
  }
  return true;
}
