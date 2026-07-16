// ---------------------------------------------------------------------------
// emailParser.ts — Parse inbound review notification emails from Booking.com,
// TripAdvisor, and Google into a normalised ParsedReview structure.
// ---------------------------------------------------------------------------

export interface ParsedReview {
  source:         'booking' | 'tripadvisor' | 'google' | 'unknown';
  reviewer_name:  string | null;
  score:          number | null;
  score_max:      number;
  positive_text:  string | null;
  negative_text:  string | null;
  full_text:      string | null;
  review_date:    Date | null;
  language:       string;
}

// ---------------------------------------------------------------------------
// detectSource
// ---------------------------------------------------------------------------
export function detectSource(from: string, subject: string): ParsedReview['source'] {
  const haystack = (from + ' ' + subject).toLowerCase();
  if (haystack.includes('booking.com')) return 'booking';
  if (haystack.includes('tripadvisor')) return 'tripadvisor';
  if (haystack.includes('google')) return 'google';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// parseBookingEmail
// ---------------------------------------------------------------------------
export function parseBookingEmail(body: string): Partial<ParsedReview> {
  const result: Partial<ParsedReview> = { source: 'booking', score_max: 10 };

  // Score: e.g. "8.5 / 10" or "9/10"
  const scoreMatch = body.match(/(\d+(?:\.\d+)?)\s*\/\s*10/i);
  if (scoreMatch) result.score = parseFloat(scoreMatch[1]);

  // Reviewer name: "Guest: John" or "From: Jane"
  const nameMatch = body.match(/(Guest|From)[:\s]+([^\n]+)/i);
  if (nameMatch) result.reviewer_name = nameMatch[2].trim() || null;

  // Positive text block
  const posMatch = body.match(
    /(What.*liked|Positive|Liked)[:\s]*\n?([\s\S]*?)(?:\n\n|Negative|$)/i,
  );
  if (posMatch) {
    const text = posMatch[2].trim();
    result.positive_text = text || null;
  }

  // Negative text block
  const negMatch = body.match(
    /(What they didn.t|Negative|Disliked)[:\s]*\n?([\s\S]*?)(?:\n\n|$)/i,
  );
  if (negMatch) {
    const text = negMatch[2].trim();
    result.negative_text = text || null;
  }

  return result;
}

// ---------------------------------------------------------------------------
// parseTripAdvisorEmail
// ---------------------------------------------------------------------------
export function parseTripAdvisorEmail(body: string): Partial<ParsedReview> {
  const result: Partial<ParsedReview> = { source: 'tripadvisor', score_max: 10 };

  // Score: "4 out of 5" or "3/5" — multiply by 2 to get /10
  const scoreMatch = body.match(/(\d)\s*(?:out of\s*)?5/i);
  if (scoreMatch) result.score = parseInt(scoreMatch[1], 10) * 2;

  // Reviewer name
  const nameMatch = body.match(/(Reviewer|From|By|Guest)[:\s]+([^\n]+)/i);
  if (nameMatch) result.reviewer_name = nameMatch[2].trim() || null;

  // Full text — TripAdvisor emails typically contain the review body inline
  const bodyMatch = body.match(/(?:Review:|wrote:?\s*\n)([\s\S]+?)(?:\n\n|$)/i);
  if (bodyMatch) result.full_text = bodyMatch[1].trim() || null;

  return result;
}

// ---------------------------------------------------------------------------
// parseGoogleEmail
// ---------------------------------------------------------------------------
export function parseGoogleEmail(body: string): Partial<ParsedReview> {
  const result: Partial<ParsedReview> = { source: 'google', score_max: 10 };

  // Score: "4 out of 5 stars" or "3 stars" — multiply by 2 to get /10
  const scoreMatch = body.match(/(\d)\s*(?:out of\s*)?5\s*stars?/i);
  if (scoreMatch) result.score = parseInt(scoreMatch[1], 10) * 2;

  // Reviewer name
  const nameMatch = body.match(/(Reviewer|From|By|Guest)[:\s]+([^\n]+)/i);
  if (nameMatch) result.reviewer_name = nameMatch[2].trim() || null;

  // Full text — Google review emails usually have the review text inline
  const bodyMatch = body.match(/(?:Review:|wrote:?\s*\n|Left a review:\s*\n?)([\s\S]+?)(?:\n\n|$)/i);
  if (bodyMatch) result.full_text = bodyMatch[1].trim() || null;

  return result;
}

// ---------------------------------------------------------------------------
// parseReviewEmail — main entry point
// ---------------------------------------------------------------------------
export function parseReviewEmail(from: string, subject: string, body: string): ParsedReview {
  const source = detectSource(from, subject);

  const defaults: ParsedReview = {
    source,
    reviewer_name:  null,
    score:          null,
    score_max:      10,
    positive_text:  null,
    negative_text:  null,
    full_text:      null,
    review_date:    new Date(),
    language:       'en',
  };

  let parsed: Partial<ParsedReview>;
  if (source === 'booking') {
    parsed = parseBookingEmail(body);
  } else if (source === 'tripadvisor') {
    parsed = parseTripAdvisorEmail(body);
  } else if (source === 'google') {
    parsed = parseGoogleEmail(body);
  } else {
    // Unknown source — try to extract at least a score and full text
    parsed = {};
    const scoreMatch = body.match(/(\d+(?:\.\d+)?)\s*\/\s*10/i);
    if (scoreMatch) parsed.score = parseFloat(scoreMatch[1]);
    parsed.full_text = body.slice(0, 2000) || null;
  }

  return { ...defaults, ...parsed };
}
