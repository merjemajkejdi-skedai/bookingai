import { alertError } from '../utils/errorMonitor.js';
import { decrypt } from '../utils/encryption.js';

export async function getMessengerSenderProfile(
  psid: string,
  pageAccessToken: string,
): Promise<{ name: string | null }> {
  try {
    const url = `https://graph.facebook.com/v21.0/${psid}?fields=name&access_token=${pageAccessToken}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[Messenger] Profile fetch failed ${response.status}:`, await response.text());
      return { name: null };
    }
    const data = await response.json() as any;
    return { name: data.name || null };
  } catch (err: any) {
    console.error(`[Messenger] Profile fetch error:`, err.message);
    return { name: null };
  }
}

export async function sendMessengerMessage(
  pageId: string,
  recipientPsid: string,
  text: string,
  encryptedToken: string,
): Promise<void> {
  const pageToken = decrypt(encryptedToken);

  console.log(`[Messenger] Sending to ${recipientPsid} via page ${pageId}`);

  const response = await fetch(
    `https://graph.facebook.com/v21.0/${pageId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pageToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientPsid },
        message: { text },
        messaging_type: 'RESPONSE',
      }),
    },
  );

  if (!response.ok) {
    const body = await response.json() as any;
    const error = new Error(`Messenger API ${response.status}: ${JSON.stringify(body?.error ?? body)}`);
    alertError(error, 'sendMessengerMessage', { recipientPsid, pageId });
    throw error;
  }

  console.log(`[Messenger] Sent successfully to ${recipientPsid}`);
}
