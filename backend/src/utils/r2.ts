import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { alertError } from './errorMonitor.js';

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
  try {
    const bucket = process.env.R2_BUCKET_NAME!;
    await getClient().send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
    const base = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
    return `${base}/${key}`;
  } catch (err: any) {
    alertError(err, 'uploadToR2', { key });
    throw err;
  }
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

export async function deleteTenantR2Files(tenantId: string): Promise<number> {
  if (!r2IsConfigured()) return 0;
  const bucket = process.env.R2_BUCKET_NAME!;
  const prefix = `${tenantId}/`;
  let totalDeleted = 0;
  let continuationToken: string | undefined;

  try {
    do {
      const listResult = await getClient().send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }));

      const objects = listResult.Contents ?? [];
      if (objects.length === 0) break;

      // Delete in batches (R2/S3 limit: 1000 per request)
      await getClient().send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objects.map(o => ({ Key: o.Key! })) },
      }));

      totalDeleted += objects.length;
      continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined;
    } while (continuationToken);

    if (totalDeleted > 0) {
      console.log(`[Admin] Deleted ${totalDeleted} R2 files for tenant ${tenantId}`);
    }
  } catch (err: any) {
    console.error(`[Admin] WARNING: R2 deletion failed for tenant ${tenantId}: ${err.message}`);
    console.error(`Files may remain in R2 under prefix: ${tenantId}/`);
  }

  return totalDeleted;
}
