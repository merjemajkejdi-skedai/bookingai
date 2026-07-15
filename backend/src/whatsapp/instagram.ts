import { alertError } from '../utils/errorMonitor.js';

export async function getInstagramSenderProfile(
  senderId: string,
  accessToken: string,
): Promise<{ name: string | null; username: string | null }> {
  try {
    const url = `https://graph.facebook.com/v19.0/${senderId}?fields=name,username&access_token=${accessToken}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[Instagram] Failed to fetch profile for ${senderId}: ${response.status}`);
      return { name: null, username: null };
    }
    const data = await response.json() as any;
    return { name: data.name || null, username: data.username || null };
  } catch (err: any) {
    console.error(`[Instagram] Profile fetch error:`, err.message);
    return { name: null, username: null };
  }
}

export async function sendInstagramMessage(
  recipientId: string,
  message: string,
  accessToken: string,
): Promise<void> {
  try {
    const response = await fetch('https://graph.facebook.com/v19.0/me/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient:      { id: recipientId },
        message:        { text: message },
        messaging_type: 'RESPONSE',
      }),
    });

    if (!response.ok) {
      const body = await response.json() as any;
      throw new Error(`Instagram API ${response.status}: ${JSON.stringify(body?.error ?? body)}`);
    }

    console.log(`[Instagram] ✅ Sent to ${recipientId}`);
  } catch (err: any) {
    alertError(err, 'sendInstagramMessage', { recipientId });
    throw err;
  }
}
