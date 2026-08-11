// ---------------------------------------------------------------------------
// Email channel — shared types and MailboxAdapter interface
// ---------------------------------------------------------------------------

export interface EmailAddress {
  address: string;
  name?: string;
}

export interface InboundMessage {
  providerRef: string;          // opaque handle — IMAP: "folderPath:uid", Graph: message id
  rfc822MessageId: string;      // value of Message-ID header
  inReplyTo?: string;           // In-Reply-To header
  references?: string;          // References header
  from: EmailAddress;
  to: EmailAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  receivedAt: Date;
  rawHeaders: string;           // full raw headers for safety checks
  attachmentCount: number;
  attachmentTotalBytes: number;
}

export interface SendReplyInput {
  to: EmailAddress;
  from: EmailAddress;           // mailbox address + display name
  subject: string;
  bodyText: string;
  inReplyToMessageId: string;   // original Message-ID for In-Reply-To header
  referencesChain: string;      // existing References + original Message-ID
}

export interface SendReplyResult {
  sentMessageId: string;        // the new Message-ID
  rawMime?: Buffer;             // present when adapter cannot auto-save to Sent
}

export interface AdapterCapabilities {
  autoSavesSent: boolean;       // Graph saves to Sent automatically; IMAP must APPEND
}

export interface FolderInfo {
  name: string;
  path: string;
}

export interface TestConnectionResult {
  readAccess: boolean;
  sendAccess: boolean;
  folderAccess: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// The contract every adapter must implement.
// connect() / disconnect() bracket each polling cycle.
// ---------------------------------------------------------------------------
export interface MailboxAdapter {
  readonly capabilities: AdapterCapabilities;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  ensureFolder(path: string): Promise<void>;
  listFolders(): Promise<FolderInfo[]>;

  fetchMessages(folderPath: string, limit?: number): Promise<InboundMessage[]>;
  sendReply(input: SendReplyInput): Promise<SendReplyResult>;
  appendToSent(rawMime: Buffer, sentAt?: Date): Promise<void>;
  moveMessage(providerRef: string, destFolderPath: string): Promise<void>;

  testConnection(): Promise<TestConnectionResult>;
}

// ---------------------------------------------------------------------------
// DB row shape for tenant_email_accounts
// ---------------------------------------------------------------------------
export interface EmailAccountRow {
  id: string;
  tenant_id: string;
  provider: 'imap' | 'graph';
  email_address: string;
  display_name: string;
  imap_host?: string;
  imap_port?: number;
  imap_secure?: number;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: number;
  username?: string;
  password_enc?: string;
  oauth_access_token_enc?: string;
  oauth_refresh_token_enc?: string;
  oauth_expires_at?: string;
  oauth_email?: string;
  watch_folder: string;
  answered_folder: string;
  failed_folder: string;
  is_enabled: number;
  ai_enabled: number;
  consecutive_failures: number;
  last_error?: string;
  last_checked_at?: string;
  created_at: string;
}
