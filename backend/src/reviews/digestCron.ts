import cron from 'node-cron';
import { isPg, query, queryOne, prepare } from '../db/database.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';

async function dbAll(sql: string, ...params: unknown[]): Promise<any[]> {
  if (isPg) return query(sql, params) as Promise<any[]>;
  return prepare(sql).all(...params) as any[];
}

async function dbGet(sql: string, ...params: unknown[]): Promise<any> {
  if (isPg) return queryOne(sql, params);
  return (prepare(sql).get(...params) as any);
}

async function runDailyDigest(): Promise<void> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    // Find hotel tenants that have new positive (not flagged), pending reviews in the last 24h
    const summaries = await dbAll(
      `SELECT
         t.id,
         COUNT(r.id)             AS new_count,
         ROUND(AVG(r.score), 1) AS avg_score
       FROM tenants t
       JOIN hotel_reviews r ON r.tenant_id = t.id
       WHERE t.type = 'hotel'
         AND t.owner_phone IS NOT NULL
         AND r.is_flagged = 0
         AND r.status   = 'pending'
         AND r.created_at >= ?
       GROUP BY t.id
       HAVING COUNT(r.id) > 0`,
      yesterday.toISOString(),
    );

    console.log(`[Reviews digest] ${summaries.length} tenant(s) have new positive reviews`);

    for (const summary of summaries) {
      // Fetch full tenant row so sendWhatsAppMessage has provider credentials
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
        console.log(`[Reviews digest] Sent summary to ${tenant.name} (${tenant.owner_phone})`);
      } catch (err) {
        console.error(`[Reviews digest] Failed for ${tenant.name}:`, err);
      }
    }
  } catch (err) {
    console.error('[Reviews digest cron error]', err);
  }
}

export function startDigestCron(): void {
  // 09:00 Albania time every day
  cron.schedule('0 9 * * *', () => {
    console.log('[Reviews digest] Running daily positive review digest…');
    runDailyDigest().catch(err => console.error('[Reviews digest] Unhandled error:', err));
  }, { timezone: 'Europe/Tirane' });

  console.log('[Reviews digest] Cron scheduled — daily at 09:00 Europe/Tirane');
}
