// Parses host-facing AIRBNB reservation emails (forwarded by the host to a
// SkedAI address) into structured data. Airbnb only — Booking.com has no real
// samples yet, so it is deliberately not parsed (it goes to the review queue,
// where the host adds the reservation manually).
//
// Pure functions, no I/O. Emails are first CLASSIFIED by sender address +
// subject pattern into one of three known types:
//   - booking confirmation   (automated@airbnb.com, "Reservation confirmed - {Guest} arrives {date}")
//   - cancellation           (automated@airbnb.com, "Canceled: Reservation {CODE} for {range}")
//   - guest message          (express@airbnb.com,   "[RE: ]Reservation for {Listing}, {range}") — ignored
// Anything that doesn't confidently match one of those — including a
// "reservation changed" email, of which there is no real sample yet — is NOT
// parsed: it returns status 'review' so the caller queues the raw email for a
// human. A wrong reservation row (wrong date, wrong person) is worse than a
// missing one, since it can hand a door code to the wrong person.
//
// Written from descriptions of three real forwarded emails, not from their raw
// text — the label/line layout below is the part most likely to need tuning.
export type EmailKind = 'confirmation' | 'cancellation';

export interface ParsedReservation {
  platform: 'airbnb';
  kind: EmailKind;
  reservationCode: string;              // the primary key — required for both kinds
  guestName: string | null;             // full name (confirmation); null for cancellation
  guestCount: number | null;
  checkinDate: string | null;           // YYYY-MM-DD (confirmation only)
  checkoutDate: string | null;          // YYYY-MM-DD (confirmation only)
  airbnbListingNumber: string | null;   // "Listing #22483336", when the email shows it
}

export type ParseResult =
  | { status: 'parsed'; data: ParsedReservation }
  | { status: 'ignored'; reason: string }
  | { status: 'review'; reason: string };

export interface ParseInput {
  from: string;       // envelope/top-level From (the host, or Airbnb if auto-forwarded)
  subject: string;
  body: string;       // already normalised plain text
  sentAt?: Date | null; // top-level Date header, used only if the forwarded block has none
}

// ── Dates ───────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MON = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?';

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

interface DateHit { index: number; month: number; day: number; year: number | null }

// Every "Mon D[, YYYY]" / "D Mon[ YYYY]" in the text, in order. Year is null
// when the text doesn't state one.
function findDates(text: string): DateHit[] {
  const hits: DateHit[] = [];
  for (const m of text.matchAll(new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:,?\\s+(\\d{4}))?`, 'gi'))) {
    hits.push({ index: m.index!, month: MONTHS[m[1].toLowerCase()], day: +m[2], year: m[3] ? +m[3] : null });
  }
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}(?:,?\\s+(\\d{4}))?`, 'gi'))) {
    hits.push({ index: m.index!, month: MONTHS[m[2].toLowerCase()], day: +m[1], year: m[3] ? +m[3] : null });
  }
  return hits.sort((a, b) => a.index - b.index);
}

// Airbnb host emails state no year ("Mon, Sep 14"). Anchor on the email's own
// send date: the year that keeps the date on or after it.
function yearOnOrAfter(month: number, day: number, anchor: Date): number {
  const y = anchor.getUTCFullYear();
  const anchorDay = Date.UTC(y, anchor.getUTCMonth(), anchor.getUTCDate());
  return Date.UTC(y, month - 1, day) >= anchorDay ? y : y + 1;
}

// The original email's send date, from the forwarded block's "Date:"/"Sent:"
// line (must state a year), falling back to the top-level Date header. Null if
// neither is available — callers must then refuse year-less dates rather than
// guess a year.
export function originalSendDate(body: string, fallback?: Date | null): Date | null {
  const head = body.slice(0, 3000);
  for (const m of head.matchAll(/^\s*(?:Date|Sent)\s*:\s*(.+)$/gim)) {
    if (!/\b(?:19|20)\d{2}\b/.test(m[1])) continue;
    const hit = findDates(m[1]).find(h => h.year);
    if (hit) return new Date(Date.UTC(hit.year!, hit.month - 1, hit.day));
  }
  return fallback && !Number.isNaN(fallback.getTime()) ? fallback : null;
}

// ── Classification ──────────────────────────────────────────────────────────

