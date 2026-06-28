import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT!,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return _client;
}

export async function uploadToR2(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const bucket = process.env.R2_BUCKET_NAME!;
  await getClient().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  const base = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
  return `${base}/${key}`;
}

export async function deleteFromR2(urlOrKey: string): Promise<void> {
  const bucket = process.env.R2_BUCKET_NAME!;
  const base   = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
  const key    = base && urlOrKey.startsWith(base)
    ? urlOrKey.slice(base.length + 1)
    : urlOrKey;
  try {
    await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (e: any) {
    console.warn('[R2] delete failed:', e.message);
  }
}

export function isR2Url(url: string | null | undefined): boolean {
  if (!url) return false;
  const base = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
  return !!base && url.startsWith(base);
}

export function r2IsConfigured(): boolean {
  return !!(
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_ENDPOINT &&
    process.env.R2_BUCKET_NAME &&
    process.env.R2_PUBLIC_URL
  );
}
