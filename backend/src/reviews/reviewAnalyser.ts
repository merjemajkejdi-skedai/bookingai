// ---------------------------------------------------------------------------
// reviewAnalyser.ts — Calls Claude to analyse a parsed review and generate
// a structured JSON response with sentiment, flags, and a suggested reply.
// ---------------------------------------------------------------------------
import Anthropic from '@anthropic-ai/sdk';
import { isPg, queryOne, prepare } from '../db/database.js';
import type { ParsedReview } from './emailParser.js';

// ── Local DB helper ──────────────────────────────────────────────────────────
async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p) as any;
}

// ── Client ───────────────────────────────────────────────────────────────────
const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const MODEL  = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// ── Types ────────────────────────────────────────────────────────────────────
export interface ReviewAnalysis {
  sentiment_score:    number;      // 1–10
  is_flagged:         boolean;     // true when review needs urgent attention
  flag_reason:        string | null;
  suggested_response: string;
  language:           string;      // ISO 639-1 e.g. "en", "it", "sq"
}

// ---------------------------------------------------------------------------
// analyseReview
// ---------------------------------------------------------------------------
export async function analyseReview(
  review: ParsedReview | Record<string, any>,
  tenantId: string,
): Promise<ReviewAnalysis> {
  // ── Load hotel config & tenant name ────────────────────────────────────────
  const hotelConfig = await dbGet(
    `SELECT hotel_name FROM hotel_config WHERE tenant_id = ?`,
    tenantId,
  );
  const tenant = await dbGet(
    `SELECT name FROM tenants WHERE id = ?`,
    tenantId,
  );
  const hotelName: string =
    hotelConfig?.hotel_name ?? tenant?.name ?? 'the hotel';

  // ── Build review content summary for the prompt ────────────────────────────
  const scoreLine = review.score != null
    ? `Score: ${review.score} / ${review.score_max ?? 10}`
    : 'Score: not provided';

  const reviewerLine = review.reviewer_name
    ? `Reviewer: ${review.reviewer_name}`
    : 'Reviewer: anonymous';

  const sourceLine = `Source: ${review.source ?? 'unknown'}`;

  const positiveLine = review.positive_text
    ? `Positive feedback:\n${review.positive_text}`
    : '';

  const negativeLine = review.negative_text
    ? `Negative feedback:\n${review.negative_text}`
    : '';

  const fullLine = (!review.positive_text && !review.negative_text && review.full_text)
    ? `Review text:\n${review.full_text}`
    : '';

  const reviewContent = [scoreLine, reviewerLine, sourceLine, positiveLine, negativeLine, fullLine]
    .filter(Boolean)
    .join('\n');

  // ── Prompt ─────────────────────────────────────────────────────────────────
  const prompt = `You are the manager of ${hotelName}. You have received the following guest review:

${reviewContent}

Respond with ONLY a JSON object (no markdown, no explanation) with this exact structure:
{
  "sentiment_score": <number 1-10, where 1 is very negative and 10 is very positive>,
  "is_flagged": <true if the review score is below 7 or contains serious complaints that need urgent attention, otherwise false>,
  "flag_reason": <string explaining why it is flagged, or null if not flagged>,
  "suggested_response": <a warm, professional reply from the hotel manager; address any complaints directly; mention the hotel name "${hotelName}"; keep it under 100 words; match the language of the review>,
  "language": <ISO 639-1 language code of the review, e.g. "en", "it", "sq", "de", "fr">
}`;

  // ── Call Claude ────────────────────────────────────────────────────────────
  try {
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 512,
      messages:   [{ role: 'user', content: prompt }],
    });

    const rawText = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('');

    // Extract JSON — handle any surrounding whitespace or stray text
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object in Claude response');

    const parsed = JSON.parse(jsonMatch[0]) as ReviewAnalysis;

    return {
      sentiment_score:    typeof parsed.sentiment_score === 'number' ? parsed.sentiment_score : 5,
      is_flagged:         Boolean(parsed.is_flagged),
      flag_reason:        parsed.flag_reason ?? null,
      suggested_response: parsed.suggested_response ?? '',
      language:           parsed.language ?? 'en',
    };
  } catch (err: any) {
    console.error('[reviewAnalyser] Claude call failed:', err.message);

    // ── Fallback: deterministic analysis ────────────────────────────────────
    const score   = typeof review.score === 'number' ? review.score : null;
    const scoreOn10 = score != null
      ? (review.score_max === 5 ? score * 2 : score)
      : 5;

    const isFlagged = score != null ? scoreOn10 < 7 : false;

    return {
      sentiment_score:    scoreOn10,
      is_flagged:         isFlagged,
      flag_reason:        isFlagged ? 'Score below 7 — requires attention' : null,
      suggested_response: `Thank you for your feedback. We at ${hotelName} value every guest experience and will take your comments on board to improve our service.`,
      language:           'en',
    };
  }
}
