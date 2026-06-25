import { isPg, prepare, query, queryRun } from '../db/database.js';
import { sendDailyInventoryDigest } from '../services/inventory.js';

async function dbAll(sql: string, ...p: unknown[]) { return (isPg ? query(sql, p) : prepare(sql).all(...p)) as any[]; }
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

  // Inventory daily digest — checks every minute for shops due at this time
  setInterval(async () => {
    try {
      const now = new Date().toLocaleTimeString('en-GB', {
        timeZone: 'Europe/Tirane',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const shops = await dbAll(
        `SELECT tenant_id FROM shop_config
         WHERE inventory_enabled = 1
           AND inventory_alert_whatsapp = 1
           AND inventory_alert_mode = 'daily'
           AND inventory_alert_time = ?`,
        now,
      );
      for (const shop of shops) {
        await sendDailyInventoryDigest(shop.tenant_id as string).catch(
          (err: any) => console.error('[Inventory] Digest error:', err.message),
        );
      }
    } catch (err) {
      console.error('[Inventory] Cron error:', err);
    }
  }, 60 * 1000);
}
