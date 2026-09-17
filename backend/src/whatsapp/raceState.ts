// raceState.ts — recovery mechanism for a lost webhook timeout race.
//
// withTimeout() in webhook.ts/metaWebhook.ts races the agent call against a
// timer but never cancels the agent itself (no AbortController anywhere in
// the chain) — if the timer wins, the webhook sends a generic fallback and
// returns, while the agent keeps running in the background. It eventually
// produces (and for most tenant types, persists) a real answer that nobody
// ever sends to the guest — the dashboard shows the right reply, WhatsApp
// shows the fallback.
//
// Each webhook call site creates a fresh RaceState and passes it into the
// agent function it's about to race. If the timeout fires first, the
// webhook's catch block sets raceLost = true on that same object (objects
// are passed by reference, so the still-running agent sees the mutation)
// before sending the fallback. When the agent later finishes, it checks the
// flag right where it would normally just return its reply, and — only in
// that case — sends the real answer as a follow-up WhatsApp message.
import { sendWhatsAppMessage } from './twilio.js';

export interface RaceState {
  raceLost: boolean;
  tenant: Record<string, any>;
}

/**
 * Sends `reply` as a follow-up guest message, but only if the race was
 * actually lost — a normal-path completion (raceState undefined or
 * raceLost still false) is a no-op. Never throws: this runs after the
 * webhook call that would have handled a failure has already returned.
 */
export async function sendLateFollowUp(
  raceState: RaceState | undefined,
  phone: string,
  reply: string,
): Promise<void> {
  if (!raceState?.raceLost || !reply) return;
  try {
    await sendWhatsAppMessage(phone, `Actually, I found the answer:\n\n${reply}`, raceState.tenant);
    console.log(`[RaceRecovery] Sent late follow-up to ${phone}`);
  } catch (e: any) {
    console.error('[RaceRecovery] Late follow-up send failed:', e.message);
  }
}
