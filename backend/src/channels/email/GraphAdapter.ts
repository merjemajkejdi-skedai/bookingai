import { Resend } from 'resend';
import { decrypt, encrypt } from '../../utils/encryption.js';
import { isPg, prepare, queryRun } from '../../db/database.js';
import type {
  MailboxAdapter, AdapterCapabilities, InboundMessage,
  SendReplyInput, SendReplyResult, FolderInfo, TestConnectionResult,
  EmailAccountRow,
} from './types.js';

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const GRAPH = 'https://graph.microsoft.com/v1.0/me';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const SCOPES = 'offline_access Mail.ReadWrite Mail.Send User.Read';

// Support both MICROSOFT_* (new) and MS_* (legacy) env var names
const clientId     = () => (process.env.MICROSOFT_CLIENT_ID     || process.env.MS_CLIENT_ID)!;
const clientSecret = () => (process.env.MICROSOFT_CLIENT_SECRET || process.env.MS_CLIENT_SECRET)!;
const redirectUri  = () => (process.env.MICROSOFT_REDIRECT_URI  || process.env.MS_REDIRECT_URI)!;

export class GraphAdapter implements MailboxAdapter {
  readonly capabilities: AdapterCapabilities = { autoSavesSent: true };

  private account: EmailAccountRow;
  private accessToken = '';
  private folderIdCache: Map<string, string> = new Map();

  constructor(account: EmailAccountRow) {
    this.account = account;
  }

  // ---------------------------------------------------------------------------
  // OAuth helpers
  // ---------------------------------------------------------------------------

  static authUrl(tenantId: string, nonce: string): string {
    const params = new URLSearchParams({
      client_id:     clientId(),
      response_type: 'code',
      redirect_uri:  redirectUri(),
      response_mode: 'query',
      scope:         SCOPES,
      state:         JSON.stringify({ tenantId, nonce }),
    });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
  }

