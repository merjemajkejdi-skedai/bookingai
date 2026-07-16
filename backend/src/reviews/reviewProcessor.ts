// ---------------------------------------------------------------------------
// reviewProcessor.ts — Ties together email parsing → Claude analysis → DB
// persistence → WhatsApp notification for inbound review emails.
// ---------------------------------------------------------------------------
import { randomUUID } from 'crypto';
import { isPg, queryOne, queryRun, prepare } from '../db/database.js';
import { parseReviewEmail } from './emailParser.js';
import { analyseReview } from './reviewAnalyser.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';

// ── Local DB helpers ─────────────────────────────────────────────────────────
async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p) as any;
}
async function dbRun(sql: string, ...p: unknown[]) {
  if (isPg) return queryRun(sql, p);
  prepare(sql).run(...p);
}

// ---------------------------------------------------------------------------
// processInboundReviewEmail
// ---------------------------------------------------------------------------
export async function processInboundReviewEmail(
  from:      string,
  subject:   string,
  body:      string,
  recipient: string,
  rawEmail:  string,
): Promise<void> {
  try {
    // ── 1. Extract slug from recipient address ───────────────────────────────
    // e.g. "lafavorita@reviews.skedai.net" → "lafavorita"
    const slug = recipient.split('@')[0]?.toLowerCase() ?? '';
    if (!slug) throw new Error(`Cannot derive slug from recipient: ${recipient}`);

    // ── 2. Find tenant by review_email_slug ─────────────────────────────────
    const tenant = await dbGet(
      `SELECT id, name, owner_phone, owner_whatsapp, whatsapp_number,
              provider, twilio_account_sid, twilio_auth_token,
              meta_phone_number_id, meta_access_token
       FROM tenants
       WHERE review_email_slug = ?
         AND is_active = 1`,
      slug,
    );

    if (!tenant) {
      console.warn(`[reviewProcessor] No active tenant found for slug "${slug}" (recipient: ${recipient})`);
      return;
    }

    const tenantId: string = tenant.id as string;

    // ── 3. Parse the email ───────────────────────────────────────────────────
    const parsed = parseReviewEmail(from, subject, body);

    // ── 4. Analyse with Claude ───────────────────────────────────────────────
    const analysis = await analyseReview(parsed, tenantId);

    // ── 5. Persist to hotel_reviews ─────────────────────────────────────────
    const reviewId = randomUUID();

    await dbRun(
      `INSERT INTO hotel_reviews (
        id, tenant_id, source, reviewer_name,
        score, score_max,
        positive_text, negative_text, full_text,
        review_date,
        sentiment_score, is_flagged, flag_reason,
        suggested_response, language,
        raw_email,
        created_at
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?,
        ?, ?, ?,
        ?, ?,
        ?,
        CURRENT_TIMESTAMP
      )`,
      reviewId,
      tenantId,
      parsed.source,
      parsed.reviewer_name,
      parsed.score,
      parsed.score_max,
      parsed.positive_text,
      parsed.negative_text,
      parsed.full_text,
      parsed.review_date ? parsed.review_date.toISOString() : null,
      analysis.sentiment_score,
      analysis.is_flagged ? 1 : 0,
      analysis.flag_reason,
      analysis.suggested_response,
      analysis.language,
      rawEmail.slice(0, 5000),
    );

    // ── 6. WhatsApp notification to hotel owner ──────────────────────────────
    const ownerPhone: string | null =
      (tenant.owner_phone as string | undefined)?.trim() ||
      (tenant.owner_whatsapp as string | undefined)?.trim() ||
      null;

    if (ownerPhone) {
      const scorePart = parsed.score != null
        ? `${parsed.score}/${parsed.score_max}`
        : 'N/A';
      const namepart = parsed.reviewer_name ?? 'Anonymous';
      const source   = parsed.source.charAt(0).toUpperCase() + parsed.source.slice(1);

      let message: string;

      if (analysis.is_flagged) {
        // Negative / flagged review
        const snippet = (
          parsed.negative_text ?? parsed.full_text ?? ''
        ).trim().slice(0, 100);

        message =
          `⚠️ New negative review on ${source} — ${scorePart} from ${namepart}.` +
          (snippet ? `\n\n${snippet}...` : '') +
          `\n\nSuggested response ready in your dashboard.`;
      } else {
        // Positive review
        message =
          `⭐ New ${source} review — ${scorePart} from ${namepart}. ` +
          `Check your dashboard for the suggested response.`;
      }

      try {
        await sendWhatsAppMessage(ownerPhone, message, tenant);
      } catch (waErr: any) {
        console.error('[reviewProcessor] WhatsApp notify failed:', waErr.message);
      }
    }

    console.log(
      `[reviewProcessor] Review ${reviewId} saved for tenant ${tenantId}` +
      ` (source=${parsed.source}, score=${parsed.score}, flagged=${analysis.is_flagged})`,
    );
  } catch (err: any) {
    console.error('[reviewProcessor] processInboundReviewEmail error:', err.message, err.stack);
  }
}
