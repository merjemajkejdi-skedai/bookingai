// Parses host-facing Airbnb / Booking.com reservation emails (forwarded by the
// host to a per-listing address) into structured data.
//
// Pure functions, no I/O. This is deliberately conservative: if the fields a
// row needs can't be extracted with confidence, parseReservationEmail returns
// { ok: false, reason } so the caller logs it for manual review — a wrong
// reservation row (wrong date, wrong name) is worse than a missing one, since
// it can hand a door code to the wrong person or withhold it from the right one.
//
// Formats are matched in English only, and are based on the platforms' known
// host-notification layouts — they have NOT been validated against real
// forwarded samples yet. Expect to tune the patterns once real emails flow in;
// every failure is logged with its reason and raw text to make that fast.
import { normalizeName } from './nameMatch.js';

export type EmailKind = 'confirmation' | 'cancellation' | 'change';
export type Platform = 'airbnb' | 'booking';

export interface ParsedReservation {
  platform: Platform;
  kind: EmailKind;
  reservationCode: string | null;
  guestName: string | null;
  checkinDate: string | null;  // YYYY-MM-DD
  checkoutDate: string | null; // YYYY-MM-DD
}

export type ParseResult =
  | { ok: true; data: ParsedReservation }
  | { ok: false; reason: string };

export interface ParseInput {
  from: string;
  subject: string;
  body: string;        // already normalised plain text
  listingName: string;
  now?: Date;          // reference date for year inference; defaults to today
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

// A date with no year ("Fri, Mar 3") belongs to the next occurrence of that
// month/day — but allow a small look-back so an email about a booking that
// started last week isn't pushed a year forward.
function inferYear(m: number, d: number, now: Date): number {
  const y = now.getUTCFullYear();
  const candidate = Date.UTC(y, m - 1, d);
  return candidate < now.getTime() - 45 * 86400000 ? y + 1 : y;
}

/** First unambiguous date found in `text`, or null. Never guesses dd/mm vs mm/dd. */
export function extractFirstDate(text: string, now: Date): string | null {
  type Hit = { index: number; value: string | null };
  const hits: Hit[] = [];

  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    hits.push({ index: m.index!, value: iso(+m[1], +m[2], +m[3]) });
  }
  // "Mar 3, 2026" / "Mar 3" / "March 3rd"
  for (const m of text.matchAll(new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:,?\\s+(\\d{4}))?`, 'gi'))) {
    const mo = MONTHS[m[1].toLowerCase()]; const d = +m[2];
    hits.push({ index: m.index!, value: iso(m[3] ? +m[3] : inferYear(mo, d, now), mo, d) });
  }
  // "3 Mar 2026" / "3rd March"
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}(?:,?\\s+(\\d{4}))?`, 'gi'))) {
    const d = +m[1]; const mo = MONTHS[m[2].toLowerCase()];
    hits.push({ index: m.index!, value: iso(m[3] ? +m[3] : inferYear(mo, d, now), mo, d) });
  }
  // Numeric d/m/y — only when one side is > 12 so it's unambiguous.
  for (const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g)) {
    const a = +m[1]; const b = +m[2]; const y = +m[3];
    if (a > 12 && b <= 12) hits.push({ index: m.index!, value: iso(y, b, a) });
    else if (b > 12 && a <= 12) hits.push({ index: m.index!, value: iso(y, a, b) });
  }

  const valid = hits.filter(h => h.value).sort((x, y) => x.index - y.index);
  return valid[0]?.value ?? null;
}

// Value following a label, allowing the value to sit on the next line
// ("Check-in\nFri, Mar 3").
function dateAfterLabel(text: string, labelSource: string, now: Date): string | null {
  const re = new RegExp(`(?:${labelSource})\\W{0,6}([^\\n]{0,50}(?:\\n[^\\n]{0,50})?)`, 'gi');
  for (const m of text.matchAll(re)) {
    const d = extractFirstDate(m[1], now);
    if (d) return d;
  }
  return null;
}

