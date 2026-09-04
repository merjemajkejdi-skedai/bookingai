import cron from 'node-cron';
import { isPg, query, queryOne, prepare, queryRun } from '../db/database.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';
import { buildFlaggedReviewMessage } from './reviewProcessor.js';

const TZ = { timezone: 'Europe/Tirane' };

async function dbAll(sql: string, ...params: unknown[]): Promise<any[]> {
  if (isPg) return query(sql, params) as Promise<any[]>;
  return prepare(sql).all(...params) as any[];
}

async function dbGet(sql: string, ...params: unknown[]): Promise<any> {
  if (isPg) return queryOne(sql, params);
  return (prepare(sql).get(...params) as any);
}

async function dbRun(sql: string, ...params: unknown[]): Promise<void> {
  if (isPg) return queryRun(sql, params);
  prepare(sql).run(...params);
}

// ── Flagged/negative batch sender ─────────────────────────────────────────────

/**
 * Find all tenants whose `review_notification_frequency` is in the given list,
 * gather their unnotified flagged reviews, and send a batch WhatsApp message.
 * Marks each review as owner_notified = 1 after a successful send.
 */
async function sendFlaggedBatch(frequencies: string[]): Promise<void> {
  try {
    const placeholders = frequencies.map(() => '?').join(', ');

    // Fetch unnotified flagged reviews grouped by tenant
    const reviews = await dbAll(
      `SELECT
         r.id,
         r.tenant_id,
         r.source,
         r.reviewer_name,
         r.score,
         r.score_max,
         r.negative_text,
         r.full_review_text,
         r.flag_reason
       FROM hotel_reviews r
       JOIN tenants t ON t.id = r.tenant_id
       WHERE t.review_notification_frequency IN (${placeholders})
         AND t.owner_phone IS NOT NULL
         AND r.is_flagged  = 1
         AND r.owner_notified = 0
         AND t.deleted_at IS NULL
       ORDER BY r.tenant_id, r.created_at DESC`,
      ...frequencies,
    );

    if (!reviews.length) return;

    // Group by tenant_id
    const byTenant = new Map<string, typeof reviews>();
    for (const r of reviews) {
      const key = r.tenant_id as string;
      if (!byTenant.has(key)) byTenant.set(key, []);
      byTenant.get(key)!.push(r);
    }

    console.log(`[Reviews batch] Sending to ${byTenant.size} tenant(s) for frequencies [${frequencies.join(', ')}]`);

    for (const [tenantId, tenantReviews] of byTenant) {
      const tenant = await dbGet('SELECT * FROM tenants WHERE id = ?', tenantId);
      if (!tenant?.owner_phone) continue;

      const count = tenantReviews.length;

      let msg: string;

      if (count === 1) {
        // Single review — use the same rich format as immediate alerts
        msg = buildFlaggedReviewMessage({
          source:          tenantReviews[0].source,
          score:           tenantReviews[0].score,
          score_max:       tenantReviews[0].score_max,
          reviewer_name:   tenantReviews[0].reviewer_name,
          negative_text:   tenantReviews[0].negative_text,
          full_review_text: tenantReviews[0].full_review_text,
        });
      } else {
        // Multiple reviews — compact summary list
        const lines: string[] = [
          `⚠️ *${count} new negative reviews need attention*`,
          ``,
        ];

        for (const r of tenantReviews) {
          const source   = (r.source as string).charAt(0).toUpperCase() + (r.source as string).slice(1);
          const score    = r.score != null ? ` ${r.score}/${r.score_max ?? 10}` : '';
          const preview  = ((r.negative_text || r.full_review_text || '') as string)
            .slice(0, 80).trim();
          lines.push(`• ${source}${score} — "${preview}${preview.length >= 80 ? '...' : ''}"`);
        }

        lines.push(``, `View & respond: app.skedai.net`);
        msg = lines.join('\n');
      }

      try {
        await sendWhatsAppMessage(tenant.owner_phone, msg, tenant);
        console.log(`[Reviews batch] ✅ Sent ${count} review(s) to ${tenant.name}`);

        // Mark all sent reviews as notified
        for (const r of tenantReviews) {
          await dbRun('UPDATE hotel_reviews SET owner_notified = 1 WHERE id = ?', r.id);
        }
      } catch (err) {
        console.error(`[Reviews batch] ❌ Failed for ${tenant.name}:`, err);
        // Don't mark as notified — will retry on next scheduled run
      }
    }
  } catch (err) {
    console.error('[Reviews batch cron error]', err);
  }
}