const ADDRESS_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// Sender addresses to consider: the top-level From (Airbnb itself if the host
// auto-forwards) plus the From: lines of a manually forwarded block.
function senderAddresses(from: string, body: string): Set<string> {
  const out = new Set<string>();
  for (const a of from.match(ADDRESS_RE) ?? []) out.add(a.toLowerCase());
  for (const line of body.slice(0, 3000).matchAll(/^\s*From\s*:\s*(.+)$/gim)) {
    for (const a of line[1].match(ADDRESS_RE) ?? []) out.add(a.toLowerCase());
  }
  return out;
}

const FWD_PREFIX = /^\s*(?:(?:fwd?|fw)\s*:\s*)+/i;

// Top-level subject (forward prefix stripped), then the forwarded block's own
// "Subject:" line — either may carry the original.
function subjectCandidates(subject: string, body: string): string[] {
  const out = [subject.replace(FWD_PREFIX, '').trim()];
  const m = body.slice(0, 3000).match(/^\s*Subject\s*:\s*(.+)$/im);
  if (m) out.push(m[1].replace(FWD_PREFIX, '').trim());
  return out.filter(Boolean);
}

const RE_CONFIRMED = /^Reservation confirmed\s*[-–—]\s*(.+?)\s+arrives\s+(.+)$/i;
const RE_CANCELLED = /^Cancell?ed:\s*Reservation\s+(\w+)\s+for\s+(.+)$/i;
const RE_GUEST_MESSAGE = /^(?:RE:\s*)?Reservation for\s+.+,\s+.+$/i;

type Classified =
  | { type: 'confirmation'; guestName: string }
  | { type: 'cancellation'; code: string }
  | { type: 'guest_message' }
  | null;

function classify(addresses: Set<string>, subjects: string[]): Classified {
  for (const s of subjects) {
    if (addresses.has('automated@airbnb.com')) {
      const c = s.match(RE_CONFIRMED);
      if (c) return { type: 'confirmation', guestName: c[1].trim() };
      const x = s.match(RE_CANCELLED);
      if (x) return { type: 'cancellation', code: x[1] };
    }
    if (addresses.has('express@airbnb.com') && RE_GUEST_MESSAGE.test(s)) return { type: 'guest_message' };
  }
  return null;
}

// ── Field extraction ────────────────────────────────────────────────────────

const MAX_NEW_YEAR_CROSSING_NIGHTS = 180;

// Airbnb codes look like HM2XDDCBHQ / HMWKFJHB29.
const CODE_SHAPE = /^H[A-Z0-9]{9}$/;

function codesIn(text: string): string[] {
  const codes = new Set<string>();
  for (const m of text.matchAll(/[Cc]onfirmation [Cc]ode\W{0,6}(H[A-Z0-9]{9})\b/g)) codes.add(m[1]);
  return [...codes];
}

function cleanName(raw: string): string | null {
  const n = raw.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  return n.length >= 2 && n.length <= 60 && !/[\d@]/.test(n) ? n : null;
}

// "2 adults", "2 adults, 1 child", "2 adults · 1 infant" — sum every people
// category in the first cluster after the first "adult(s)" (pets excluded).
function guestCount(text: string): number | null {
  const first = text.search(/\d+\s+adults?\b/i);
  if (first < 0) return null;
  const window = text.slice(first, first + 160);
  let total = 0;
  for (const m of window.matchAll(/(\d+)\s+(adults?|children|child|infants?)\b/gi)) total += +m[1];
  return total >= 1 && total <= 100 ? total : null;
}

function valueAfterLabel(text: string, label: string): string {
  const m = text.match(new RegExp(`${label}\\W{0,4}([^\\n]{0,40}(?:\\n[^\\n]{0,40})?)`, 'i'));
  return m ? m[1] : '';
}

// ── Entry point ─────────────────────────────────────────────────────────────

