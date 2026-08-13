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
  rawSource?: Buffer;           // full raw RFC-822 source (IMAP only); stored as body_raw
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
  imap_secure?: boolean;
  imap_username?: string;
  imap_password_encrypted?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_username?: string;
  smtp_password_encrypted?: string;
  oauth_access_token_encrypted?: string;
  oauth_refresh_token_encrypted?: string;
  oauth_expires_at?: string;
  oauth_scope?: string;
  watch_folder_path: string;
  watch_folder_ref?: string;
  answered_folder_path: string;
  answered_folder_ref?: string;
  failed_folder_path: string;
  failed_folder_ref?: string;
  sent_folder_path: string;
  sent_folder_ref?: string;
  is_enabled: boolean;
  ai_enabled: boolean;
  consecutive_failures: number;
  last_error?: string;
  last_checked_at?: string;
  last_success_at?: string;
  created_at: string;
  updated_at: string;
}
