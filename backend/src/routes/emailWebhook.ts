import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { processInboundReviewEmail } from '../reviews/reviewProcessor.js';

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
