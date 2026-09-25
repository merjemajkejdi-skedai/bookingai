// Run: node --import tsx/esm src/airbnb/reservations/parseReservationEmail.test.ts
//
// NOTE: these emails are SYNTHETIC — built from a written description of three
// real forwarded Airbnb emails (booking confirmation, cancellation, guest
// message), not copied from them. They pin the parser's logic, not its
// accuracy against real mail. Replace/extend them with redacted real bodies.
import { parseReservationEmail } from './parseReservationEmail.js';
import { nameScore } from './nameMatch.js';
import { normalizeEmailText, htmlToText } from './emailText.js';

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { fails++; console.log('FAIL', label, '\n  got     ', a, '\n  expected', e); }
  else console.log('ok  ', label);
}
const P = (o: any) => parseReservationEmail({ from: 'host@gmail.com', ...o });
const N = normalizeEmailText;

const confirmation = (dateLine = 'Date: Mon, Aug 31, 2026 at 10:15 AM', extra = '2 adults') => N(`---------- Forwarded message ---------
From: Airbnb <automated@airbnb.com>
${dateLine}
Subject: Reservation confirmed - Andrew Venezia arrives Sep 14
To: host@gmail.com

Booker
Andrew Venezia
HabitApt Tirana Center
Check-in
Mon, Sep 14
1:00 PM
Checkout
Mon, Sep 21
11:00 AM
${extra}
Confirmation code
HM2XDDCBHQ`);

const CONF_SUBJECT = 'Fwd: Reservation confirmed - Andrew Venezia arrives Sep 14';

// ── Booking confirmation ────────────────────────────────────────────────────
check('confirmation', P({ subject: CONF_SUBJECT, body: confirmation() }), {
  status: 'parsed',
  data: { platform: 'airbnb', kind: 'confirmation', reservationCode: 'HM2XDDCBHQ', guestName: 'Andrew Venezia',
    guestCount: 2, checkinDate: '2026-09-14', checkoutDate: '2026-09-21', airbnbListingNumber: null },
});
check('guest count sums adults + children', (P({ subject: CONF_SUBJECT, body: confirmation(undefined, '2 adults, 1 child') }) as any).data.guestCount, 3);
check('guest count sums infants too', (P({ subject: CONF_SUBJECT, body: confirmation(undefined, '2 adults · 1 infant') }) as any).data.guestCount, 3);
check('no guest count -> null', (P({ subject: CONF_SUBJECT, body: confirmation(undefined, '') }) as any).data.guestCount, null);

// Year inference: anchored on the original send date, on-or-after.
check('same-day check-in stays this year', (P({ subject: CONF_SUBJECT, body: confirmation('Date: Mon, Sep 14, 2026 at 8:00 AM') }) as any).data.checkinDate, '2026-09-14');
check('check-in earlier than send date -> next year', (P({ subject: CONF_SUBJECT, body: confirmation('Date: Tue, Oct 6, 2026 at 8:00 AM') }) as any).data.checkinDate, '2027-09-14');
check('stay crossing new year', (P({
  subject: 'Fwd: Reservation confirmed - Jane Doe arrives Dec 30',
  body: N(`From: Airbnb <automated@airbnb.com>
Date: Mon, Dec 1, 2026 at 9:00 AM
Check-in
Wed, Dec 30
Checkout
Sat, Jan 2
1 adult
Confirmation code
HMABC12345`),
}) as any).data, {
  platform: 'airbnb', kind: 'confirmation', reservationCode: 'HMABC12345', guestName: 'Jane Doe', guestCount: 1,
  checkinDate: '2026-12-30', checkoutDate: '2027-01-02', airbnbListingNumber: null,
});

// Auto-forward: Airbnb is the top-level sender; the send date comes from the header.
const autoBody = N(`Check-in\nMon, Sep 14\nCheckout\nMon, Sep 21\n2 adults\nConfirmation code\nHM2XDDCBHQ`);
check('auto-forward uses top-level Date', (P({ from: 'Airbnb <automated@airbnb.com>', subject: 'Reservation confirmed - Andrew Venezia arrives Sep 14', body: autoBody, sentAt: new Date('2026-08-31T10:00:00Z') }) as any).data.checkinDate, '2026-09-14');
check('no send date anywhere -> refuse rather than guess a year', P({ from: 'Airbnb <automated@airbnb.com>', subject: 'Reservation confirmed - Andrew Venezia arrives Sep 14', body: autoBody }), { status: 'review', reason: 'missing_send_date' });

// Subject taken from the forwarded block when the host changed the top-level one.
check('subject from forwarded block', (P({ subject: 'booking for next month', body: confirmation() }) as any).status, 'parsed');

// Two-column layout flattened onto shared lines.
check('two-column layout fallback', (P({
  subject: CONF_SUBJECT,
  body: N(`From: Airbnb <automated@airbnb.com>\nDate: Mon, Aug 31, 2026 at 10:15 AM\nCheck-in Checkout\nMon, Sep 14 Mon, Sep 21\nConfirmation code HM2XDDCBHQ`),
}) as any).data, {
  platform: 'airbnb', kind: 'confirmation', reservationCode: 'HM2XDDCBHQ', guestName: 'Andrew Venezia', guestCount: null,
  checkinDate: '2026-09-14', checkoutDate: '2026-09-21', airbnbListingNumber: null,
});

