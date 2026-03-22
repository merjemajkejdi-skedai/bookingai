import { Router, type Request, type Response } from 'express';
import twilio from 'twilio';
import { runBookingAgent } from './agent.js';
import { getSession, updateSession } from './sessions.js';

export const whatsappRouter = Router();

const MessagingResponse = twilio.twiml.MessagingResponse;

whatsappRouter.post('/webhook', async (req: Request, res: Response) => {
  // Log everything — helps debug what Twilio is actually sending
  console.log('\n--- WEBHOOK HIT ---');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('-------------------');

  const { Body, From, ProfileName } = req.body as {
    Body: string;
    From: string;
    ProfileName: string;
  };

  const phone = From?.replace('whatsapp:', '') ?? 'unknown';
  const messageText = (Body ?? '').trim();

  console.log(`\n📱 Incoming WhatsApp from ${phone} (${ProfileName}): "${messageText}"`);

  // Acknowledge Twilio immediately
  const twiml = new MessagingResponse();
  res.setHeader('Content-Type', 'text/xml');
  res.send(twiml.toString());

  if (!messageText) {
    console.log('⚠️  Empty message body — skipping agent');
    return;
  }

  // Process with Claude in the background
  try {
    const history = getSession(phone);
    const reply = await runBookingAgent(messageText, history, phone);
    updateSession(phone, messageText, reply);

    console.log(`🤖 Agent reply: "${reply.slice(0, 120)}"`);

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886',
      to: From,
      body: reply,
    });

    console.log(`✅ Reply sent to ${phone}`);
  } catch (err: any) {
    console.error('❌ Agent error:', err?.message ?? err);
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886',
        to: From,
        body: "Sorry, I'm having a technical issue. Please try again in a moment.",
      });
    } catch (sendErr: any) {
      console.error('❌ Failed to send error message:', sendErr?.message);
    }
  }
});

whatsappRouter.get('/webhook', (_req: Request, res: Response) => {
  res.sendStatus(200);
});

whatsappRouter.post('/send', async (req: Request, res: Response) => {
  const { to, message } = req.body as { to: string; message: string };
  if (!to || !message) {
    return res.status(400).json({ success: false, error: 'to and message are required' });
  }
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const msg = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886',
      to: `whatsapp:${to}`,
      body: message,
    });
    res.json({ success: true, sid: msg.sid });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
