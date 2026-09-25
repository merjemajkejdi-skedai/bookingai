import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { processInboundReviewEmail } from '../reviews/reviewProcessor.js';
import { handleReservationEmail } from '../airbnb/reservations/ingest.js';

export const emailWebhookRouter = Router();

const upload = multer({ storage: multer.memoryStorage() });

// POST /webhooks/email  — Mailgun inbound webhook
emailWebhookRouter.post('/webhooks/email', upload.any(), async (req, res) => {
  // Respond 200 immediately — Mailgun will retry if it doesn't get a 2xx quickly
  res.status(200).json({ status: 'ok' });

  try {
    // ── Mailgun signature verification ──────────────────────────────────────
    const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
    if (signingKey) {
      const timestamp: string = req.body.timestamp ?? '';
      const token: string = req.body.token ?? '';
      const signature: string = req.body.signature ?? '';

      const expectedHash = crypto
        .createHmac('sha256', signingKey)
        .update(timestamp + token)
        .digest('hex');

      if (expectedHash !== signature) {
        console.warn('[Email webhook] Mailgun signature verification failed — ignoring request');
        return;
      }
    }

    // ── Extract fields ───────────────────────────────────────────────────────
    const from: string = req.body.from || req.body.sender || '';
    const subject: string = req.body.subject || '';
    const body: string =
      req.body['body-plain'] ||
      req.body.text ||
      req.body['body-stripped'] ||
      '';
    const recipient: string =
      req.body.recipient || req.body.To || req.body.to || '';
    const rawEmail: string = req.body['body-mime'] || body;

    // ── Airbnb reservation emails ────────────────────────────────────────────
    // Consumed only when the recipient is a listing's forwarding address;
    // anything else falls through to the hotel-review handler untouched.
    const htmlBody: string = req.body['body-html'] || '';
    // The message's own Date header (Mailgun sends headers as a JSON array of
    // [name, value] pairs) — a year anchor of last resort for the parser.
    let sentAt: Date | null = null;
    try {
      const headers: [string, string][] = JSON.parse(req.body['message-headers'] || '[]');
      const dateHeader = headers.find(([k]) => k.toLowerCase() === 'date')?.[1];
      if (dateHeader) { const d = new Date(dateHeader); if (!Number.isNaN(d.getTime())) sentAt = d; }
    } catch { /* no usable headers — parser falls back to the forwarded block's own date */ }
    if (recipient && (body || htmlBody)) {
      const handled = await handleReservationEmail({ recipient, from, subject, textBody: body, htmlBody, sentAt })
        .catch((e: any) => { console.error('[Email webhook] reservation handler error:', e.message); return false; });
      if (handled) return;
    }

    // ── Basic validation ─────────────────────────────────────────────────────
    if (!body || !recipient) {
      console.warn('[Email webhook] Missing body or recipient — ignoring request', {
        from,
        recipient,
        bodyLength: body.length,
      });
      return;
    }

    // ── Process ──────────────────────────────────────────────────────────────
    await processInboundReviewEmail(from, subject, body, recipient, rawEmail);
  } catch (err) {
    console.error('[Email webhook error]', err);
  }
});
