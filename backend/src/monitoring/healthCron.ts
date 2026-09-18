import cron from 'node-cron';
import { runHealthCheckCycle } from './healthAlertEngine.js';

let isRunning = false;

export function startHealthCron(): void {
  cron.schedule('*/5 * * * *', () => {
    if (isRunning) return; // guard against overlapping cycles, mirrors channels/email/worker.ts
    isRunning = true;
    runHealthCheckCycle()
      .catch(e => console.error('[Health] Uncaught cycle error:', e.message))
      .finally(() => { isRunning = false; });
  });
  console.log('[Health] System health check job scheduled every 5 minutes');
}
