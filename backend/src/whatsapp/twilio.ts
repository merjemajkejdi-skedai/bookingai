import twilio from 'twilio';

export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set');

  const from = process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886';
  const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

  const client = twilio(sid, token);
  await client.messages.create({ from, to: toFormatted, body });
}