// "Mar 3 – 5, 2026" / "Mar 30 – Apr 2, 2026" (Airbnb cancellation subjects).
function dateRange(text: string, now: Date): { checkin: string; checkout: string } | null {
  const re = new RegExp(`\\b${MON}\\s+(\\d{1,2})\\s*[–—-]\\s*(?:${MON}\\s+)?(\\d{1,2})(?:,?\\s+(\\d{4}))?`, 'i');
  const m = text.match(re);
  if (!m) return null;
  const m1 = MONTHS[m[1].toLowerCase()];
  const d1 = +m[2];
  const m2 = m[3] ? MONTHS[m[3].toLowerCase()] : m1;
  const d2 = +m[4];
  const y1 = m[5] ? +m[5] : inferYear(m1, d1, now);
  const y2 = m2 < m1 ? y1 + 1 : y1;
  const a = iso(y1, m1, d1); const b = iso(y2, m2, d2);
  return a && b ? { checkin: a, checkout: b } : null;
}

// ── Platform / kind ─────────────────────────────────────────────────────────

function detectPlatform(from: string, subject: string, body: string): Platform | null {
  const all = `${from}\n${subject}\n${body}`.toLowerCase();
  const airbnb = (all.match(/airbnb/g) || []).length;
  const booking = (all.match(/booking\.com|booking number|genius/g) || []).length;
  if (!airbnb && !booking) return null;
  // The forwarded original's sender line is the strongest signal.
  const fwdAirbnb = /from:[^\n]*@(?:[a-z0-9.-]*\.)?airbnb\./i.test(body);
  const fwdBooking = /from:[^\n]*@(?:[a-z0-9.-]*\.)?booking\.com/i.test(body);
  if (fwdAirbnb && !fwdBooking) return 'airbnb';
  if (fwdBooking && !fwdAirbnb) return 'booking';
  return airbnb >= booking ? 'airbnb' : 'booking';
}

const RE_CANCEL = /cancel+ed|cancellation|has been cancel/i;
const RE_CHANGE = /alteration|altered|changed|change request|modified|has been updated|reservation update|booking update|dates? (?:have )?changed/i;
const RE_CONFIRM = /confirmed|new booking|new reservation|booking confirmation|instant book/i;

function detectKind(subject: string, body: string): EmailKind | null {
  const head = body.slice(0, 800);
  for (const text of [subject, head]) {
    if (RE_CANCEL.test(text)) return 'cancellation';
    if (RE_CHANGE.test(text)) return 'change';
    if (RE_CONFIRM.test(text)) return 'confirmation';
  }
  return null;
}

// ── Code / name ─────────────────────────────────────────────────────────────

