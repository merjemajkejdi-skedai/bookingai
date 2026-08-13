// Strip quoted history, signatures, and mobile footers from inbound email bodies.
// Returns cleaned plain text ready to send to the AI agent.

const QUOTE_PATTERNS = [
  // "On Mon, Jan 1 2024, John wrote:" (common Gmail / Outlook prefix)
  /^On .{5,80} wrote:\s*$/m,
  // "> " quote lines
  /^>+.*/m,
  // "From: / Sent: / To: / Subject:" reply header block
  /^(From|Sent|To|Subject):\s+.+/m,
  // "--- Original message ---" or "______" divider
  /^[-_]{3,}\s*(Original (Message|Email)|Forwarded Message)\s*[-_]*/im,
  // Outlook-style "-----Original Message-----"
  /^-{5}Original Message-{5}/m,
  // Outlook underscore separator line
  /^_{16,}/m,
];

const SIGNATURE_PATTERNS = [
  // RFC 3676 signature delimiter: "-- " (two dashes, space)
  /^-- $/m,
  // Variant: "--" (two dashes, no space) on its own line
  /^--$/m,
  // "Sent from my iPhone / Android / Samsung"
  /^Sent from my .{3,40}$/m,
  // "Get Outlook for iOS"
  /^Get Outlook for /im,
  // Contact block: lines starting with M:, E:, W:, T:, P: after a blank line
  /^\n[MEWTP]:\s+\S/m,
  // Valedictions: "Regards," / "Best," / "Sincerely," etc.
  /^(Regards|Best regards|Kind regards|Sincerely|Thanks|Cheers|Best|Thank you|Yours sincerely|Yours faithfully),?\s*$/im,
  // Outlook-style "________________________________" separator
  /^_{16,}$/m,
];

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export function cleanBody(bodyText: string | undefined, bodyHtml: string | undefined): string {
  let text = bodyText ?? (bodyHtml ? htmlToText(bodyHtml) : '');

  // Find the earliest cut point from quote/signature patterns
  let cutAt = text.length;
  for (const pattern of [...QUOTE_PATTERNS, ...SIGNATURE_PATTERNS]) {
    const match = pattern.exec(text);
    if (match && match.index < cutAt) cutAt = match.index;
  }

  text = text.slice(0, cutAt);

  // Collapse 3+ consecutive blank lines → 2
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}
