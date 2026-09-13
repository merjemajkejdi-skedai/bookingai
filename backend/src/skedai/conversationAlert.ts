// SkedAI — "new conversation started" email alert (SkedAI tenant only).
// Fires once per brand-new skedai_conversations row, never on subsequent
// messages within an already-existing conversation. See callers in
// whatsapp/webhook.ts and whatsapp/metaWebhook.ts (the INSERT branch of
// persistConversation / persistGuestMessage).
import { Resend } from 'resend';

const SKEDAI_TENANT_ID = 'a96fa8a6-d3b9-47c6-9021-9acb9bb6927a';
const ALERT_EMAIL       = 'Merjemajkejdi@gmail.com';
const FROM_EMAIL        = 'SkedAI Alerts <alerts@skedai.net>';

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export interface NewSkedaiConversation {
  id:         string;
  channel:    string;
  guestPhone: string;
  createdAt?: string;
}

/**
 * Sends the "new conversation" alert email — but only for the SkedAI tenant,
 * and only when called from a genuine INSERT (new conversation), never an
 * UPDATE (existing conversation, another message). Never throws: a failed
 * send is logged and swallowed so conversation creation is never blocked.
 */
export async function maybeSendNewConversationAlert(
  tenantId: string,
  conv:     NewSkedaiConversation,
): Promise<void> {
  if (tenantId !== SKEDAI_TENANT_ID) return;

  try {
    const when = new Date(conv.createdAt || Date.now()).toLocaleString('en-GB', {
      timeZone: 'Europe/Tirane',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    // No client-side router in this dashboard — ?openGuestPhone= is read once
    // on load by the SkedAI module and dispatches the same in-app
    // 'hotel:open-conversation' event the desktop-notification click handler
    // already uses, which opens the matching conversation once it's loaded.
    const dashboardUrl = `https://app.skedai.net/?openGuestPhone=${encodeURIComponent(conv.guestPhone)}`;

    await getResend().emails.send({
      from:    FROM_EMAIL,
      to:      ALERT_EMAIL,
      subject: 'New conversation started — SkedAI inbox',
      html: `
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
  <h2 style="color:#0D9488;margin:0 0 12px;">New conversation — SkedAI inbox</h2>
  <p style="margin:0 0 6px;"><strong>Channel:</strong> ${conv.channel}</p>
  <p style="margin:0 0 16px;"><strong>Started:</strong> ${when}</p>
  <a href="${dashboardUrl}"
     style="display:inline-block;background:#0D9488;color:#fff;text-decoration:none;
            padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px;">
    View conversation →
  </a>
</div>`,
    });

    console.log(`[Alert] New conversation email sent for SkedAI tenant, conversation ${conv.id}`);
  } catch (e: any) {
    console.error('[Alert] Failed to send new conversation email:', e.message);
  }
}
