import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
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
        const raw = msg.source?.toString('utf8') ?? '';
        const envelope = msg.envelope;

        // Split raw into headers + body sections by blank line
        const headerEnd = raw.indexOf('\r\n\r\n');
        const rawHeaders = headerEnd >= 0 ? raw.slice(0, headerEnd) : raw;
        const rawBody    = headerEnd >= 0 ? raw.slice(headerEnd + 4) : '';

        // Extract plain text part from body (basic MIME extraction)
        const { text, html } = extractTextParts(rawBody, rawHeaders);

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

function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r\n/g, '')
    .replace(/=\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeTransferEncoding(body: string, encoding: string): string {
  const enc = encoding.toLowerCase().trim();
  if (enc === 'quoted-printable') return decodeQuotedPrintable(body);
  if (enc === 'base64') {
    try { return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8'); } catch { return body; }
  }
  return body;
}

function extractTextParts(rawBody: string, rawHeaders: string): { text?: string; html?: string } {
  const contentType = getHeader(rawHeaders, 'Content-Type') ?? '';
  const encoding    = getHeader(rawHeaders, 'Content-Transfer-Encoding') ?? '';

  if (!contentType.toLowerCase().includes('multipart')) {
    const decoded = decodeTransferEncoding(rawBody, encoding);
    if (contentType.toLowerCase().includes('text/html')) return { html: decoded };
    return { text: decoded };
  }

  const boundaryMatch = /boundary="?([^";\r\n]+)"?/i.exec(contentType);
  if (!boundaryMatch) return { text: rawBody };
  const boundary = boundaryMatch[1].trim();

  const parts = rawBody.split(`--${boundary}`);
  let text: string | undefined;
  let html: string | undefined;

  for (const part of parts) {
    // Skip preamble, epilogue, and the closing --boundary-- marker
    if (part.trim() === '' || part.trimStart().startsWith('--')) continue;

    const sep = part.indexOf('\r\n\r\n');
    if (sep < 0) continue;
    const partHeaders = part.slice(0, sep);
    const partBody    = part.slice(sep + 4).replace(/\r\n$/, ''); // strip trailing CRLF

    const partCt  = (getHeader(partHeaders, 'Content-Type') ?? '').toLowerCase();
    const partEnc = getHeader(partHeaders, 'Content-Transfer-Encoding') ?? '';

    if (partCt.startsWith('multipart/')) {
      const inner = extractTextParts(partBody, partHeaders);
      if (!text && inner.text) text = inner.text;
      if (!html  && inner.html) html = inner.html;
    } else if (partCt.startsWith('text/plain') && !text) {
      text = decodeTransferEncoding(partBody, partEnc).trim();
    } else if (partCt.startsWith('text/html') && !html) {
      html = decodeTransferEncoding(partBody, partEnc).trim();
    }
  }
  return { text, html };
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