// ── Positive daily digest ─────────────────────────────────────────────────────

/**
 * Send one daily summary of new positive (not flagged) reviews.
 * Runs at 09:00 for all hotel tenants regardless of notification_frequency.
 */
async function runPositiveDigest(): Promise<void> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    const summaries = await dbAll(
      `SELECT
         t.id,
         COUNT(r.id)             AS new_count,
         ROUND(AVG(r.score)::numeric, 1) AS avg_score
       FROM tenants t
       JOIN hotel_reviews r ON r.tenant_id = t.id
       WHERE t.type       = 'hotel'
         AND t.deleted_at IS NULL
         AND t.owner_phone IS NOT NULL
         AND r.is_flagged  = 0
         AND r.status      = 'pending'
         AND r.created_at::timestamptz >= ?
       GROUP BY t.id
       HAVING COUNT(r.id) > 0`,
      yesterday.toISOString(),
    );

    if (!summaries.length) return;
    console.log(`[Reviews digest] ${summaries.length} tenant(s) have new positive reviews`);

    for (const summary of summaries) {
      const tenant = await dbGet('SELECT * FROM tenants WHERE id = ?', summary.id);
      if (!tenant?.owner_phone) continue;

      const count = Number(summary.new_count);
      const avg   = summary.avg_score != null ? `${summary.avg_score}/10` : 'N/A';

      const msg = [
        `⭐ *Daily review summary*`,
        ``,
        `${count} new positive review${count !== 1 ? 's' : ''} in the last 24 hours`,
        `Average score: ${avg}`,
        ``,
        `View and respond at: app.skedai.net`,
      ].join('\n');

      try {
        await sendWhatsAppMessage(tenant.owner_phone, msg, tenant);
        console.log(`[Reviews digest] ✅ Sent positive summary to ${tenant.name}`);
      } catch (err) {
        console.error(`[Reviews digest] ❌ Failed for ${tenant.name}:`, err);
      }
    }
  } catch (err) {
    console.error('[Reviews positive digest error]', err);
  }
}

// ── Cron registration ─────────────────────────────────────────────────────────

export function startDigestCron(): void {
  // ── Flagged/negative batch schedules ───────────────────────────────────────

  // 09:00 every day → 'daily' tenants + morning run for 'twice_daily' tenants
  cron.schedule('0 9 * * *', () => {
    console.log('[Reviews batch] 09:00 run — daily + twice_daily (morning)');
    sendFlaggedBatch(['daily', 'twice_daily']).catch(e => console.error('[Reviews batch] Unhandled:', e));
  }, TZ);

  // 18:00 every day → second run for 'twice_daily' tenants only
  cron.schedule('0 18 * * *', () => {
    console.log('[Reviews batch] 18:00 run — twice_daily (evening)');
    sendFlaggedBatch(['twice_daily']).catch(e => console.error('[Reviews batch] Unhandled:', e));
  }, TZ);

  // 09:00 every Monday → 'weekly' tenants + Monday run for 'mon_thu' tenants
  cron.schedule('0 9 * * 1', () => {
    console.log('[Reviews batch] Monday 09:00 — weekly + mon_thu');
    sendFlaggedBatch(['weekly', 'mon_thu']).catch(e => console.error('[Reviews batch] Unhandled:', e));
  }, TZ);

  // 09:00 every Thursday → Thursday run for 'mon_thu' tenants
  cron.schedule('0 9 * * 4', () => {
    console.log('[Reviews batch] Thursday 09:00 — mon_thu');
    sendFlaggedBatch(['mon_thu']).catch(e => console.error('[Reviews batch] Unhandled:', e));
  }, TZ);

  // ── Positive review daily digest ───────────────────────────────────────────

  // 09:00 every day — all hotel tenants with new positive reviews
  cron.schedule('0 9 * * *', () => {
    console.log('[Reviews digest] Running daily positive review digest…');
    runPositiveDigest().catch(e => console.error('[Reviews digest] Unhandled:', e));
  }, TZ);

  console.log('[Reviews] Cron jobs scheduled (Europe/Tirane):');
  console.log('  Flagged batch — daily:       09:00 daily');
  console.log('  Flagged batch — twice daily: 09:00 + 18:00 daily');
  console.log('  Flagged batch — weekly:      Monday 09:00');
  console.log('  Flagged batch — mon+thu:     Monday + Thursday 09:00');
  console.log('  Positive digest:             09:00 daily');
}
