import { Resend } from 'resend';

const COOLDOWN_MS  = 3_600_000; // 1 hour
const ALERT_EMAIL  = 'Merjemajkejdi@gmail.com';
const FROM_EMAIL   = 'alerts@skedai.net';

const alertCooldowns = new Map<string, number>();

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

function getErrorFingerprint(err: unknown, context?: string): string {
  const type = err instanceof Error ? err.constructor.name : 'UnknownError';
  const stack = err instanceof Error ? (err.stack ?? '') : '';
  const appFrame = stack
    .split('\n')
    .find(line => line.includes('/src/') || line.includes('\\src\\'));
  const location = appFrame
    ? appFrame.replace(/.*at\s+/, '').trim().slice(0, 120)
    : 'unknown';
  return `${type}:${location}:${context ?? ''}`;
}

function shouldAlert(fingerprint: string): boolean {
  const last = alertCooldowns.get(fingerprint);
  if (last !== undefined && Date.now() - last < COOLDOWN_MS) return false;
  alertCooldowns.set(fingerprint, Date.now());
  return true;
}

export function cleanupCooldowns(): void {
  const cutoff = Date.now() - COOLDOWN_MS * 2;
  for (const [key, ts] of alertCooldowns) {
    if (ts < cutoff) alertCooldowns.delete(key);
  }
}

export async function alertError(
  err:      unknown,
  context?: string,
  extra?:   Record<string, unknown>,
): Promise<void> {
  try {
    const fingerprint = getErrorFingerprint(err, context);
    if (!shouldAlert(fingerprint)) return;

    const message  = err instanceof Error ? err.message : String(err);
    const stack    = err instanceof Error ? (err.stack ?? '') : '';
    const now      = new Date().toISOString();

    const extraLines = extra
      ? Object.entries(extra).map(([k, v]) => `<tr><td>${k}</td><td><pre>${String(v)}</pre></td></tr>`).join('')
      : '';

    const html = `
<h2 style="color:#cc0000">🚨 BookingAI Server Error</h2>
<table border="1" cellpadding="6" style="border-collapse:collapse;font-family:monospace">
  <tr><td><b>Time</b></td><td>${now}</td></tr>
  <tr><td><b>Context</b></td><td>${context ?? '—'}</td></tr>
  <tr><td><b>Error</b></td><td>${message}</td></tr>
  ${extraLines}
</table>
<h3>Stack trace</h3>
<pre style="background:#f4f4f4;padding:12px;font-size:12px">${stack}</pre>
`;

    await getResend().emails.send({
      from:    FROM_EMAIL,
      to:      ALERT_EMAIL,
      subject: `[BookingAI] ${context ? context + ': ' : ''}${message.slice(0, 80)}`,
      html,
    });
  } catch {
    // Never let the alerting system crash the server
  }
}
