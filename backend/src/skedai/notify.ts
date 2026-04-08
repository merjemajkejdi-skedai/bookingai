// SkedAI notifications — sends WhatsApp alerts to the owner for leads and support requests
// Uses Twilio directly so it can send FROM the SkedAI number (separate from TWILIO_WHATSAPP_FROM)

import twilio from 'twilio';

const ENV_OWNER_PHONE  = process.env.SKEDAI_OWNER_PHONE || '';
const SKEDAI_NUMBER    = process.env.SKEDAI_WHATSAPP_NUMBER
                      || process.env.TWILIO_WHATSAPP_FROM
                      || 'whatsapp:+14155238886';

async function send(to: string, body: string): Promise<void> {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || !to) return;
  const toFmt   = to.startsWith('whatsapp:')          ? to          : `whatsapp:${to}`;
  const fromFmt = SKEDAI_NUMBER.startsWith('whatsapp:') ? SKEDAI_NUMBER : `whatsapp:${SKEDAI_NUMBER}`;
  try {
    await twilio(sid, token).messages.create({ from: fromFmt, to: toFmt, body });
  } catch (e: any) {
    console.error('[SkedAI notify] Failed:', e.message);
  }
}

function ownerPhone(override?: string) { return override || ENV_OWNER_PHONE; }

// ── Support notifications ─────────────────────────────────────────────────────
export interface ServiceStatus { service: string; status: string; ok: boolean }

export async function notifySupportRequest(
  from: string,
  message: string,
  systemStatus: ServiceStatus[],
  overridePhone?: string,
): Promise<void> {
  const phone = ownerPhone(overridePhone);
  if (!phone) return;

  const statusLines = systemStatus.map(s => `${s.ok ? '✅' : '❌'} ${s.service}: ${s.status}`).join('\n');
  const hasIssue    = systemStatus.some(s => !s.ok);

  await send(phone, [
    `🔔 Support request received`,
    ``,
    `From: ${from}`,
    `Message: "${message}"`,
    ``,
    `System status:`,
    statusLines,
    ``,
    hasIssue ? `⚠️ One or more services may have issues.` : `All systems operational.`,
  ].join('\n'));
}

// ── Sales notifications ───────────────────────────────────────────────────────
export async function notifySalesLead(
  from: string,
  message: string,
  intent: string,
  context?: string,
  overridePhone?: string,
): Promise<void> {
  const phone = ownerPhone(overridePhone);
  if (!phone) return;

  await send(phone, [
    `🎯 New sales lead!`,
    ``,
    `From: ${from}`,
    `Interest: ${intent}`,
    `Message: "${message}"`,
    context ? `\nContext: ${context}` : '',
  ].filter(Boolean).join('\n'));
}
