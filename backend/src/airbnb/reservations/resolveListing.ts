// Picks which listing an email sent to a tenant's SHARED forwarding address is
// about, by finding the listing's name (or, failing that, its address) in the
// email text. Only the candidates passed in are considered — callers pass just
// the tenant's listings with use_shared_forward_email = true, so a listing
// that still uses its own dedicated address can never be matched here.
//
// Airbnb's own numeric listing id ("Listing #22483336"), when the email shows
// one and exactly one candidate has it saved, is the strongest match and is
// used first. Name/address matching is the fallback — not every listing has the
// number filled in, and not every email type shows it.
//
// Refuses (rather than guesses) when zero or several distinct listings match.

export interface ListingCandidate {
  id: string; name: string; address: string;
  airbnb_listing_number?: string | null;
}

export type ResolveResult =
  | { ok: true; listing: ListingCandidate }
  | { ok: false; reason: 'shared_no_listing_match' | 'shared_multiple_listings' };

// Unlike person-name normalisation this keeps digits: "Loft 2" and "Loft 3"
// must stay distinct.
export function normalizeLoose(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  return phrase.length > 0 && ` ${haystack} `.includes(` ${phrase} `);
}

// Of the matched names, drop any that is just a part of another matched name
// ("Loft" inside "Downtown Loft") — the longer one is the real match.
function reduceNested(matches: { c: ListingCandidate; key: string }[]) {
  return matches.filter(m =>
    !matches.some(o => o !== m && o.key !== m.key && containsPhrase(o.key, m.key)),
  );
}

export function resolveSharedListing(
  text: string,
  candidates: ListingCandidate[],
  airbnbListingNumber?: string | null,
): ResolveResult {
  if (airbnbListingNumber) {
    const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
    const wanted = digits(airbnbListingNumber);
    const byNumber = wanted ? candidates.filter(c => digits(c.airbnb_listing_number) === wanted) : [];
    // Exactly one: use it. Zero (not saved on any listing) or several
    // (duplicated by mistake): fall through to name matching.
    if (byNumber.length === 1) return { ok: true, listing: byNumber[0] };
  }

  const haystack = normalizeLoose(text);

  const pick = (keyOf: (c: ListingCandidate) => string, minLen: number): ResolveResult | null => {
    const matched = candidates
      .map(c => ({ c, key: keyOf(c) }))
      .filter(m => m.key.length >= minLen && containsPhrase(haystack, m.key));
    if (matched.length === 0) return null;
    const reduced = reduceNested(matched);
    return reduced.length === 1
      ? { ok: true, listing: reduced[0].c }
      : { ok: false, reason: 'shared_multiple_listings' };
  };

  return (
    pick(c => normalizeLoose(c.name), 3) ??
    pick(c => normalizeLoose(c.address), 8) ??
    { ok: false, reason: 'shared_no_listing_match' }
  );
}
