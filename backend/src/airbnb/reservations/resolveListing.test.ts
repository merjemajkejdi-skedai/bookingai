// Run: node --import tsx/esm src/airbnb/reservations/resolveListing.test.ts
import { resolveSharedListing } from './resolveListing.js';

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { fails++; console.log('FAIL', label, '\n  got     ', a, '\n  expected', e); }
  else console.log('ok  ', label);
}
const id = (r: ReturnType<typeof resolveSharedListing>) => (r.ok ? r.listing.id : r.reason);

const loft = { id: 'loft', name: 'Downtown Loft', address: '12 Rruga e Durresit, Tirana' };
const studio = { id: 'studio', name: 'Sea View Studio', address: '4 Coastal Road, Vlore' };

check('single name match', id(resolveSharedListing('Reservation for Downtown Loft on Oct 3', [loft, studio])), 'loft');
check('case/punctuation insensitive', id(resolveSharedListing('DOWNTOWN-LOFT!', [loft, studio])), 'loft');
check('no match', id(resolveSharedListing('Reservation for Mountain Cabin', [loft, studio])), 'shared_no_listing_match');
check('no candidates', id(resolveSharedListing('Downtown Loft', [])), 'shared_no_listing_match');

// A listing that isn't passed in (i.e. one using its own dedicated address)
// can never be matched, even when its name is right there in the email.
check('non-shared listing never matched', id(resolveSharedListing('Sea View Studio', [loft])), 'shared_no_listing_match');

check('digits keep names distinct', id(resolveSharedListing('Loft 3 booking', [
  { id: 'l2', name: 'Loft 2', address: 'x' }, { id: 'l3', name: 'Loft 3', address: 'y' },
])), 'l3');
check('nested name prefers the longer', id(resolveSharedListing('Downtown Loft', [
  { id: 'short', name: 'Loft', address: 'a' }, loft,
])), 'loft');
check('two distinct listings in one email refuses', id(resolveSharedListing('Downtown Loft and Sea View Studio', [loft, studio])), 'shared_multiple_listings');
check('identical names refuse', id(resolveSharedListing('Downtown Loft', [loft, { ...loft, id: 'dup' }])), 'shared_multiple_listings');
check('address fallback', id(resolveSharedListing('Guest arriving at 12 Rruga e Durresit Tirana', [loft, studio])), 'loft');
check('word boundary (no partial word match)', id(resolveSharedListing('Loftus Road', [{ id: 'l', name: 'Loft', address: 'a' }])), 'shared_no_listing_match');

// ── Airbnb listing number: preferred when it identifies exactly one listing ──
const numbered = [
  { id: 'a', name: 'Downtown Loft', address: 'x', airbnb_listing_number: '22483336' },
  { id: 'b', name: 'Sea View Studio', address: 'y', airbnb_listing_number: '11111111' },
];
check('number beats a conflicting name', id(resolveSharedListing('Sea View Studio', numbered, '22483336')), 'a');
check('number with # and spaces still matches', id(resolveSharedListing('nothing useful', numbered, ' #22483336 ')), 'a');
check('unknown number falls back to name', id(resolveSharedListing('Sea View Studio', numbered, '99999999')), 'b');
check('no number given -> name matching as before', id(resolveSharedListing('Downtown Loft', numbered)), 'a');
check('number saved on neither listing and no name -> no match', id(resolveSharedListing('nothing useful', [
  { id: 'a', name: 'Downtown Loft', address: 'x' }, { id: 'b', name: 'Sea View Studio', address: 'y' },
], '22483336')), 'shared_no_listing_match');
check('duplicated number is not trusted, falls back to name', id(resolveSharedListing('Sea View Studio', [
  { id: 'a', name: 'Downtown Loft', address: 'x', airbnb_listing_number: '22483336' },
  { id: 'b', name: 'Sea View Studio', address: 'y', airbnb_listing_number: '22483336' },
], '22483336')), 'b');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
