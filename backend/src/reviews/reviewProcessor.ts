import { randomUUID } from 'crypto';
import { parseReviewEmail } from './emailParser.js';
import { analyseReview } from './reviewAnalyser.js';
import { isPg, query, queryOne, queryRun, prepare } from '../db/database.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : (prepare(sql).get(...p) as any);
}
async function dbRun(sql: string, ...p: unknown[]) {
  if (isPg) return queryRun(sql, p);
  prepare(sql).run(...p);
}

/** Build the WhatsApp alert message for a single flagged review */
export function buildFlaggedReviewMessage(review: {
  source: string;
  score?: number | null;
  score_max?: number | null;
  reviewer_name?: string | null;
  negative_text?: string | null;
  full_text?: string | null;
  full_review_text?: string | null;
}): string {
  const scoreDisplay = review.score != null
    ? `${review.score}/${review.score_max ?? 10}`
    : 'No score';

  const preview = (review.negative_text || review.full_text || review.full_review_text || '')
    .slice(0, 120).trim();

  const source = review.source.charAt(0).toUpperCase() + review.source.slice(1);

  return [
    `⚠️ *New negative ${source} review*`,
    ``,
    `Score: ${scoreDisplay}`,
    `Guest: ${review.reviewer_name || 'Anonymous'}`,
    ``,
    preview ? `"${preview}${preview.length >= 120 ? '...' : ''}"` : '',
    ``,
    `AI response ready. Open your dashboard to review and respond:`,
    `app.skedai.net`,
  ].filter(line => line !== null && line !== undefined).join('\n');
}

export async function processInboundReviewEmail(
  from:      string,
  subject:   string,
  body:      string,
  recipient: string,
  rawEmail:  string,
): Promise<void> {
  try {
    const slug = recipient.split('@')[0].toLowerCase().trim();

    const tenant = await dbGet(
      'SELECT * FROM tenants WHERE review_email_slug = ?', slug,
    ) as any;

    if (!tenant) {
      console.warn(`[Reviews] No tenant found for slug: ${slug}`);
      return;
    }

    console.log(`[Reviews] Processing review for tenant: ${tenant.name}`);

    const review  = parseReviewEmail(from, subject, body);
    const analysis = await analyseReview(review, tenant.id);

    const id = randomUUID();
    await dbRun(
      `INSERT INTO hotel_reviews
         (id, tenant_id, source, reviewer_name, score, score_max,
          review_date, positive_text, negative_text, full_review_text,
          language, suggested_response, status, is_flagged,
          sentiment_score, flag_reason, raw_email, owner_notified)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,0)`,
      id,
      tenant.id,
      review.source,
      review.reviewer_name,
      review.score,
      review.score_max,
      review.review_date?.toISOString() ?? new Date().toISOString(),
      review.positive_text,
      review.negative_text,
      review.full_text,
      analysis.language,
      analysis.suggested_response,
      analysis.is_flagged ? 1 : 0,
      analysis.sentiment_score,
      analysis.flag_reason,
      rawEmail.slice(0, 5000),
    );

    console.log(`[Reviews] Saved review ${id} for ${tenant.name}`);

    // Send immediate WhatsApp only if the tenant chose 'immediate' frequency
    // (or has no preference set — default is immediate).
    // All other frequencies are handled by the batch cron in digestCron.ts.
    const frequency = tenant.review_notification_frequency ?? 'immediate';
    if (tenant.owner_phone && analysis.is_flagged && frequency === 'immediate') {
      const msg = buildFlaggedReviewMessage(review);
      try {
        await sendWhatsAppMessage(tenant.owner_phone, msg, tenant);
        await dbRun('UPDATE hotel_reviews SET owner_notified = 1 WHERE id = ?', id);
        console.log(`[Reviews] ⚠️ Immediate notification sent to ${tenant.owner_phone}`);
      } catch (err) {
        console.error('[Reviews] Failed to send immediate WhatsApp notification:', err);
      }
    }
  } catch (e) {
    console.error('[Reviews] Error processing review email:', e);
  }
}
