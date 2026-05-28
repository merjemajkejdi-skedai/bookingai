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

export function detectSource(from: string, subject: string): ParsedReview['source'] {
  const f = (from + subject).toLowerCase();
  if (f.includes('booking.com'))  return 'booking';
  if (f.includes('tripadvisor'))  return 'tripadvisor';
  if (f.includes('google'))       return 'google';
  return 'unknown';
}

export function parseBookingEmail(body: string): Partial<ParsedReview> {
  const scoreMatch = body.match(/(\d+(?:\.\d+)?)\s*\/\s*10/i)
    || body.match(/Score[:\s]+(\d+(?:\.\d+)?)/i)
    || body.match(/Rating[:\s]+(\d+(?:\.\d+)?)/i);

  const reviewerMatch = body.match(/(?:Guest|Reviewer|From)[:\s]+([^\n]+)/i)
    || body.match(/([A-Z][a-z]+(?:\s+[A-Z]\.?)?)\s+(?:left|wrote|reviewed)/i);

  const positiveMatch = body.match(
    /(?:What (?:they|guests?) liked|Positive|Liked|Pros)[:\s]*\n?([\s\S]*?)(?:\n\n|What they didn|Negative|Disliked|Cons|$)/i,
  );
  const negativeMatch = body.match(
    /(?:What they didn.t like|Negative|Disliked|Cons|Could be improved)[:\s]*\n?([\s\S]*?)(?:\n\n|$)/i,
  );

  return {
    source:         'booking',
    score:          scoreMatch    ? parseFloat(scoreMatch[1])  : null,
    score_max:      10,
    reviewer_name:  reviewerMatch ? reviewerMatch[1].trim()    : null,
    positive_text:  positiveMatch ? positiveMatch[1].trim()    : null,
    negative_text:  negativeMatch ? negativeMatch[1].trim()    : null,
    full_text:      body.slice(0, 2000),
    review_date:    new Date(),
    language:       'en',
  };
}

export function parseTripAdvisorEmail(body: string): Partial<ParsedReview> {
  const scoreMatch = body.match(/(\d)\s*(?:out of\s*)?5\s*(?:stars?|bubbles?)/i)
    || body.match(/Rating[:\s]+(\d)/i);

  const reviewerMatch = body.match(/(?:From|Reviewer|Guest)[:\s]+([^\n]+)/i);

  return {
    source:        'tripadvisor',
    score:         scoreMatch    ? parseFloat(scoreMatch[1]) * 2 : null,
    score_max:     10,
    reviewer_name: reviewerMatch ? reviewerMatch[1].trim()       : null,
    positive_text: null,
    negative_text: null,
    full_text:     body.slice(0, 2000),
    review_date:   new Date(),
    language:      'en',
  };
}

export function parseGoogleEmail(body: string): Partial<ParsedReview> {
  const scoreMatch = body.match(/(\d)\s*(?:out of\s*)?5\s*stars?/i)
    || body.match(/(\d)\s*\/\s*5/i);

  const reviewerMatch = body.match(/(?:From|Reviewer)[:\s]+([^\n]+)/i);

  return {
    source:        'google',
    score:         scoreMatch    ? parseFloat(scoreMatch[1]) * 2 : null,
    score_max:     10,
    reviewer_name: reviewerMatch ? reviewerMatch[1].trim()       : null,
    positive_text: null,
    negative_text: null,
    full_text:     body.slice(0, 2000),
    review_date:   new Date(),
    language:      'en',
  };
}

export function parseReviewEmail(from: string, subject: string, body: string): ParsedReview {
  const source = detectSource(from, subject);

  let parsed: Partial<ParsedReview> = { source };
  if (source === 'booking')     parsed = parseBookingEmail(body);
  if (source === 'tripadvisor') parsed = parseTripAdvisorEmail(body);
  if (source === 'google')      parsed = parseGoogleEmail(body);

  return {
    source:        parsed.source        ?? 'unknown',
    reviewer_name: parsed.reviewer_name ?? null,
    score:         parsed.score         ?? null,
    score_max:     parsed.score_max     ?? 10,
    positive_text: parsed.positive_text ?? null,
    negative_text: parsed.negative_text ?? null,
    full_text:     parsed.full_text     ?? body.slice(0, 2000),
    review_date:   parsed.review_date   ?? new Date(),
    language:      parsed.language      ?? 'en',
  };
}