const AIRBNB_CODE = /\b(H[A-Z0-9]{9})\b/g;
const BOOKING_CODE = /(?:booking|reservation|confirmation)\s*(?:number|no\.?|id|#)\s*[:#]?\s*(\d{8,12})/gi;

function allCodes(text: string, platform: Platform): string[] {
  const codes = new Set<string>();
  if (platform === 'airbnb') {
    for (const m of text.matchAll(/(?:confirmation|reservation)\s*code\W{0,4}([A-Z0-9]{8,12})\b/gi)) codes.add(m[1].toUpperCase());
    for (const m of text.matchAll(AIRBNB_CODE)) codes.add(m[1]);
  } else {
    for (const m of text.matchAll(BOOKING_CODE)) codes.add(m[1]);
    for (const m of text.matchAll(/\((\d{8,12})\)/g)) codes.add(m[1]);
  }
  return [...codes];
}

function cleanName(raw: string): string | null {
  const n = raw
    .replace(/\(.*?\)/g, '')           // "(Genius level 2)"
    .replace(/[|•·].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (n.length < 2 || n.length > 60 || /[\d@]/.test(n)) return null;
  return n;
}

function extractGuestName(subject: string, body: string): string | null {
  const fromSubject =
    subject.match(/(?:reservation\s+)?confirmed\s*[-–—:]\s*(.+?)\s+arrives\b/i) ||
    subject.match(/new (?:booking|reservation)[^-–—:]*[-–—:]\s*(.+?)(?:\s+arrives|\s*$)/i);
  if (fromSubject) {
    const n = cleanName(fromSubject[1]);
    if (n) return n;
  }
  const fromBody =
    body.match(/^\s*guest(?:\s+name)?\s*[:\-]\s*([^\n]+)$/im) ||
    body.match(/^\s*(?:booker|name)\s*[:\-]\s*([^\n]+)$/im) ||
    body.match(/^\s*([^\n]{2,60}?)\s+(?:is\s+)?arriv(?:es|ing)\b/im);
  return fromBody ? cleanName(fromBody[1]) : null;
}

// Digest-style emails can hold several bookings/properties. If the body has
// more than one distinct code, keep only the block that mentions this
// listing's name; if that can't be determined, refuse rather than guess.
function isolateListingBlock(
  text: string, platform: Platform, listingName: string,
): { text: string } | { error: string } {
  const codes = allCodes(text, platform);
  if (codes.length <= 1) return { text };

  const positions = codes
    .map(c => text.indexOf(c))
    .filter(p => p >= 0)
    .sort((a, b) => a - b);
  const needle = normalizeName(listingName);
  const segments = positions.map((p, i) => text.slice(p, positions[i + 1] ?? text.length));
  const matching = segments.filter(s => normalizeName(s).includes(needle));
  if (matching.length === 1) return { text: matching[0] };
  return { error: 'multiple_bookings_ambiguous' };
}

// ── Entry point ─────────────────────────────────────────────────────────────

export function parseReservationEmail(input: ParseInput): ParseResult {
  const now = input.now ?? new Date();
  const platform = detectPlatform(input.from, input.subject, input.body);
  if (!platform) return { ok: false, reason: 'unknown_platform' };

  const kind = detectKind(input.subject, input.body);
  if (!kind) return { ok: false, reason: 'unknown_email_type' };

  const isolated = isolateListingBlock(`${input.subject}\n${input.body}`, platform, input.listingName);
  if ('error' in isolated) return { ok: false, reason: isolated.error };
  const text = isolated.text;

  const codes = allCodes(text, platform);
  const reservationCode = codes[0] ?? null;
  const guestName = extractGuestName(input.subject, text);

  // Change emails often show old and new dates side by side; prefer what
  // follows a "new/updated" marker, falling back to the whole text.
  let dateText = text;
  if (kind === 'change') {
    const marker = [...text.matchAll(/new (?:reservation )?dates?|updated (?:reservation )?(?:details|dates)|new check-?in|changed to/gi)].pop();
    if (marker?.index !== undefined) dateText = text.slice(marker.index);
  }

  let checkinDate = dateAfterLabel(dateText, 'check[\\s-]?in|arrival|arrives', now);
  let checkoutDate = dateAfterLabel(dateText, 'check[\\s-]?out|departure|departs', now);
  if (!checkinDate) {
    const range = dateRange(dateText, now) ?? (dateText !== text ? dateRange(text, now) : null);
    if (range) { checkinDate = range.checkin; checkoutDate = checkoutDate ?? range.checkout; }
  }
  if (!checkinDate && kind !== 'cancellation') {
    checkinDate = extractFirstDate(dateText, now);
  }
  if (checkinDate && checkoutDate && checkoutDate < checkinDate) {
    // year-inference artefact (e.g. check-in Dec 30, check-out Jan 2)
    const y = +checkoutDate.slice(0, 4);
    checkoutDate = `${y + 1}${checkoutDate.slice(4)}`;
  }

  const data: ParsedReservation = { platform, kind, reservationCode, guestName, checkinDate, checkoutDate };

  if (kind === 'confirmation' && !(guestName && checkinDate)) {
    return { ok: false, reason: `missing_fields:${!guestName ? 'guest_name ' : ''}${!checkinDate ? 'checkin_date' : ''}`.trim() };
  }
  if (kind !== 'confirmation' && !(reservationCode || (guestName && checkinDate))) {
    return { ok: false, reason: 'missing_identifiers' };
  }
  return { ok: true, data };
}
