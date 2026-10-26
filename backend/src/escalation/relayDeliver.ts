// Human-in-the-loop escalation — sending the relayed answer on the guest's own channel (stage 4).
import crypto from 'crypto';
import { Resend } from 'resend';
import { query } from '../db/database.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';
import { sendInstagramMessage } from '../channels/instagram.js';
import { sendMessengerMessage } from '../channels/messenger.js';
import { GraphAdapter } from '../channels/email/GraphAdapter.js';
import type { EmailAccountRow } from '../channels/email/types.js';
import { appendAssistantMessage } from '../hotel/session.js';
import { appendAssistantMessage as appendGbAssistantMessage } from '../generalBusiness/session.js';
import { appendAssistantMessage as appendAirbnbAssistantMessage } from '../airbnb/session.js';
import { appendShopAssistantMessage } from '../shop/escalation.js';
import { appendArtClassAssistantMessage } from '../modules/art_class/escalation.js';
import type { RelayContext } from './relay.js';

async function rows(sql: string, params: unknown[]): Promise<any[]> {
  return (await query(sql, params)) as any[];
}

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const stripPrefix = (id: string, prefix: string) => (id.startsWith(prefix) ? id.slice(prefix.length) : id);

/** Sends `text` to the guest on the channel their conversation is on. Throws if delivery fails. */
export async function deliverToGuest(ctx: RelayContext, text: string): Promise<void> {
  const { tenant, conversation: c } = ctx;

  switch (c.channel) {
    case 'instagram': {
      const [cs] = await rows(
        `SELECT access_token FROM hotel_channel_settings WHERE tenant_id = ? AND channel = 'instagram' LIMIT 1`,
        [tenant.id],
      );
      if (!cs?.access_token) throw new Error('no Instagram access token for this tenant');
      await sendInstagramMessage(c.channelUserId || stripPrefix(c.guestId, 'instagram:'), text, cs.access_token);
      return;
    }

    case 'messenger': {
      if (!tenant.messenger_page_id || !tenant.messenger_access_token_encrypted) {
        throw new Error('Messenger is not connected for this tenant');
      }
      await sendMessengerMessage(
        tenant.messenger_page_id,
        c.channelUserId || stripPrefix(c.guestId, 'messenger:'),
        text,
        tenant.messenger_access_token_encrypted,
      );
      return;
    }

    case 'email':
      await sendEmailAnswer(ctx, text);
      return;

    default:
      await sendWhatsAppMessage(c.guestId, text, tenant);
  }
}

// Mirrors the reply step of channels/email/worker.ts (same adapters, same threading headers) so the
// guest's next email still lands in this conversation.
async function sendEmailAnswer(ctx: RelayContext, text: string): Promise<void> {
  const { tenant, conversation: c } = ctx;

  const [inbound] = await rows(
    `SELECT * FROM email_messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'inbound'
     ORDER BY created_at DESC LIMIT 1`,
    [tenant.id, c.id],
  );
  if (!inbound) throw new Error('no inbound email in this conversation to reply to');

  const [account] = await rows(
    `SELECT * FROM tenant_email_accounts WHERE id = ? AND tenant_id = ?`,
    [inbound.account_id, tenant.id],
  ) as EmailAccountRow[];
  if (!account) throw new Error('the mailbox this conversation arrived on no longer exists');

  const subject = String(inbound.subject || '').startsWith('Re:') ? inbound.subject : `Re: ${inbound.subject || ''}`.trim();
  const referencesChain = [inbound.references_header, inbound.rfc822_message_id].filter(Boolean).join(' ');

  let sentMessageId: string;
  let outboundProviderRef: string | null = null;

  if (account.provider === 'graph') {
    const adapter = new GraphAdapter(account);
    if (((account as any).send_mode ?? 'resend') === 'graph') await adapter.connect(); // refreshes the OAuth token
    const sent = await adapter.sendReply({
      to: { address: inbound.from_address, name: inbound.from_name ?? undefined },
      from: { address: account.email_address, name: account.display_name ?? 'SkedAI' },
      subject,
      bodyText: text,
      inReplyToMessageId: inbound.rfc822_message_id,
      referencesChain,
      inReplyToProviderRef: inbound.provider_ref ?? undefined,
    });
    sentMessageId = sent.sentMessageId;
    outboundProviderRef = sent.providerRef ?? null;
  } else {
    const senderName = account.display_name?.trim() || 'SkedAI';
    const result = await getResend().emails.send({
      from: `${senderName} <noreply@skedai.net>`,
      to: inbound.from_address,
      replyTo: account.email_address,
      subject,
      text,
      headers: { 'In-Reply-To': inbound.rfc822_message_id, 'References': referencesChain },
    });
    if (result.error || !result.data) throw new Error(`Resend send failed: ${result.error?.message ?? 'unknown error'}`);
    sentMessageId = `<${result.data.id}@resend.dev>`;
  }

  await query(
    `INSERT INTO email_messages
       (id, tenant_id, account_id, conversation_id, direction, rfc822_message_id,
        in_reply_to, references_header, from_address, from_name, to_address, subject, body_text, sent_message_id, provider_ref)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    [
      crypto.randomUUID(), tenant.id, account.id, c.id, 'outbound', sentMessageId,
      inbound.rfc822_message_id, referencesChain,
      account.provider === 'graph' ? account.email_address : 'noreply@skedai.net',
      account.display_name ?? 'SkedAI', inbound.from_address, subject, text, sentMessageId, outboundProviderRef,
    ],
  );
}

/** Stores the relayed message in the conversation history as an assistant message. */
export async function appendRelayedToHistory(ctx: RelayContext, text: string): Promise<void> {
  const { tenant, escalation, conversation: c } = ctx;
  if (escalation.tenant_type === 'general_business') {
    await appendGbAssistantMessage({ tenantId: tenant.id, conversationId: c.id, sessionPhone: c.guestId, content: text });
    return;
  }
  if (escalation.tenant_type === 'art_class') {
    await appendArtClassAssistantMessage({ tenantId: tenant.id, conversationId: c.id, guestPhone: c.guestId, content: text });
    return;
  }
  if (escalation.tenant_type === 'shop') {
    await appendShopAssistantMessage({ tenantId: tenant.id, conversationId: c.id, content: text });
    return;
  }
  if (escalation.tenant_type === 'airbnb') {
    await appendAirbnbAssistantMessage({ conversationId: c.id, content: text });
    return;
  }
  if (escalation.tenant_type !== 'hotel') {
    console.warn(`[Escalation relay] history append not implemented for tenant type ${escalation.tenant_type}`);
    return;
  }
  const isEmail = c.channel === 'email';
  await appendAssistantMessage({
    tenantId: tenant.id,
    conversationId: c.id,
    sessionPhone: isEmail ? (c.channelUserId ?? `email:${c.guestId}`) : c.guestId,
    content: text,
    extra: isEmail ? { channel: 'email' } : undefined,
    keepInMemory: !isEmail,
  });
}