  static async exchangeCode(code: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    id_token?: string;
  }> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId(),
        client_secret: clientSecret(),
        redirect_uri:  redirectUri(),
        grant_type:    'authorization_code',
        scope:         SCOPES,
        code,
      }),
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
    return res.json() as any;
  }

  private async refreshIfNeeded(): Promise<void> {
    if (!this.account.oauth_refresh_token_encrypted) throw new Error('No refresh token — re-connect account');
    const expiresAt = this.account.oauth_expires_at ? new Date(this.account.oauth_expires_at) : new Date(0);
    const needsRefresh = (expiresAt.getTime() - Date.now()) < 5 * 60 * 1000;
    if (!needsRefresh && this.account.oauth_access_token_encrypted) {
      this.accessToken = decrypt(this.account.oauth_access_token_encrypted);
      return;
    }
    const refreshToken = decrypt(this.account.oauth_refresh_token_encrypted);
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId(),
        client_secret: clientSecret(),
        grant_type:    'refresh_token',
        scope:         SCOPES,
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) {
      // Mark account so the UI shows a reconnect prompt
      const errSql = `UPDATE tenant_email_accounts SET last_error = 'oauth_refresh_failed', is_enabled = false WHERE id = ?`;
      if (isPg) queryRun(errSql, [this.account.id]); else prepare(errSql).run(this.account.id);
      throw new Error(`Token refresh failed: ${await res.text()}`);
    }
    const tokens: any = await res.json();
    this.accessToken = tokens.access_token;
    const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const sql = `UPDATE tenant_email_accounts SET oauth_access_token_encrypted = ?, oauth_expires_at = ?, last_error = NULL WHERE id = ?`;
    const params = [encrypt(tokens.access_token), newExpiry, this.account.id];
    if (isPg) queryRun(sql, params); else prepare(sql).run(...params);
  }

  private async gFetch(path: string, opts: RequestInit = {}): Promise<any> {
    const res = await fetch(`${GRAPH}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...(opts.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`Graph ${opts.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // Walk a path like 'SkedAI' or 'SkedAI/Answered' starting from Inbox.
  // Uses the Graph well-known folder name 'inbox' as the root so we search
  // inbox children, not top-level mailFolders (which would miss sub-folders).
  // Creates any missing level; caches each resolved ID by path segment.
  private async ensureHierarchy(folderPath: string): Promise<string> {
    if (this.folderIdCache.has(folderPath)) return this.folderIdCache.get(folderPath)!;

    const parts = folderPath.split('/').filter(Boolean);
    let parentId = 'inbox'; // Graph well-known folder name
    let accumulatedPath = '';

    for (const name of parts) {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${name}` : name;

      if (this.folderIdCache.has(accumulatedPath)) {
        parentId = this.folderIdCache.get(accumulatedPath)!;
        continue;
      }

      const children = await this.gFetch(
        `/mailFolders/${parentId}/childFolders?$select=id,displayName&$top=100`
      );
      const existing = (children?.value ?? []).find((f: any) => f.displayName === name);

      let id: string;
      if (existing) {
        id = existing.id;
      } else {
        const created = await this.gFetch(`/mailFolders/${parentId}/childFolders`, {
          method: 'POST',
          body: JSON.stringify({ displayName: name }),
        });
        id = created.id;
      }

      this.folderIdCache.set(accumulatedPath, id);
      parentId = id;
    }

    return parentId;
  }

  // ---------------------------------------------------------------------------
  // MailboxAdapter
  // ---------------------------------------------------------------------------

  async connect(): Promise<void> {
    await this.refreshIfNeeded();
    // Pre-resolve watch folder via Inbox children (not top-level mailFolders)
    const watchId = await this.ensureHierarchy(this.account.watch_folder_path);
    console.log(`[Email] ${this.account.email_address} — SkedAI folder ID: ${watchId}`);
    // Persist resolved ID so next cycle uses it directly
    if (this.account.watch_folder_ref !== watchId) {
      const sql = `UPDATE tenant_email_accounts SET watch_folder_ref = ? WHERE id = ?`;
      const params = [watchId, this.account.id];
      if (isPg) queryRun(sql, params); else prepare(sql).run(...params);
      this.account = { ...this.account, watch_folder_ref: watchId };
    }
  }

  async disconnect(): Promise<void> {
    // No persistent connection to close for Graph
  }

  async ensureFolder(folderPath: string): Promise<void> {
    await this.ensureHierarchy(folderPath); // creates all levels as Inbox children
  }

  async listFolders(): Promise<FolderInfo[]> {
    const data = await this.gFetch('/mailFolders?$select=id,displayName&$top=50');
    return (data?.value ?? []).map((f: any) => ({ name: f.displayName, path: f.displayName }));
  }

  async fetchMessages(folderPath: string, limit = 20): Promise<InboundMessage[]> {
    const folderId = await this.ensureHierarchy(folderPath);
    const fields = 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,internetMessageId,conversationId,internetMessageHeaders';
    const url = `${GRAPH}/mailFolders/${folderId}/messages?$top=${limit}&$select=${fields}`;
    console.log('[Email] Graph fetch URL:', url);
    console.log('[Email] Graph token expires:', this.account.oauth_expires_at);
    console.log('[Email] Graph token expired:', new Date() > new Date(this.account.oauth_expires_at ?? '0'));
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
    });
    console.log('[Email] Graph response status:', response.status);
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    console.log('[Email] Graph response body:', JSON.stringify(data).slice(0, 800));
    if (!response.ok) throw new Error(`Graph GET messages → ${response.status}: ${text}`);
    console.log(`[Email] ${this.account.email_address} — Graph returned ${data?.value?.length ?? 0} messages in folder`);
    const messages: InboundMessage[] = [];
    for (const m of data?.value ?? []) {
      const headers = (m.internetMessageHeaders ?? []).map((h: any) => `${h.name}: ${h.value}`).join('\r\n');
      const inReplyTo = (m.internetMessageHeaders ?? []).find((h: any) => h.name.toLowerCase() === 'in-reply-to')?.value;
      const references = (m.internetMessageHeaders ?? []).find((h: any) => h.name.toLowerCase() === 'references')?.value;
      messages.push({
        providerRef:           m.id,
        rfc822MessageId:       m.internetMessageId ?? `<graph-${m.id}>`,
        inReplyTo,
        references,
        from:                  { address: m.from?.emailAddress?.address ?? '', name: m.from?.emailAddress?.name ?? '' },
        to:                    (m.toRecipients ?? []).map((r: any) => ({ address: r.emailAddress?.address ?? '', name: r.emailAddress?.name ?? '' })),
        subject:               m.subject ?? '',
        bodyText:              m.body?.contentType === 'text' ? m.body.content : undefined,
        bodyHtml:              m.body?.contentType === 'html' ? m.body.content : undefined,
        receivedAt:            new Date(m.receivedDateTime),
        rawHeaders:            headers,
        attachmentCount:       m.hasAttachments ? 1 : 0,
        attachmentTotalBytes:  0,
      });
    }
    return messages;
  }

  async sendReply(input: SendReplyInput): Promise<SendReplyResult> {
    if ((this.account.send_mode ?? 'resend') === 'graph') {
      return this.sendViaGraph(input);
    }
    return this.sendViaResend(input);
  }

  private async sendViaGraph(input: SendReplyInput): Promise<SendReplyResult> {
    // 1. createReply draft (preserves conversation thread in Outlook)
    const draftEndpoint = input.inReplyToProviderRef
      ? `/messages/${input.inReplyToProviderRef}/createReply`
      : null;

    let draftId: string;
    if (draftEndpoint) {
      const draft = await this.gFetch(draftEndpoint, { method: 'POST', body: '{}' });
      draftId = draft.id;
      // 2. PATCH body text onto the draft
      await this.gFetch(`/messages/${draftId}`, {
        method: 'PATCH',
        body: JSON.stringify({ body: { contentType: 'Text', content: input.bodyText } }),
      });
    } else {
      // Fallback: compose new message (no original to thread from)
      const created = await this.gFetch('/messages', {
        method: 'POST',
        body: JSON.stringify({
          subject:    input.subject.startsWith('Re:') ? input.subject : `Re: ${input.subject}`,
          body: { contentType: 'Text', content: input.bodyText },
          toRecipients: [{ emailAddress: { address: input.to.address, name: input.to.name ?? '' } }],
          internetMessageHeaders: [
            { name: 'In-Reply-To', value: input.inReplyToMessageId },
            { name: 'References',  value: input.referencesChain },
          ],
        }),
      });
      draftId = created.id;
    }

    // 3. Send — Graph auto-saves to Sent Items
    await this.gFetch(`/messages/${draftId}/send`, { method: 'POST', body: '{}' });
    console.log(`[Email] ${this.account.email_address} — sent via Graph (draftId: ${draftId})`);
    const sentMessageId = `<graph-sent-${Date.now()}@skedai>`;
    return { sentMessageId, providerRef: draftId };
  }

  private async sendViaResend(input: SendReplyInput): Promise<SendReplyResult> {
    const senderName = this.account.display_name?.trim() || 'SkedAI';
    console.log(`[Email] Sending via Resend (Graph acct) — to: ${input.to.address} reply_to: ${this.account.email_address}`);
    const result = await getResend().emails.send({
      from:    `${senderName} <noreply@skedai.net>`,
      to:      input.to.address,
      replyTo: this.account.email_address,
      subject: input.subject.startsWith('Re:') ? input.subject : `Re: ${input.subject}`,
      text:    input.bodyText,
      headers: {
        'In-Reply-To': input.inReplyToMessageId,
        'References':  input.referencesChain,
      },
    });
    if (result.error || !result.data) throw new Error(`Resend send failed: ${result.error?.message ?? 'unknown error'}`);
    const sentMessageId = `<${result.data.id}@resend.dev>`;
    return { sentMessageId };
  }

  async appendToSent(_rawMime: Buffer, _sentAt?: Date): Promise<void> {
    // Graph saves to Sent automatically — no-op
  }

  async moveMessage(providerRef: string, destFolderPath: string): Promise<void> {
    const destId = await this.ensureHierarchy(destFolderPath);
    await this.gFetch(`/messages/${providerRef}/move`, {
      method: 'POST',
      body: JSON.stringify({ destinationId: destId }),
    });
  }

  async testConnection(): Promise<TestConnectionResult> {
    let readAccess = false;
    let sendAccess = false;
    let folderAccess = false;
    let error: string | undefined;
    try {
      await this.refreshIfNeeded();
      await this.gFetch('/mailFolders?$top=1');
      readAccess = true;
      sendAccess = true; // Graph Mail.Send scope grants send; we can't test without actually sending
      try {
        await this.ensureHierarchy(this.account.watch_folder_path);
        folderAccess = true;
      } catch { /* folder not created yet */ }
    } catch (e: any) {
      error = e.message;
    }
    return { readAccess, sendAccess, folderAccess, error };
  }
}