export function parseReservationEmail(input: ParseInput): ParseResult {
  const addresses = senderAddresses(input.from, input.body);
  const cls = classify(addresses, subjectCandidates(input.subject, input.body));

  if (!cls) {
    // Say what we can about why, so the review queue is actionable.
    const fromBooking = [...addresses].some(a => a.endsWith('booking.com') || a.includes('.booking.com'));
    return { status: 'review', reason: fromBooking ? 'booking_not_supported' : 'unclassified' };
  }
  if (cls.type === 'guest_message') return { status: 'ignored', reason: 'guest_message' };

  const listingNumber = input.body.match(/Listing\s*#\s*(\d{5,})/i)?.[1] ?? null;

  // ── Cancellation: code from the subject, cross-checked against the body ────
  if (cls.type === 'cancellation') {
    if (!CODE_SHAPE.test(cls.code)) return { status: 'review', reason: 'bad_code_shape' };
    const bodyCodes = [...input.body.matchAll(/\bH[A-Z0-9]{9}\b/g)].map(m => m[0]);
    if (bodyCodes.some(c => c !== cls.code)) return { status: 'review', reason: 'code_mismatch' };
    return {
      status: 'parsed',
      data: {
        platform: 'airbnb', kind: 'cancellation', reservationCode: cls.code,
        guestName: null, guestCount: null, checkinDate: null, checkoutDate: null,
        airbnbListingNumber: listingNumber,
      },
    };
  }

  // ── Booking confirmation ───────────────────────────────────────────────────
  const codes = codesIn(input.body);
  if (codes.length === 0) return { status: 'review', reason: 'missing_fields:confirmation_code' };
  if (codes.length > 1) return { status: 'review', reason: 'multiple_codes' };

  const guestName = cleanName(cls.guestName);
  if (!guestName) return { status: 'review', reason: 'missing_fields:guest_name' };

  const sent = originalSendDate(input.body, input.sentAt);
  const inLabel = valueAfterLabel(input.body, 'check[\\s-]?in');
  const outLabel = valueAfterLabel(input.body, 'check[\\s-]?out');
  let a = findDates(inLabel)[0];
  let b = findDates(outLabel)[0];

  // Layout fallback: if the labelled values don't give a sensible stay (e.g. a
  // two-column layout flattened into one line), take the first two distinct
  // dates after the check-in label instead.
  const sameYear = !!a && !!b && (a.year ?? 0) === (b.year ?? 0);
  const checkoutNotAfterCheckin = sameYear && (b!.month < a!.month || (b!.month === a!.month && b!.day <= a!.day));
  if (!a || !b || checkoutNotAfterCheckin) {
    const idx = input.body.search(/check[\s-]?in/i);
    const dates = idx >= 0 ? findDates(input.body.slice(idx, idx + 300)) : [];
    const distinct = dates.filter((d, i) => i === 0 || d.month !== dates[0].month || d.day !== dates[0].day);
    if (distinct.length >= 2) { a = distinct[0]; b = distinct[1]; }
  }
  if (!a || !b) return { status: 'review', reason: `missing_fields:${!a ? 'checkin_date ' : ''}${!b ? 'checkout_date' : ''}`.trim() };

  // No year in these emails: anchor on the original send date, or refuse.
  if ((!a.year || !b.year) && !sent) return { status: 'review', reason: 'missing_send_date' };
  const y1 = a.year ?? yearOnOrAfter(a.month, a.day, sent!);
  const checkinDate = iso(y1, a.month, a.day);
  // Checkout is on/after check-in: same year unless the stay crosses New Year.
  // Only infer that crossing when it gives a plausibly SHORT stay — a
  // year-less check-out that is simply earlier than check-in (garbled email,
  // swapped labels) would otherwise become a ~360-night stay and sail through.
  let y2 = b.year ?? y1;
  let crossedNewYear = false;
  if (!b.year && iso(y2, b.month, b.day)! < (checkinDate ?? '')) { y2 += 1; crossedNewYear = true; }
  const checkoutDate = iso(y2, b.month, b.day);

  // Sanity: a real, forward-running stay of sensible length.
  if (!checkinDate || !checkoutDate || checkoutDate <= checkinDate) return { status: 'review', reason: 'bad_dates' };
  const nights = (Date.parse(checkoutDate) - Date.parse(checkinDate)) / 86400000;
  if (nights > 365 || (crossedNewYear && nights > MAX_NEW_YEAR_CROSSING_NIGHTS)) return { status: 'review', reason: 'bad_dates' };

  return {
    status: 'parsed',
    data: {
      platform: 'airbnb', kind: 'confirmation', reservationCode: codes[0],
      guestName, guestCount: guestCount(input.body),
      checkinDate, checkoutDate, airbnbListingNumber: listingNumber,
    },
  };
}
