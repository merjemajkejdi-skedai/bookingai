import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { decrypt } from '../../utils/encryption.js';
import type {
  MailboxAdapter, AdapterCapabilities, InboundMessage,
  SendReplyInput, SendReplyResult, FolderInfo, TestConnectionResult,
  EmailAccountRow,
} from './types.js';

export class ImapSmtpAdapter implements MailboxAdapter {
  readonly capabilities: AdapterCapabilities = { autoSavesSent: false };

  private account: EmailAccountRow;
  private imap: ImapFlow;

  constructor(account: EmailAccountRow) {
    this.account = account;
    this.imap = this.buildClient();
  }

  private buildClient(): ImapFlow {
    const password = this.account.imap_password_encrypted ? decrypt(this.account.imap_password_encrypted) : '';
    return new ImapFlow({
      host:    this.account.imap_host!,
      port:    this.account.imap_port ?? 993,
      secure:  !!this.account.imap_secure,
      auth: {
        user: this.account.imap_username ?? this.account.email_address,
        pass: password,
      },
      logger: false,
    });
  }

  private buildSmtp() {
    const enc = this.account.smtp_password_encrypted ?? this.account.imap_password_encrypted;
    const password = enc ? decrypt(enc) : '';
    return nodemailer.createTransport({
      host:   this.account.smtp_host!,
      port:   this.account.smtp_port ?? 587,
      secure: !!this.account.smtp_secure,
      auth: {
        user: this.account.smtp_username ?? this.account.imap_username ?? this.account.email_address,
        pass: password,
      },
    });
  }

  async connect(): Promise<void> {
    await this.imap.connect();
  }

  async disconnect(): Promise<void> {
    try { await this.imap.logout(); } catch { /* ignore */ }
  }

  async ensureFolder(folderPath: string): Promise<void> {
    try {
      await this.imap.mailboxCreate(folderPath);
    } catch {
      // already exists — imapflow throws when mailbox exists
    }
  }

  async listFolders(): Promise<FolderInfo[]> {
    const tree = await this.imap.list();
    return tree.map(m => ({ name: m.name, path: m.path }));
  }

  async fetchMessages(folderPath: string, limit = 20): Promise<InboundMessage[]> {
    const lock = await this.imap.getMailboxLock(folderPath);
    const results: InboundMessage[] = [];
    try {
      const uids: number[] = [];
      for await (const msg of this.imap.fetch('1:*', { uid: true })) {
        uids.push(msg.uid);
      }
      const toFetch = uids.slice(-limit);
      if (!toFetch.length) return [];

      for await (const msg of this.imap.fetch(toFetch.join(','), {
        uid: true,
        envelope: true,
        bodyStructure: true,
        source: true,
      }, { uid: true })) {
        const rawSource = msg.source ?? Buffer.alloc(0);
        const rawStr    = rawSource.toString('utf8');
        const envelope  = msg.envelope;

        // Headers string for safety checks and References header
        const headerEnd  = rawStr.indexOf('\r\n\r\n');
        const rawHeaders = headerEnd >= 0 ? rawStr.slice(0, headerEnd) : rawStr;

        // Parse MIME with mailparser — handles multipart, QP, base64, charsets
        let text: string | undefined;
        let html: string | undefined;
        try {
          const parsed = await simpleParser(rawSource);
          text = parsed.text || undefined;
          html = parsed.html || undefined;
        } catch (parseErr: any) {
          console.warn(`[Email] mailparser failed uid ${msg.uid}: ${parseErr.message} — using raw fallback`);
          text = rawStr;
        }

        // Calculate attachment sizes from bodyStructure
        const { attachmentCount, attachmentTotalBytes } = scanAttachments(msg.bodyStructure);

        const env = msg.envelope as any ?? {};
        results.push({
          providerRef:           `${folderPath}:${msg.uid}`,
          rfc822MessageId:       env.messageId ?? `<unknown-${msg.uid}>`,
          inReplyTo:             env.inReplyTo ?? undefined,
          references:            getHeader(rawHeaders, 'References') ?? undefined,
          from:                  { address: env.from?.[0]?.address ?? '', name: env.from?.[0]?.name ?? '' },
          to:                    (env.to ?? []).map((a: any) => ({ address: a.address ?? '', name: a.name ?? '' })),
          subject:               env.subject ?? '',
          bodyText:              text,
          bodyHtml:              html,
          rawSource,
          receivedAt:            env.date ? new Date(env.date) : new Date(),
          rawHeaders,
          attachmentCount,
          attachmentTotalBytes,
        });
      }
    } finally {
      lock.release();
    }
    return results;
  }

