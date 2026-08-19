import cron from 'node-cron';
import crypto from 'crypto';
import { Resend } from 'resend';
import { isPg, prepare, query, queryOne, queryRun } from '../../db/database.js';
import { runHotelAgent } from '../../hotel/agent.js';
import { ImapSmtpAdapter } from './ImapSmtpAdapter.js';
import { GraphAdapter } from './GraphAdapter.js';
import { cleanBody } from './bodyClean.js';
import { safetyCheck } from './safetyChecks.js';
import type { EmailAccountRow, InboundMessage, MailboxAdapter } from './types.js';

// Railway blocks outbound SMTP (587 / 465) — all replies go through Resend instead.
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

function buildAdapter(account: EmailAccountRow): MailboxAdapter {
  return account.provider === 'graph'
    ? new GraphAdapter(account)
    : new ImapSmtpAdapter(account);
}

// ---------------------------------------------------------------------------
// Find or create a hotel_conversation for this email address
// ---------------------------------------------------------------------------
async function findOrCreateConversation(
  tenantId: string,
  fromAddress: string,
  msg: InboundMessage,
): Promise<string> {
  const channelUserId = `email:${fromAddress.toLowerCase()}`;

  // Check if inReplyTo or references matches a known email_message → reuse that conversation
  if (msg.inReplyTo || msg.references) {
    const refIds = [msg.inReplyTo, ...(msg.references ?? '').split(/\s+/)]
      .filter(Boolean)
      .map(id => id!.trim());

    for (const refId of refIds) {
      const linked = await dbGet(
        `SELECT conversation_id FROM email_messages WHERE tenant_id = ? AND rfc822_message_id = ? LIMIT 1`,
        tenantId, refId,
      ) as any;
      if (linked?.conversation_id) return linked.conversation_id;
    }
  }

  // Fall back to one conversation per (tenant, channel_user_id)
  const existing = await dbGet(
    `SELECT id FROM hotel_conversations WHERE tenant_id = ? AND channel = 'email' AND channel_user_id = ?`,
    tenantId, channelUserId,
  ) as any;
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  // Use only columns that exist in hotel_conversations.
  // guest_phone is NOT NULL so we store the email address there; subject stays in email_messages only.
  await dbRun(
    `INSERT INTO hotel_conversations
       (id, tenant_id, guest_phone, messages, channel, channel_user_id,
        last_message, updated_at, last_guest_message_at)
     VALUES (?,?,?,'[]','email',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    id, tenantId, fromAddress.toLowerCase(), channelUserId,
  );
  return id;
}

// ---------------------------------------------------------------------------
// Process one message — returns outcome string, throws on unrecoverable error
// ---------------------------------------------------------------------------
async function processMessage(
  account: EmailAccountRow,
  adapter: MailboxAdapter,
  msg: InboundMessage,
): Promise<'replied' | 'skipped-duplicate' | 'skipped-safety' | 'skipped-empty' | 'pending-ai-disabled'> {
  // (a) Idempotency check
  const already = await dbGet(
    `SELECT id FROM email_messages WHERE tenant_id = ? AND rfc822_message_id = ?`,
    account.tenant_id, msg.rfc822MessageId,
  );
  if (already) {
    await adapter.moveMessage(msg.providerRef, account.answered_folder_path);
    return 'skipped-duplicate';
  }

  // (b) Safety checks
  const skipReason = safetyCheck(msg, account.email_address);
  if (skipReason) {
    await dbRun(
      `INSERT INTO email_skipped_log (id, tenant_id, account_id, rfc822_message_id, from_address, subject, reason)
       VALUES (?,?,?,?,?,?,?)`,
      crypto.randomUUID(), account.tenant_id, account.id,
      msg.rfc822MessageId, msg.from.address, msg.subject, skipReason,
    );
    await adapter.moveMessage(msg.providerRef, account.failed_folder_path);
    return 'skipped-safety';
  }

  // (c) Clean body — reject empty or suspiciously short (< 5 chars)
  const cleanedBody = cleanBody(msg.bodyText, msg.bodyHtml);
  if (cleanedBody.trim().length < 5) {
    await adapter.moveMessage(msg.providerRef, account.failed_folder_path);
    return 'skipped-empty';
  }

  // (d) Find or create conversation
  const conversationId = await findOrCreateConversation(
    account.tenant_id, msg.from.address, msg,
  );

  // (e) Insert inbound email_messages row (UNIQUE fence — safe to race)
  const inboundId = crypto.randomUUID();
  const bodyRaw   = msg.rawSource ? msg.rawSource.toString('base64') : null;
  try {
    await dbRun(
      `INSERT INTO email_messages
         (id, tenant_id, account_id, conversation_id, direction, rfc822_message_id,
          in_reply_to, references_header, from_address, from_name, to_address, subject,
          body_text, body_raw, provider_ref)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      inboundId, account.tenant_id, account.id, conversationId, 'inbound',
      msg.rfc822MessageId, msg.inReplyTo ?? null, msg.references ?? null,
      msg.from.address, msg.from.name ?? null,
      msg.to[0]?.address ?? account.email_address,
      msg.subject, cleanedBody, bodyRaw, msg.providerRef,
    );
  } catch (dupErr: any) {
    if (dupErr.message?.includes('UNIQUE') || dupErr.code === '23505') {
      await adapter.moveMessage(msg.providerRef, account.answered_folder_path);
      return 'skipped-duplicate';
    }
    throw dupErr;
  }

  // Append inbound message to hotel_conversations.messages JSONB
  const emailMsg = {
    role: 'user',
    content: cleanedBody,
    subject: msg.subject,
    ts: msg.receivedAt.toISOString(),
    channel: 'email',
    from: msg.from.address,
  };
  if (isPg) {
    await dbRun(
      `UPDATE hotel_conversations
       SET messages = messages || ?::jsonb,
           last_message = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP,
           last_guest_message_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      JSON.stringify([emailMsg]), conversationId,
    );
  } else {
    const convRow = await dbGet('SELECT messages FROM hotel_conversations WHERE id = ?', conversationId) as any;
    const prev: any[] = (() => { try { return JSON.parse(convRow?.messages ?? '[]'); } catch { return []; } })();
    await dbRun(
      `UPDATE hotel_conversations
       SET messages = ?,
           last_message = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP,
           last_guest_message_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      JSON.stringify([...prev, emailMsg].slice(-200)), conversationId,
    );
  }

  // (f) AI disabled → leave in watch folder (shows as pending in dashboard)
  if (!account.ai_enabled) {
    return 'pending-ai-disabled';
  }

  // (g) Call hotel agent
  const reply = await runHotelAgent(
    cleanedBody,
    [],
    `email:${msg.from.address.toLowerCase()}`,
    account.tenant_id,
  );

  if (!reply) {
    await adapter.moveMessage(msg.providerRef, account.failed_folder_path);
    throw new Error('Agent returned empty reply');
  }

  // Append AI reply to hotel_conversations.messages JSONB.
  // saveHotelConversation is skipped for email: phones so we write directly here.
  const replySubject = msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`;
  const assistantMsg = {
    role: 'assistant',
    content: reply,
    subject: replySubject,
    ts: new Date().toISOString(),
    channel: 'email',
    from: account.email_address,
  };
  if (isPg) {
    await dbRun(
      `UPDATE hotel_conversations
       SET messages = messages || ?::jsonb,
           last_message = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      JSON.stringify([assistantMsg]), conversationId,
    );
  } else {
    const convRow2 = await dbGet('SELECT messages FROM hotel_conversations WHERE id = ?', conversationId) as any;
    const prev2: any[] = (() => { try { return JSON.parse(convRow2?.messages ?? '[]'); } catch { return []; } })();
    await dbRun(
      `UPDATE hotel_conversations
       SET messages = ?,
           last_message = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      JSON.stringify([...prev2, assistantMsg].slice(-200)), conversationId,
    );
  }

  // (h) Send reply.
  //     Graph accounts: use adapter.sendReply() which gates on send_mode ('graph' or 'resend').
  //     IMAP accounts:  use Resend directly (Railway blocks SMTP 587/465).
  const referencesChain = [msg.references, msg.rfc822MessageId].filter(Boolean).join(' ');
  const outboundSubject = msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`;

  let sentMessageId: string;
  let outboundProviderRef: string | null = null;

  if (account.provider === 'graph') {
    const sendResult = await (adapter as GraphAdapter).sendReply({
      to:                    msg.from,
      from:                  { address: account.email_address, name: account.display_name ?? 'SkedAI' },
      subject:               outboundSubject,
      bodyText:              reply,
      inReplyToMessageId:    msg.rfc822MessageId,
      referencesChain,
      inReplyToProviderRef:  msg.providerRef,
    });
    sentMessageId = sendResult.sentMessageId;
    outboundProviderRef = sendResult.providerRef ?? null;
    console.log(`[Email] ${account.email_address} — reply sent via Graph (${sentMessageId})`);
  } else {
    // IMAP: Railway blocks outbound SMTP — use Resend instead.
    const senderName = account.display_name?.trim() || 'SkedAI';
    console.log(`[Email] Sending via Resend — to: ${msg.from.address} reply_to: ${account.email_address}`);
    const resendResult = await getResend().emails.send({
      from:    `${senderName} <noreply@skedai.net>`,
      to:      msg.from.address,
      replyTo: account.email_address,
      subject:  outboundSubject,
      text:     reply,
      headers: {
        'In-Reply-To': msg.rfc822MessageId,
        'References':  referencesChain,
      },
    });
    if (resendResult.error || !resendResult.data) {
      throw new Error(`Resend send failed: ${resendResult.error?.message ?? 'unknown error'}`);
    }
    sentMessageId = `<${resendResult.data.id}@resend.dev>`;
    console.log(`[Email] ${account.email_address} — reply sent via Resend (${sentMessageId})`);
  }

  // (j) Insert outbound email_messages row
  await dbRun(
    `INSERT INTO email_messages
       (id, tenant_id, account_id, conversation_id, direction, rfc822_message_id,
        in_reply_to, references_header, from_address, from_name, to_address, subject, body_text, sent_message_id, provider_ref)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    crypto.randomUUID(), account.tenant_id, account.id, conversationId, 'outbound',
    sentMessageId,
    msg.rfc822MessageId, referencesChain,
    account.provider === 'graph' ? account.email_address : 'noreply@skedai.net',
    account.display_name ?? 'SkedAI',
    msg.from.address,
    outboundSubject,
    reply, sentMessageId, outboundProviderRef,
  );

  // (k) Move original to Answered
  await adapter.moveMessage(msg.providerRef, account.answered_folder_path);
  return 'replied';
}

// ---------------------------------------------------------------------------
// Process one account — returns per-account stats, never throws
// ---------------------------------------------------------------------------
async function processAccount(account: EmailAccountRow): Promise<{ processed: number; skipped: number; failed: number }> {
  const stats = { processed: 0, skipped: 0, failed: 0 };
  const addr = account.email_address;
  const adapter = buildAdapter(account);
  try {
    console.log(`[Email] ${addr} — connecting (${account.provider})`);
    await adapter.connect();

    await adapter.ensureFolder(account.watch_folder_path);
    await adapter.ensureFolder(account.answered_folder_path);
    await adapter.ensureFolder(account.failed_folder_path);

    const messages = await adapter.fetchMessages(account.watch_folder_path, 20);
    console.log(`[Email] ${addr} — ${messages.length} messages in ${account.watch_folder_path}`);

    for (const msg of messages) {
      try {
        const outcome = await processMessage(account, adapter, msg);
        console.log(`[Email] ${addr} — processed ${msg.rfc822MessageId}: ${outcome}`);
        outcome === 'replied' ? stats.processed++ : stats.skipped++;
      } catch (msgErr: any) {
        stats.failed++;
        console.error(`[Email] ${addr} — ERROR processing ${msg.rfc822MessageId}: ${msgErr.message}\n${msgErr.stack}`);
        try {
          await adapter.moveMessage(msg.providerRef, account.failed_folder_path);
        } catch (moveErr: any) {
          console.error(`[Email] ${addr} — ERROR moveToFailed: ${moveErr.message}`);
        }
        await dbRun(
          `INSERT INTO email_skipped_log (id, tenant_id, account_id, rfc822_message_id, from_address, subject, reason)
           VALUES (?,?,?,?,?,?,?)`,
          crypto.randomUUID(), account.tenant_id, account.id,
          msg.rfc822MessageId, msg.from.address, msg.subject, msgErr.message,
        ).catch((dbErr: any) => console.error(`[Email] ${addr} — ERROR logging skipped: ${dbErr.message}`));
      }
    }

    await dbRun(
      `UPDATE tenant_email_accounts
       SET consecutive_failures = 0, last_error = NULL, last_checked_at = ?, last_success_at = ?
       WHERE id = ?`,
      new Date().toISOString(), new Date().toISOString(), account.id,
    );
  } catch (err: any) {
    console.error(`[Email] ${addr} — ERROR (${err.message})\n${err.stack}`);
    stats.failed++;
    await dbRun(
      `UPDATE tenant_email_accounts
       SET consecutive_failures = consecutive_failures + 1, last_error = ?, last_checked_at = ?
       WHERE id = ?`,
      err.message, new Date().toISOString(), account.id,
    ).catch(() => {});
  } finally {
    try { await adapter.disconnect(); } catch { /* ignore */ }
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Public — called from index.ts after runMigrations()
// ---------------------------------------------------------------------------
export function startEmailWorker(): void {
  cron.schedule('*/2 * * * *', async () => {
    let accounts: EmailAccountRow[] = [];
    try {
      accounts = (await dbAll(
        `SELECT * FROM tenant_email_accounts WHERE is_enabled ORDER BY last_checked_at ASC NULLS FIRST`,
      )) as unknown as EmailAccountRow[];
    } catch (e: any) {
      console.error('[Email] FATAL — failed to load accounts (schema issue?):', e.message, '\n', e.stack);
      return;
    }

    if (accounts.length === 0) return;

    console.log(`[Email] Cycle start — ${accounts.length} enabled account(s)`);
    let cycleProcessed = 0, cycleSkipped = 0, cycleFailed = 0;

    for (const account of accounts) {
      const stats = await processAccount(account);
      cycleProcessed += stats.processed;
      cycleSkipped   += stats.skipped;
      cycleFailed    += stats.failed;
    }

    console.log(`[Email] Cycle complete — ${cycleProcessed} processed, ${cycleSkipped} skipped, ${cycleFailed} failed`);
  });
  console.log('📧 Email worker started (polling every 120s)');
}
