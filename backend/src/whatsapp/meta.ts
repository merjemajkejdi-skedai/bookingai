/**
 * Meta Cloud API utilities — send messages and download media.
 * Used when tenant.provider === 'meta'.
 */

export async function sendViaMeta(
  to:     string,
  body:   string,
  tenant: any,
): Promise<void> {
  const phoneNumberId = tenant.meta_phone_number_id;
  const accessToken   = tenant.meta_access_token;

  if (!phoneNumberId || !accessToken) {
    throw new Error('Meta credentials not configured for tenant');
  }

  const cleanTo = to.replace(/[^0-9]/g, '');

  const response = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to:                cleanTo,
        type:              'text',
        text:              { body },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json() as any;
    throw new Error(`Meta send failed: ${error.error?.message || response.status}`);
  }

  const result = await response.json() as any;
  console.log(`[Meta] ✅ Sent to ${cleanTo}: ${result.messages?.[0]?.id}`);
}

export async function sendMetaTemplate(
  to:           string,
  templateName: string,
  components:   any[],
  tenant:       any,
): Promise<void> {
  const phoneNumberId = tenant.meta_phone_number_id;
  const accessToken   = tenant.meta_access_token;
  const cleanTo       = to.replace(/[^0-9]/g, '');

  const response = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:                cleanTo,
        type:              'template',
        template: {
          name:       templateName,
          language:   { code: 'en_US' },
          components,
        },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json() as any;
    throw new Error(`Meta template send failed: ${error.error?.message}`);
  }

  console.log(`[Meta] ✅ Template sent to ${cleanTo}`);
}

export async function downloadMetaMedia(
  mediaId:     string,
  accessToken: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const urlRes = await fetch(
      `https://graph.facebook.com/v21.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!urlRes.ok) throw new Error(`Media URL fetch failed: ${urlRes.status}`);
    const { url } = await urlRes.json() as any;

    const mediaRes = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!mediaRes.ok) throw new Error(`Media download failed: ${mediaRes.status}`);

    const buffer   = Buffer.from(await mediaRes.arrayBuffer());
    const mimeType = mediaRes.headers.get('content-type') || 'image/jpeg';

    return { buffer, mimeType };
  } catch (err: any) {
    console.error('[Meta] Media download failed:', err.message);
    return null;
  }
}
