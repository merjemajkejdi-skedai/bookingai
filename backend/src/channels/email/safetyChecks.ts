// 10 safety checks that must all pass before the worker processes a message.
// Returns null if safe, or a short reason string if it should be skipped.

import type { InboundMessage } from './types.js';

const NO_REPLY_PATTERN = /^(no.?reply|noreply|do.not.reply|mailer.daemon|postmaster|bounce|notifications?|alerts?|auto.?reply|automated)/i;

const BLOCKED_DOMAINS = new Set([
  'mailer-daemon.googlemail.com',
  'amazonses.com',
  'bounce.mail',
]);

export function safetyCheck(msg: InboundMessage, ownAddress: string): string | null {
  const headers = msg.rawHeaders.toLowerCase();
  const from = msg.from.address.toLowerCase();

  // 1. Auto-Submitted header (RFC 3834)
  if (/^auto-submitted:\s*(auto-generated|auto-replied)/m.test(headers)) {
    return 'auto-submitted header';
  }

  // 2. X-Autoreply header
  if (/^x-autoreply:\s*yes/m.test(headers)) {
    return 'x-autoreply header';
  }

  // 3. Precedence: bulk / list / junk
  if (/^precedence:\s*(bulk|list|junk)/m.test(headers)) {
    return 'precedence bulk/list/junk';
  }

  // 4. List-Unsubscribe header (mailing list indicator)
  if (/^list-unsubscribe:/m.test(headers)) {
    return 'list-unsubscribe header (mailing list)';
  }

  // 5. List-Id header
  if (/^list-id:/m.test(headers)) {
    return 'list-id header (mailing list)';
  }

  // 6. no-reply@ address pattern
  if (NO_REPLY_PATTERN.test(from.split('@')[0])) {
    return `no-reply sender: ${from}`;
  }

  // 7. Self-loop (from our own mailbox)
  if (from === ownAddress.toLowerCase()) {
    return 'self-loop (from own address)';
  }

  // 8. Blocked domain
  const domain = from.split('@')[1] ?? '';
  if (BLOCKED_DOMAINS.has(domain)) {
    return `blocked domain: ${domain}`;
  }

  // 9. Oversized attachments (> 25 MB)
  if (msg.attachmentTotalBytes > 25 * 1024 * 1024) {
    return 'attachment total > 25 MB';
  }

  return null;
}
