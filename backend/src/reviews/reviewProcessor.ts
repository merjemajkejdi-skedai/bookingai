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
          sentiment_score, flag_reason, raw_email)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?)`,
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

    // Only notify immediately for flagged/negative reviews — positive ones go in the daily digest
    if (tenant.owner_phone && analysis.is_flagged) {
      const scoreDisplay = review.score != null
        ? `${review.score}/${review.score_max}`
        : 'No score';

      const preview = (review.negative_text || review.full_text || '')
        .slice(0, 120).trim();

      const source = review.source.charAt(0).toUpperCase() + review.source.slice(1);

      const msg = [
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

      try {
        await sendWhatsAppMessage(tenant.owner_phone, msg, tenant);
        console.log(`[Reviews] ⚠️ Flagged review notification sent to ${tenant.owner_phone}`);
      } catch (err) {
        console.error('[Reviews] Failed to send WhatsApp notification:', err);
      }
    }
  } catch (e) {
    console.error('[Reviews] Error processing review email:', e);
  }
}
