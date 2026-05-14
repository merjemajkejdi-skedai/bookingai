import twilio from 'twilio';

// ── Send via Twilio ───────────────────────────────────────────────────────────
// Client is created per-call so tenant-specific credentials can be used.
// Falls back to global env vars for tenants without their own credentials.

async function sendViaTwilio(
  to: string,
  message: string,
  fromNumber: string,
  tenant?: any,
): Promise<void> {
  const accountSid = tenant?.twilio_account_sid || process.env.TWILIO_ACCOUNT_SID;
  const authToken  = tenant?.twilio_auth_token  || process.env.TWILIO_AUTH_TOKEN;

  const client  = twilio(accountSid, authToken);
  const toNum   = to.startsWith('whatsapp:')        ? to         : `whatsapp:${to}`;
  const fromNum = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;

  await client.messages.create({ body: message, from: fromNum, to: toNum });
}

// ── Send via Meta Cloud API ───────────────────────────────────────────────────

async function sendViaMeta(to: string, message: string, tenant: any): Promise<void> {
  // Meta API expects the phone without +, spaces, or whatsapp: prefix
  const phone = to.replace('whatsapp:', '').replace('+', '').replace(/\s/g, '');

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${tenant.meta_phone_number_id}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tenant.meta_access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to:                phone,
        type:              'text',
        text:              { body: message },
      }),
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('[Meta send error]', JSON.stringify(err));
    throw new Error(`Meta API error: ${(err as any)?.error?.message ?? res.status}`);
  }
}

// ── Unified send — routes to Twilio or Meta based on tenant.provider ──────────
// tenantOrFromNumber can be:
//   - undefined / omitted   → Twilio with global env vars + TWILIO_WHATSAPP_FROM
//   - a string              → Twilio with that string as from-number (legacy callers)
//   - a tenant object       → use tenant.provider; tenant credentials if present

export async function sendWhatsAppMessage(
  to: string,
  message: string,
  tenantOrFromNumber?: any,
): Promise<void> {
  try {
    if (typeof tenantOrFromNumber === 'string' || tenantOrFromNumber === undefined) {
      // Legacy / simple call — Twilio with global credentials
      const fromNumber =
        typeof tenantOrFromNumber === 'string'
          ? tenantOrFromNumber
          : (process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886');
      await sendViaTwilio(to, message, fromNumber);
      return;
    }

    // Tenant object — route by provider
    const tenant = tenantOrFromNumber;
    if (tenant?.provider === 'meta') {
      await sendViaMeta(to, message, tenant);
    } else {
      // Twilio — use tenant's WhatsApp number; tenant credentials if set
      const fromNumber =
        tenant?.whatsapp_number ||
        process.env.TWILIO_WHATSAPP_FROM ||
        'whatsapp:+14155238886';
      await sendViaTwilio(to, message, fromNumber, tenant);
    }
  } catch (err) {
    console.error('[sendWhatsAppMessage error]', err);
    throw err;
  }
}
