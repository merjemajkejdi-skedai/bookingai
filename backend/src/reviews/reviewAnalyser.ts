import Anthropic from '@anthropic-ai/sdk';
import type { ParsedReview } from './emailParser.js';
import { isPg, query, queryOne, prepare } from '../db/database.js';

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

export interface ReviewAnalysis {
  sentiment_score:    number;
  is_flagged:         boolean;
  flag_reason:        string | null;
  suggested_response: string;
  language:           string;
}

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}

export async function analyseReview(
  review: ParsedReview | Record<string, any>,
  tenantId: string,
): Promise<ReviewAnalysis> {
  const config = await dbGet('SELECT * FROM hotel_config WHERE tenant_id = ?', tenantId) as any;
  const tenant = await dbGet('SELECT name FROM tenants WHERE id = ?', tenantId) as any;
  const hotelName = config?.hotel_name || tenant?.name || 'our hotel';

  // Support both full_text (ParsedReview) and full_review_text (DB row)
  const fullText = (review as any).full_text ?? (review as any).full_review_text ?? null;

  const reviewContent = [
    review.positive_text && `Positive: ${review.positive_text}`,
    review.negative_text && `Negative: ${review.negative_text}`,
    !review.positive_text && !review.negative_text && fullText,
  ].filter(Boolean).join('\n') || fullText || '(no review text provided)';

  const prompt = `You are the manager of ${hotelName}.

Hotel details:
- Check-in: ${config?.check_in_time || '14:00'}
- Check-out: ${config?.check_out_time || '11:00'}
- Breakfast: ${config?.breakfast_hours || 'available'}

A guest left this review (score: ${review.score != null ? `${review.score}/10` : 'not given'}):
${reviewContent}

Reviewer: ${review.reviewer_name || 'Anonymous'}
Platform: ${review.source}

Respond in JSON only with this exact structure:
{
  "sentiment_score": <number 0-10, 0=very negative, 10=very positive>,
  "is_flagged": <true if score below 7 or contains serious complaints>,
  "flag_reason": <one sentence explaining the flag, or null>,
  "suggested_response": <professional warm reply in the same language as the review, under 100 words>,
  "language": <ISO language code, e.g. "en", "sq", "it", "de">
}

Rules for suggested_response:
- Address the specific complaints or praise
- Mention ${hotelName} by name
- Warm and professional — never defensive
- If negative, apologise sincerely and mention a concrete action
- Write in the same language as the review`;

  const response = await client.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find(b => b.type === 'text')?.text ?? '{}';

  try {
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      sentiment_score:    typeof parsed.sentiment_score === 'number' ? parsed.sentiment_score : 5,
      is_flagged:         parsed.is_flagged         === true,
      flag_reason:        parsed.flag_reason         ?? null,
      suggested_response: parsed.suggested_response ?? '',
      language:           parsed.language            ?? 'en',
    };
  } catch {
    return {
      sentiment_score:    review.score != null ? Number(review.score) : 5,
      is_flagged:         review.score != null ? Number(review.score) < 7 : false,
      flag_reason:        'Could not analyse — please review manually',
      suggested_response: `Dear ${review.reviewer_name || 'Guest'}, thank you for your review of ${hotelName}. We appreciate your feedback and hope to welcome you again soon.`,
      language:           'en',
    };
  }
}
