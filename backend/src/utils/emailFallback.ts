export interface EmailFallbackParams {
  toEmail:           string;
  tenantName:        string;
  guestPhone:        string;
  guestName?:        string;
  guestMessage:      string;
  aiReply:           string;
  whatsappDelivered: boolean;
}

export async function sendEmailFallback(params: EmailFallbackParams): Promise<void> {
  const {
    toEmail, tenantName, guestPhone, guestName,
    guestMessage, aiReply, whatsappDelivered,
  } = params;

  const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY!;
  const MAILGUN_DOMAIN  = process.env.MAILGUN_DOMAIN || 'reviews.skedai.net';

  if (!MAILGUN_API_KEY) throw new Error('MAILGUN_API_KEY not set');

  const guestLabel = guestName ? `${guestName} (${guestPhone})` : guestPhone;

  const now = new Date().toLocaleString('en-GB', {
    timeZone: 'Europe/Tirane',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const waStatus = whatsappDelivered
    ? `<span style="color:#16a34a">✅ WhatsApp reply sent successfully</span>`
    : `<span style="color:#dc2626">❌ WhatsApp delivery FAILED — guest did not receive the reply</span>`;

  const whatsappLink = `https://wa.me/${guestPhone.replace(/[^0-9]/g, '')}`;

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:24px auto;background:white;border-radius:12px;
            overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <div style="background:#0D9488;padding:18px 24px;">
    <h2 style="color:white;margin:0;font-size:17px;font-weight:600;">
      📱 Guest Message — ${tenantName}
    </h2>
    <p style="color:rgba(255,255,255,0.75);margin:4px 0 0;font-size:13px;">${now}</p>
  </div>
  <div style="padding:24px;">
    <div style="margin-bottom:20px;">
      <p style="font-size:11px;color:#94a3b8;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.6px;font-weight:600;">From</p>
      <p style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 4px;">${guestLabel}</p>
      <a href="${whatsappLink}"
         style="display:inline-block;background:#25D366;color:white;text-decoration:none;
                padding:6px 14px;border-radius:6px;font-size:13px;font-weight:600;margin-top:4px;">
        💬 Reply on WhatsApp
      </a>
    </div>
    <div style="margin-bottom:16px;">
      <p style="font-size:11px;color:#94a3b8;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.6px;font-weight:600;">Guest message</p>
      <div style="background:#f8fafc;border-left:3px solid #94a3b8;border-radius:0 8px 8px 0;padding:14px 16px;">
        <p style="font-size:15px;color:#0f172a;margin:0;line-height:1.6;white-space:pre-wrap;">${guestMessage}</p>
      </div>
    </div>
    <div style="margin-bottom:16px;">
      <p style="font-size:11px;color:#94a3b8;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.6px;font-weight:600;">SkedAI reply</p>
      <div style="background:#f0fdf4;border-left:3px solid #0D9488;border-radius:0 8px 8px 0;padding:14px 16px;">
        <p style="font-size:15px;color:#0f172a;margin:0;line-height:1.6;white-space:pre-wrap;">${aiReply}</p>
      </div>
    </div>
    <div style="background:#f8fafc;border-radius:8px;padding:12px 16px;border:1px solid #e2e8f0;font-size:13px;">
      ${waStatus}
    </div>
    ${!whatsappDelivered ? `
    <div style="margin-top:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;">
      <p style="font-size:13px;color:#b91c1c;margin:0;font-weight:600;">⚠️ Action required</p>
      <p style="font-size:13px;color:#b91c1c;margin:6px 0 0;">
        The guest has NOT received any reply. Please contact them directly on WhatsApp: <strong>${guestPhone}</strong>
      </p>
    </div>
    ` : ''}
  </div>
  <div style="background:#f1f5f9;padding:12px 24px;border-top:1px solid #e2e8f0;">
    <p style="font-size:12px;color:#94a3b8;margin:0;text-align:center;">
      SkedAI · ${tenantName} · support@skedai.net
    </p>
  </div>
</div>
</body>
</html>
  `;

  const subject = whatsappDelivered
    ? `📱 [${tenantName}] Message from ${guestLabel}`
    : `⚠️ [${tenantName}] UNDELIVERED — Message from ${guestLabel}`;

  const formData = new URLSearchParams();
  formData.append('from',    `SkedAI <alerts@${MAILGUN_DOMAIN}>`);
  formData.append('to',      toEmail);
  formData.append('subject', subject);
  formData.append('html',    html);

  const credentials = Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64');

  const response = await fetch(
    `https://api.eu.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`,
    {
      method:  'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Mailgun API error: ${response.status} ${error}`);
  }

  console.log(`[Email fallback] ✅ Sent to ${toEmail} via Mailgun API`);
}
