import twilio from 'twilio';

export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const from = process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886';

  // Normalise — ensure whatsapp: prefix
  const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

  await client.messages.create({ from, to: toFormatted, body });
}
