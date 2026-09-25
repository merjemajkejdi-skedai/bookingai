// Run: node --import tsx/esm src/airbnb/reservations/parseReservationEmail.test.ts
//
// NOTE: these emails are SYNTHETIC — written from the platforms' known
// host-notification layouts, not copied from real forwarded emails. They pin
// the parser's logic, not its accuracy against production mail. Add real
// (redacted) samples here as they arrive; a failure in the review queue is
// the cue to add one.
import { parseReservationEmail } from './parseReservationEmail.js';
import { nameScore } from './nameMatch.js';
import { normalizeEmailText, htmlToText } from './emailText.js';

const now = new Date('2026-09-25T10:00:00Z');
let fails = 0;
function check(label: string, actual: any, expected: any) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { fails++; console.log('FAIL', label, '\n  got     ', a, '\n  expected', e); }
  else console.log('ok  ', label);
}
const P = (o: any) => parseReservationEmail({ from: 'host@gmail.com', listingName: 'Downtown Loft', now, ...o });

// Airbnb confirmation
check('airbnb confirm', P({
  subject: 'Fwd: Reservation confirmed - Jane Doe arrives Oct 3',
  body: normalizeEmailText(`---------- Forwarded message ---------
From: Airbnb <automated@airbnb.com>
Confirmation code
HMABC12345
Check-in
Sat, Oct 3
Checkout
Mon, Oct 5`),
}), { ok: true, data: { platform: 'airbnb', kind: 'confirmation', reservationCode: 'HMABC12345', guestName: 'Jane Doe', checkinDate: '2026-10-03', checkoutDate: '2026-10-05' } });

// Airbnb cancellation (code + range in subject, no name)
check('airbnb cancel', P({
  subject: 'Fwd: Canceled: Reservation HMABC12345 for Oct 3 – 5, 2026',
  body: normalizeEmailText(`From: Airbnb <automated@airbnb.com>\nThe guest canceled this reservation.`),
}), { ok: true, data: { platform: 'airbnb', kind: 'cancellation', reservationCode: 'HMABC12345', guestName: null, checkinDate: '2026-10-03', checkoutDate: '2026-10-05' } });

// Booking.com confirmation
check('booking confirm', P({
  subject: 'New Booking! (1234567890)',
  body: normalizeEmailText(`From: Booking.com <noreply@booking.com>
Booking number: 1234567890
Guest name: John Smith (Genius level 1)
Check-in: Friday 9 October 2026
Check-out: Sunday 11 October 2026`),
}), { ok: true, data: { platform: 'booking', kind: 'confirmation', reservationCode: '1234567890', guestName: 'John Smith', checkinDate: '2026-10-09', checkoutDate: '2026-10-11' } });

// Booking.com change with old/new
check('booking change', P({
  subject: 'Guest changed booking 1234567890',
  body: normalizeEmailText(`From: Booking.com <noreply@booking.com>
Booking number: 1234567890
Guest name: John Smith
Previous dates: Check-in: 9 October 2026 Check-out: 11 October 2026
New dates:
Check-in: 10 October 2026
Check-out: 12 October 2026`),
}), { ok: true, data: { platform: 'booking', kind: 'change', reservationCode: '1234567890', guestName: 'John Smith', checkinDate: '2026-10-10', checkoutDate: '2026-10-12' } });

// Missing name/date -> refuse
check('refuses when unparseable', P({ subject: 'Reservation confirmed', body: 'From: Airbnb <a@airbnb.com>\nsomething odd' }), { ok: false, reason: 'missing_fields:guest_name checkin_date' });
check('unknown platform', P({ subject: 'hello', body: 'lunch?' }), { ok: false, reason: 'unknown_platform' });

// Digest with two bookings, only one for this listing
check('digest isolates listing', P({
  subject: 'Reservation confirmed',
  body: normalizeEmailText(`From: Airbnb <automated@airbnb.com>
Confirmation code HMAAAA1111
Sea View Studio
Guest: Alice Brown
Check-in: Oct 1, 2026
Confirmation code HMBBBB2222
Downtown Loft
Guest: Bob Green
Check-in: Oct 7, 2026`),
}), { ok: true, data: { platform: 'airbnb', kind: 'confirmation', reservationCode: 'HMBBBB2222', guestName: 'Bob Green', checkinDate: '2026-10-07', checkoutDate: null } });
check('digest ambiguous refuses', P({
  listingName: 'Nowhere Place',
  subject: 'Reservation confirmed',
  body: 'From: Airbnb <a@airbnb.com>\nConfirmation code HMAAAA1111 Guest: A B\nConfirmation code HMBBBB2222 Guest: C D',
}), { ok: false, reason: 'multiple_bookings_ambiguous' });

// Year rollover
check('year rollover', P({
  now: new Date('2026-12-20T10:00:00Z'),
  subject: 'Reservation confirmed - Jane Doe arrives Jan 4',
  body: 'From: Airbnb <a@airbnb.com>\nConfirmation code HMABC12345\nCheck-in Jan 4\nCheckout Jan 6',
}), { ok: true, data: { platform: 'airbnb', kind: 'confirmation', reservationCode: 'HMABC12345', guestName: 'Jane Doe', checkinDate: '2027-01-04', checkoutDate: '2027-01-06' } });

// ambiguous numeric date is never guessed
check('ambiguous 03/04/2026 refused', P({
  subject: 'Reservation confirmed - Jane Doe arrives soon',
  body: 'From: Airbnb <a@airbnb.com>\nCheck-in 03/04/2026',
}), { ok: false, reason: 'missing_fields:checkin_date' });

// html
check('html', htmlToText('<p>Guest:&nbsp;Jane&amp;Co</p><br>x').replace(/\s+/g, ' ').trim(), 'Guest: Jane&Co x');

// names
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
