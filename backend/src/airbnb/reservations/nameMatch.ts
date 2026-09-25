// Fuzzy guest-name matching. Exact-string matching against a self-reported
// name is too brittle (case, accents, "Jane D." vs "Jane Doe", word order,
// small typos) — but a match here can unlock a door code, so anything short
// of a confident match must score below MATCH_THRESHOLD and be treated as
// "no match" by callers, never guessed.

export const MATCH_THRESHOLD = 70;

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

// Does a token from the shorter name match some token of the longer one —
// exactly, or as an initial ("d" ~ "doe")?
function tokenMatches(t: string, others: string[]): boolean {
  return others.some(o => o === t || (t.length === 1 && o.startsWith(t)) || (o.length === 1 && t.startsWith(o)));
}

/** 0-100. >= MATCH_THRESHOLD is a confident match; below is not. */
export function nameScore(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;

  const ta = na.split(' ');
  const tb = nb.split(' ');
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];

  // All tokens of the shorter name found in the longer, in any order.
  if (small.length >= 2 && small.every(t => tokenMatches(t, big))) return 85;

  // Typo tolerance, per token and only on longer tokens: a 1-edit difference
  // on a short surname ("doe" vs "roe") is a different person, not a typo.
  if (small.length >= 2 && ta.length === tb.length) {
    const ok = small.every(t => big.some(o => o === t || (t.length >= 5 && o.length >= 5 && levenshtein(t, o) <= 1)));
    if (ok) return 75;
  }

  // First-name-only: never confident on its own.
  if (small.length === 1 && big.includes(small[0])) return 50;

  return 0;
}
