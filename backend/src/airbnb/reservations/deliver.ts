// Delivers a listing's check-in instructions over a conversation's channel.
//
// WhatsApp doesn't render rich text, so instructions are stored as an ordered
// list of blocks and sent as a sequence of messages in that order: text
// blocks as text messages, photo blocks as image sends.
import { sendWhatsAppMessage, sendWhatsAppMedia } from '../../whatsapp/twilio.js';
import { sendInstagramMessage } from '../../channels/instagram.js';
import { sendMessengerMessage } from '../../channels/messenger.js';

export type InstructionBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; caption?: string };

const MAX_TEXT_CHARS = 3500;      // WhatsApp caps a message at 4096; leave headroom
const INTER_MESSAGE_DELAY_MS = 700; // keeps text/image sends in order on the receiving end

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// The column is JSONB but may arrive as a string on some drivers/paths.
export function parseBlocks(raw: unknown): InstructionBlock[] {
  let value = raw;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return []; } }
  if (!Array.isArray(value)) return [];
  const out: InstructionBlock[] = [];
  for (const b of value as any[]) {
    if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      out.push({ type: 'text', text: b.text });
    } else if (b?.type === 'image' && typeof b.url === 'string' && /^https?:\/\//.test(b.url)) {
      out.push({ type: 'image', url: b.url, caption: typeof b.caption === 'string' ? b.caption : undefined });
    }
  }
  return out;
}

function chunkText(text: string): string[] {
  if (text.length <= MAX_TEXT_CHARS) return [text.trim()];
  const chunks: string[] = [];
  let current = '';
  for (const para of text.split(/\n{2,}/)) {
    if ((current + '\n\n' + para).length > MAX_TEXT_CHARS && current) { chunks.push(current.trim()); current = para; }
    else current = current ? `${current}\n\n${para}` : para;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.flatMap(c => c.length <= MAX_TEXT_CHARS ? [c] : c.match(new RegExp(`[\\s\\S]{1,${MAX_TEXT_CHARS}}`, 'g')) ?? []);
}

/** Sends every block in order. Throws on the first failed send. */
export async function sendInstructionBlocks(
  tenant: any,
  conv: { channel: string; channel_user_id: string },
  blocks: InstructionBlock[],
): Promise<void> {
  const channel = (conv.channel || 'whatsapp').toLowerCase();
  const to = conv.channel_user_id;

  const sendText = async (text: string) => {
    if (channel === 'whatsapp') return sendWhatsAppMessage(to, text, tenant);
    if (channel === 'instagram') {
      if (!tenant?.ig_access_token) throw new Error('Instagram not connected');
      return sendInstagramMessage(to, text, tenant.ig_access_token);
    }
    if (channel === 'messenger' || channel === 'facebook') {
      if (!tenant?.messenger_access_token_encrypted || !tenant?.messenger_page_id) throw new Error('Messenger not connected');
      return sendMessengerMessage(tenant.messenger_page_id, to, text, tenant.messenger_access_token_encrypted);
    }
    throw new Error(`Unsupported channel: ${channel}`);
  };

  let first = true;
  for (const block of blocks) {
    if (!first) await sleep(INTER_MESSAGE_DELAY_MS);
    first = false;

    if (block.type === 'text') {
      const chunks = chunkText(block.text);
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) await sleep(INTER_MESSAGE_DELAY_MS);
        await sendText(chunks[i]);
      }
    } else if (channel === 'whatsapp') {
      await sendWhatsAppMedia(to, block.url, block.caption || '', tenant);
    } else {
      // Instagram/Messenger: no shared media-send helper here — send the photo as a link.
      await sendText(block.caption ? `${block.caption}\n${block.url}` : block.url);
    }
  }
}
