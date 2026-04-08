// SkedAI notifications — sends WhatsApp alerts to the owner for leads and support requests
// Uses Twilio directly so it can send FROM the SkedAI number (separate from TWILIO_WHATSAPP_FROM)

import twilio from 'twilio';

const OWNER_PHONE   = process.env.SKEDAI_OWNER_PHONE   || '';   // e.g. whatsapp:+355XXXXXXXXX
const SKEDAI_NUMBER = process.env.SKEDAI_WHATSAPP_NUMBER        // e.g. whatsapp:+1XXXXXXXXX
                   || process.env.TWILIO_WHATSAPP_FROM
                   || 'whatsapp:+14155238886';

async function send(body: string): Promise<void> {
  if (!OWNER_PHONE) return;
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return;
  const to   = OWNER_PHONE.startsWith('whatsapp:') ? OWNER_PHONE : `whatsapp:${OWNER_PHONE}`;
  const from = SKEDAI_NUMBER.startsWith('whatsapp:') ? SKEDAI_NUMBER : `whatsapp:${SKEDAI_NUMBER}`;
  try {
    await twilio(sid, token).messages.create({ from, to, body });
  } catch (e: any) {
    console.error('[SkedAI notify] Failed:', e.message);
  }
}

// ── Support notifications ─────────────────────────────────────────────────────
export interface ServiceStatus { service: string; status: string; ok: boolean }

export async function notifySupportRequest(
  from: string,
  message: string,
  systemStatus: ServiceStatus[],
): Promise<void> {
  if (!OWNER_PHONE) return;

  const statusLines = systemStatus
    .map(s => `${s.ok ? '✅' : '❌'} ${s.service}: ${s.status}`)
    .join('\n');

  const hasIssue = systemStatus.some(s => !s.ok);

  await send([
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
): Promise<void> {
  if (!OWNER_PHONE) return;

  await send([
    `🎯 New sales lead!`,
    ``,
    `From: ${from}`,
    `Interest: ${intent}`,
    `Message: "${message}"`,
    context ? `\nContext: ${context}` : '',
  ].filter(Boolean).join('\n'));
}
