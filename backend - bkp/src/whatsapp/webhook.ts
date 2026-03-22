import { Router, type Request, type Response } from 'express';
import twilio from 'twilio';
import { runBookingAgent } from './agent.js';
import { getSession, updateSession } from './sessions.js';

export const whatsappRouter = Router();

const MessagingResponse = twilio.twiml.MessagingResponse;

// ---------------------------------------------------------------------------
// POST /whatsapp/webhook
// Twilio sends every incoming WhatsApp message here as a form POST.
// We reply with TwiML (XML) telling Twilio what to send back.
// ---------------------------------------------------------------------------
whatsappRouter.post('/webhook', async (req: Request, res: Response) => {
  const { Body, From, ProfileName } = req.body as {
    Body: string;
    From: string;       // e.g. "whatsapp:+355691234567"
    ProfileName: string; // Customer's WhatsApp display name
  };

  // Strip the "whatsapp:" prefix for storage and display
  const phone = From?.replace('whatsapp:', '') ?? 'unknown';
  const messageText = (Body ?? '').trim();

  console.log(`\n📱 Incoming WhatsApp from ${phone} (${ProfileName}): "${messageText}"`);

  const twiml = new MessagingResponse();

  try {
    // Load conversation history for this phone number
    const history = getSession(phone);

    // Run the Claude booking agent
    const reply = await runBookingAgent(messageText, history, phone);

    // Save this turn to session history
    updateSession(phone, messageText, reply);

    console.log(`🤖 Agent reply: "${reply.slice(0, 100)}..."`);

    twiml.message(reply);
  } catch (err: any) {
    console.error('❌ Agent error:', err?.message ?? err);
    twiml.message("Sorry, I'm having a technical issue right now. Please try again in a moment.");
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// ---------------------------------------------------------------------------
// GET /whatsapp/webhook — Twilio sandbox verification (just returns 200)
// ---------------------------------------------------------------------------
whatsappRouter.get('/webhook', (_req: Request, res: Response) => {
  res.sendStatus(200);
});

// ---------------------------------------------------------------------------
// POST /whatsapp/send — manually send a WhatsApp message (for testing)
// Body: { to: "+355...", message: "Hello!" }
// ---------------------------------------------------------------------------
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