check('confirmation without a code -> review', P({ subject: CONF_SUBJECT, body: confirmation().replace('HM2XDDCBHQ', '') }), { status: 'review', reason: 'missing_fields:confirmation_code' });
check('two codes -> review', P({ subject: CONF_SUBJECT, body: confirmation() + '\nConfirmation code\nHMZZZZ9999' }), { status: 'review', reason: 'multiple_codes' });
check('checkout before check-in -> review', P({
  subject: CONF_SUBJECT,
  body: N(`From: Airbnb <automated@airbnb.com>\nDate: Mon, Aug 31, 2026 at 10:15 AM\nCheck-in\nMon, Sep 21\nCheckout\nMon, Sep 14\nConfirmation code\nHM2XDDCBHQ`),
}) , { status: 'review', reason: 'bad_dates' });

// ── Cancellation ────────────────────────────────────────────────────────────
const cancelBody = N(`---------- Forwarded message ---------
From: Airbnb <automated@airbnb.com>
Date: Tue, Sep 8, 2026 at 3:00 PM
Subject: Canceled: Reservation HMWKFJHB29 for Sep 17 – Oct 5

Your guest Jorge had to cancel.
Recently re-designed apartment near city center
Listing #22483336
Sep 17 – Oct 5`);
check('cancellation', P({ subject: 'Fwd: Canceled: Reservation HMWKFJHB29 for Sep 17 – Oct 5', body: cancelBody }), {
  status: 'parsed',
  data: { platform: 'airbnb', kind: 'cancellation', reservationCode: 'HMWKFJHB29', guestName: null, guestCount: null,
    checkinDate: null, checkoutDate: null, airbnbListingNumber: '22483336' },
});
check('cancellation code disagrees with body -> review', P({ subject: 'Fwd: Canceled: Reservation HMWKFJHB29 for Sep 17 – Oct 5', body: cancelBody + '\nReservation HMOTHER123 details' }), { status: 'review', reason: 'code_mismatch' });
check('cancellation with malformed code -> review', P({ subject: 'Fwd: Canceled: Reservation 12345 for Sep 17 – Oct 5', body: cancelBody }), { status: 'review', reason: 'bad_code_shape' });

// ── Ignored / not parsed ────────────────────────────────────────────────────
const messageBody = N(`From: Airbnb <express@airbnb.com>\nSubject: RE: Reservation for HabitApt Tirana Center, Sep 14 – 21\n\nJorge: Hello!`);
check('guest message ignored', P({ subject: 'Fwd: RE: Reservation for HabitApt Tirana Center, Sep 14 – 21', body: messageBody }), { status: 'ignored', reason: 'guest_message' });
check('first message in a thread (no RE:) ignored', (P({ subject: 'Fwd: Reservation for HabitApt Tirana Center, Sep 14 – 21', body: messageBody }) as any).status, 'ignored');

check('reservation altered -> review, never guessed', P({
  subject: 'Fwd: Reservation altered - Andrew Venezia arrives Sep 15',
  body: N(`From: Airbnb <automated@airbnb.com>\nCheck-in\nTue, Sep 15\nConfirmation code\nHM2XDDCBHQ`),
}), { status: 'review', reason: 'unclassified' });
check('Booking.com -> review, manual entry', P({
  subject: 'Fwd: New Booking! (1234567890)',
  body: N(`From: Booking.com <noreply@booking.com>\nBooking number: 1234567890\nGuest name: John Smith`),
}), { status: 'review', reason: 'booking_not_supported' });
check('right subject but not from Airbnb -> review', P({ subject: CONF_SUBJECT, body: N('From: Somebody <someone@example.com>\nConfirmation code HM2XDDCBHQ') }), { status: 'review', reason: 'unclassified' });
check('guest-message subject from the confirmation sender is not trusted', (P({ subject: 'Fwd: RE: Reservation for X, Sep 14 – 21', body: N('From: Airbnb <automated@airbnb.com>\nhello') }) as any).status, 'review');

// ── helpers ─────────────────────────────────────────────────────────────────
check('html', htmlToText('<p>Guest:&nbsp;Jane&amp;Co</p><br>x').replace(/\s+/g, ' ').trim(), 'Guest: Jane&Co x');

check('exact', nameScore('Jane Doe', 'jane doe'), 100);
check('initial', nameScore('Jane D.', 'Jane Doe') >= 70, true);
check('order swap', nameScore('Doe Jane', 'Jane Doe') >= 70, true);
check('accent', nameScore('José García', 'Jose Garcia'), 100);
check('typo', nameScore('Jane Smithh', 'Jane Smith') >= 70, true);
check('first name only not confident', nameScore('Jane', 'Jane Doe') < 70, true);
check('different people', nameScore('Jane Doe', 'John Smith'), 0);
check('same first, diff last', nameScore('Jane Doe', 'Jane Roe') < 70, true);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