  async sendReply(input: SendReplyInput): Promise<SendReplyResult> {
    const transport = this.buildSmtp();
    const info = await transport.sendMail({
      from:       `"${input.from.name ?? ''}" <${input.from.address}>`,
      to:         `"${input.to.name ?? ''}" <${input.to.address}>`,
      subject:    input.subject.startsWith('Re:') ? input.subject : `Re: ${input.subject}`,
      text:       input.bodyText,
      inReplyTo:  input.inReplyToMessageId,
      references: input.referencesChain,
    });
    const sentMessageId: string = Array.isArray(info.messageId) ? info.messageId[0] : info.messageId;
    // Build raw MIME for APPEND to Sent
    const raw = await buildRawMime({
      from:       `"${input.from.name ?? ''}" <${input.from.address}>`,
      to:         `"${input.to.name ?? ''}" <${input.to.address}>`,
      subject:    input.subject.startsWith('Re:') ? input.subject : `Re: ${input.subject}`,
      text:       input.bodyText,
      inReplyTo:  input.inReplyToMessageId,
      references: input.referencesChain,
      messageId:  sentMessageId,
    });
    return { sentMessageId, rawMime: raw };
  }

  async appendToSent(rawMime: Buffer, sentAt?: Date): Promise<void> {
    const lock = await this.imap.getMailboxLock('Sent');
    try {
      await this.imap.append('Sent', rawMime, ['\\Seen'], sentAt);
    } finally {
      lock.release();
    }
  }

  async moveMessage(providerRef: string, destFolderPath: string): Promise<void> {
    const colon = providerRef.lastIndexOf(':');
    const uid = parseInt(providerRef.slice(colon + 1), 10);
    const srcFolder = providerRef.slice(0, colon);
    const lock = await this.imap.getMailboxLock(srcFolder);
    try {
      await this.imap.messageMove([uid], destFolderPath, { uid: true });
    } finally {
      lock.release();
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    let readAccess = false;
    let sendAccess = false;
    let folderAccess = false;
    let error: string | undefined;
    try {
      await this.imap.connect();
      readAccess = true;
      // Check if watch folder accessible
      try {
        const lock = await this.imap.getMailboxLock(this.account.watch_folder_path);
        lock.release();
        folderAccess = true;
      } catch (e: any) {
        // folder doesn't exist yet — we'll create it on first run, mark as partial ok
        folderAccess = false;
      }
      await this.imap.logout();
    } catch (e: any) {
      error = e.message;
    }
    // Test SMTP
    try {
      const transport = this.buildSmtp();
      await transport.verify();
      sendAccess = true;
    } catch (e: any) {
      error = error ?? e.message;
    }
    return { readAccess, sendAccess, folderAccess, error };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHeader(rawHeaders: string, name: string): string | undefined {
  const re = new RegExp(`^${name}:\\s*(.+)`, 'im');
  const m = re.exec(rawHeaders);
  return m?.[1]?.trim();
}


function scanAttachments(struct: any): { attachmentCount: number; attachmentTotalBytes: number } {
  if (!struct) return { attachmentCount: 0, attachmentTotalBytes: 0 };
  let count = 0;
  let bytes = 0;
  function walk(node: any) {
    if (!node) return;
    if (node.disposition === 'attachment') {
      count++;
      bytes += node.size ?? 0;
    }
    if (Array.isArray(node.childNodes)) node.childNodes.forEach(walk);
  }
  walk(struct);
  return { attachmentCount: count, attachmentTotalBytes: bytes };
}

async function buildRawMime(opts: {
  from: string; to: string; subject: string; text: string;
  inReplyTo: string; references: string; messageId: string;
}): Promise<Buffer> {
  const transport = nodemailer.createTransport({ streamTransport: true, newline: 'unix' });
  return new Promise((resolve, reject) => {
    transport.sendMail({
      from:       opts.from,
      to:         opts.to,
      subject:    opts.subject,
      text:       opts.text,
      inReplyTo:  opts.inReplyTo,
      references: opts.references,
      messageId:  opts.messageId,
    }, (err, info) => {
      if (err) return reject(err);
      const chunks: Buffer[] = [];
      (info.message as NodeJS.ReadableStream).on('data', (c: Buffer) => chunks.push(c));
      (info.message as NodeJS.ReadableStream).on('end', () => resolve(Buffer.concat(chunks)));
      (info.message as NodeJS.ReadableStream).on('error', reject);
    });
  });
}
