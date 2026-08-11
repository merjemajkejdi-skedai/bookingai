import cron from 'node-cron';
import crypto from 'crypto';
import { isPg, prepare, query, queryOne, queryRun } from '../../db/database.js';
import { runHotelAgent } from '../../hotel/agent.js';
import { ImapSmtpAdapter } from './ImapSmtpAdapter.js';
import { GraphAdapter } from './GraphAdapter.js';
import { cleanBody } from './bodyClean.js';
import { safetyCheck } from './safetyChecks.js';
import type { EmailAccountRow, InboundMessage, MailboxAdapter } from './types.js';

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
  subject: string,
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
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO hotel_conversations (id, tenant_id, channel, channel_user_id, subject, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
    id, tenantId, 'email', channelUserId, subject, now, now,
  );
  return id;
}

// ---------------------------------------------------------------------------
// Process one account
// ---------------------------------------------------------------------------
async function processAccount(account: EmailAccountRow): Promise<void> {
  const adapter = buildAdapter(account);
  const tag = `[Email:${account.email_address}]`;
  try {
    await adapter.connect();

    // Ensure watch/answered/failed folders exist
    await adapter.ensureFolder(account.watch_folder);
    await adapter.ensureFolder(account.answered_folder);
    await adapter.ensureFolder(account.failed_folder);

    const messages = await adapter.fetchMessages(account.watch_folder, 20);

    for (const msg of messages) {
      try {
        await processMessage(account, adapter, msg, tag);
      } catch (msgErr: any) {
        console.error(`${tag} message error (${msg.rfc822MessageId}):`, msgErr.message);
        try { await adapter.moveMessage(msg.providerRef, account.failed_folder); } catch { /* ignore */ }
        await dbRun(
          `INSERT INTO email_skipped_log (id, tenant_id, account_id, rfc822_message_id, from_address, subject, reason)
           VALUES (?,?,?,?,?,?,?)`,
          crypto.randomUUID(), account.tenant_id, account.id,
          msg.rfc822MessageId, msg.from.address, msg.subject, msgErr.message,
        );
      }
    }

    // Reset failure counter and update last_checked_at
    await dbRun(
      `UPDATE tenant_email_accounts SET consecutive_failures = 0, last_error = NULL, last_checked_at = ? WHERE id = ?`,
      new Date().toISOString(), account.id,
    );
  } catch (err: any) {
    console.error(`${tag} account error:`, err.message);
    await dbRun(
      `UPDATE tenant_email_accounts
       SET consecutive_failures = consecutive_failures + 1, last_error = ?, last_checked_at = ?
       WHERE id = ?`,
      err.message, new Date().toISOString(), account.id,
    );
  } finally {
    try { await adapter.disconnect(); } catch { /* ignore */ }
  }
}

