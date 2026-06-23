import { isPg, prepare, queryRun } from '../db/database.js';

async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

async function resetDailyStock() {
  try {
    // Reset stock_used for items with daily limit whose last reset was before today
    await dbRun(
      `UPDATE shop_menu_items SET stock_used = 0, stock_last_reset = CURRENT_DATE WHERE stock_type = 'daily' AND (stock_last_reset IS NULL OR stock_last_reset < CURRENT_DATE)`,
    );
    console.log('[Shop] ✅ Daily stock reset complete');
  } catch (err: any) {
    console.error('[Shop] Daily stock reset failed:', err.message);
  }
}

export function startShopCron() {
  // Run immediately on startup in case of missed reset after deploy
  resetDailyStock().catch(() => {});

  // Check every 5 minutes; trigger at midnight (hour 0, first 5 minutes)
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() < 5) {
      resetDailyStock().catch(() => {});
    }
  }, 5 * 60 * 1000);

  console.log('[Shop] ✅ Daily stock reset cron started');
}