async function processMessage(
  account: EmailAccountRow,
  adapter: MailboxAdapter,
  msg: InboundMessage,
  tag: string,
): Promise<void> {
  // (a) Idempotency check
  const already = await dbGet(
    `SELECT id FROM email_messages WHERE tenant_id = ? AND rfc822_message_id = ?`,
    account.tenant_id, msg.rfc822MessageId,
  );
  if (already) {
    console.log(`${tag} skip duplicate ${msg.rfc822MessageId}`);
    await adapter.moveMessage(msg.providerRef, account.answered_folder);
    return;
  }

  // (b) Safety checks
  const skipReason = safetyCheck(msg, account.email_address);
  if (skipReason) {
    console.log(`${tag} skip safety (${skipReason}): ${msg.rfc822MessageId}`);
    await dbRun(
      `INSERT INTO email_skipped_log (id, tenant_id, account_id, rfc822_message_id, from_address, subject, reason)
       VALUES (?,?,?,?,?,?,?)`,
      crypto.randomUUID(), account.tenant_id, account.id,
      msg.rfc822MessageId, msg.from.address, msg.subject, skipReason,
    );
    await adapter.moveMessage(msg.providerRef, account.failed_folder);
    return;
  }

  // (c) Clean body
  const cleanedBody = cleanBody(msg.bodyText, msg.bodyHtml);
  if (!cleanedBody.trim()) {
    console.log(`${tag} skip empty body: ${msg.rfc822MessageId}`);
    await adapter.moveMessage(msg.providerRef, account.failed_folder);
    return;
  }

  // (d) Find or create conversation
  const conversationId = await findOrCreateConversation(
    account.tenant_id, msg.from.address, msg.subject, msg,
  );

  // (e) Insert inbound email_messages row (UNIQUE fence — safe to race)
  const inboundId = crypto.randomUUID();
  try {
    await dbRun(
      `INSERT INTO email_messages
         (id, tenant_id, account_id, conversation_id, direction, rfc822_message_id,
          in_reply_to, references_header, from_address, from_name, to_address, subject,
          body_text, provider_ref)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      inboundId, account.tenant_id, account.id, conversationId, 'inbound',
      msg.rfc822MessageId, msg.inReplyTo ?? null, msg.references ?? null,
      msg.from.address, msg.from.name ?? null,
      msg.to[0]?.address ?? account.email_address,
      msg.subject, cleanedBody, msg.providerRef,
    );
  } catch (dupErr: any) {
    if (dupErr.message?.includes('UNIQUE') || dupErr.code === '23505') {
      // Race condition — another worker already processed this
      await adapter.moveMessage(msg.providerRef, account.answered_folder);
      return;
    }
    throw dupErr;
  }

  // Update conversation updated_at
  await dbRun(
    `UPDATE hotel_conversations SET updated_at = ? WHERE id = ?`,
    new Date().toISOString(), conversationId,
  );

  // (f) AI disabled → leave in watch folder (shows as pending in dashboard)
  if (!account.ai_enabled) {
    console.log(`${tag} AI disabled — message pending manual reply: ${msg.rfc822MessageId}`);
    return;
  }

  // (g) Call hotel agent
  console.log(`${tag} calling agent for ${msg.from.address}`);
  const reply = await runHotelAgent(
    cleanedBody,
    [],
    `email:${msg.from.address.toLowerCase()}`,
    account.tenant_id,
  );

  if (!reply) {
    await adapter.moveMessage(msg.providerRef, account.failed_folder);
    throw new Error('Agent returned empty reply');
  }

  // (h) Send reply
  const referencesChain = [msg.references, msg.rfc822MessageId].filter(Boolean).join(' ');
  const sendResult = await adapter.sendReply({
    to:                    msg.from,
    from:                  { address: account.email_address, name: account.display_name },
    subject:               msg.subject,
    bodyText:              reply,
    inReplyToMessageId:    msg.rfc822MessageId,
    referencesChain,
  });

  // (i) Append to Sent if adapter cannot do it automatically
  if (!adapter.capabilities.autoSavesSent && sendResult.rawMime) {
    try { await adapter.appendToSent(sendResult.rawMime, new Date()); } catch (e: any) {
      console.warn(`${tag} appendToSent failed (non-fatal):`, e.message);
    }
  }

  // (j) Insert outbound email_messages row
  await dbRun(
    `INSERT INTO email_messages
       (id, tenant_id, account_id, conversation_id, direction, rfc822_message_id,
        in_reply_to, references_header, from_address, from_name, to_address, subject, body_text, sent_message_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    crypto.randomUUID(), account.tenant_id, account.id, conversationId, 'outbound',
    sendResult.sentMessageId,
    msg.rfc822MessageId, referencesChain,
    account.email_address, account.display_name,
    msg.from.address,
    msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`,
    reply, sendResult.sentMessageId,
  );

  // (k) Move original to Answered
  await adapter.moveMessage(msg.providerRef, account.answered_folder);
  console.log(`${tag} ✅ replied and moved: ${msg.rfc822MessageId}`);
}

// ---------------------------------------------------------------------------
// Public — called from index.ts after runMigrations()
// ---------------------------------------------------------------------------
export function startEmailWorker(): void {
  cron.schedule('* * * * *', async () => {
    let accounts: EmailAccountRow[];
    try {
      accounts = (await dbAll(
        `SELECT * FROM tenant_email_accounts WHERE is_enabled = 1 ORDER BY last_checked_at ASC NULLS FIRST`,
      )) as unknown as EmailAccountRow[];
    } catch (e: any) {
      console.error('[EmailWorker] failed to load accounts:', e.message);
      return;
    }

    for (const account of accounts) {
      await processAccount(account).catch(e =>
        console.error(`[EmailWorker] unhandled error for ${account.email_address}:`, e.message),
      );
    }
  });
  console.log('📧 Email worker started (polling every 60s)');
}
