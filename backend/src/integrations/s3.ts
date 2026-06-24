import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';

/**
 * S3 integration for the Project Documents feature.
 *
 * Lazy singleton — the client is constructed on first use rather than at
 * module load, so the backend can boot in environments where S3 isn't
 * configured (local dev, CI). Routes that need S3 call assertConfigured()
 * up-front and return a clean 503 if the bucket env var is missing,
 * rather than crashing midway through.
 *
 * Auth strategy:
 *   - When AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY are present, the SDK
 *     uses them directly. This is the Railway/prod path.
 *   - When they're absent, the SDK falls back to its default credential
 *     chain: env vars → shared config (~/.aws/credentials) → IAM instance
 *     profile. Lets us run against real S3 from a developer laptop with
 *     `aws sso login` without a backend-specific access key.
 */

let _client: S3Client | null = null;

/**
 * Throw a 503-shaped error when S3 isn't configured.  Routes call this
 * before any S3 work so the failure surfaces as a clean "feature not
 * configured" rather than mid-flight in the SDK.
 */
export function assertS3Configured(): void {
  if (!env.S3_DOCUMENTS_BUCKET) {
    const err: any = new Error('S3 is not configured: set S3_DOCUMENTS_BUCKET (and AWS_REGION) in env');
    err.code = 'S3_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }
}

export function getS3Client(): S3Client {
  if (_client) return _client;

  const credentials = env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined;

  _client = new S3Client({
    region: env.AWS_REGION,
    credentials, // undefined → default credential chain
  });
  return _client;
}

export const S3_BUCKET = () => env.S3_DOCUMENTS_BUCKET!; // safe after assertConfigured

/**
 * Compose the canonical S3 key for a project document.
 * Format `projects/<projectId>/<docId>/<filename>`:
 *   - `projects/<projectId>` prefix keeps per-project listings cheap.
 *   - `<docId>` prefix prevents filename collisions and lets us drop a
 *     single doc by deleting its prefix without touching siblings.
 *   - Filename preserved as-is (S3-safe characters only — sanitised by
 *     the service layer before this is called).
 */
export function buildDocumentS3Key(projectId: string, docId: string, filename: string) {
  return `projects/${projectId}/${docId}/${filename}`;
}

/**
 * Issue a presigned PUT URL the client uses to upload directly to S3.
 * Bytes never traverse the API server.
 *
 * `contentType` and `sizeBytes` are baked into the URL signature — a
 * client uploading something different gets a 403 from S3, so we can
 * trust them on the confirm step.
 */
export async function signUploadUrl(args: {
  key: string;
  contentType: string;
  sizeBytes: number;
}): Promise<string> {
  assertS3Configured();
  const cmd = new PutObjectCommand({
    Bucket: S3_BUCKET(),
    Key: args.key,
    ContentType: args.contentType,
    ContentLength: args.sizeBytes,
  });
  return getSignedUrl(getS3Client(), cmd, { expiresIn: env.S3_PRESIGNED_TTL_SECONDS });
}

/**
 * Canonical S3 key for a user's avatar: `avatars/<userId>/<random>.<ext>`.
 * The `<userId>` prefix lets the service verify a confirmed key actually
 * belongs to the uploading user, and scopes a future per-user cleanup.
 */
export function buildAvatarS3Key(userId: string, randomId: string, ext: string) {
  return `avatars/${userId}/${randomId}.${ext}`;
}

/**
 * Presigned GET URL for inline display (avatars). Unlike signDownloadUrl this
 * sets no attachment Content-Disposition — the browser renders the bytes in
 * an <img>. Short-lived (S3_PRESIGNED_TTL_SECONDS); the client re-fetches a
 * fresh one on each auth response, and the avatar UI falls back to initials
 * if one expires mid-session.
 */
export async function signInlineGetUrl(key: string): Promise<string> {
  assertS3Configured();
  const cmd = new GetObjectCommand({ Bucket: S3_BUCKET(), Key: key });
  return getSignedUrl(getS3Client(), cmd, { expiresIn: env.S3_PRESIGNED_TTL_SECONDS });
}

/**
 * Issue a presigned GET URL the client uses to download directly from S3.
 * The Content-Disposition header is set so browsers offer the file with
 * its original filename rather than the s3Key UUID path.
 */
export async function signDownloadUrl(args: {
  key: string;
  filename: string;
  contentType: string;
}): Promise<string> {
  assertS3Configured();
  const cmd = new GetObjectCommand({
    Bucket: S3_BUCKET(),
    Key: args.key,
    ResponseContentDisposition: `attachment; filename="${args.filename.replace(/"/g, '')}"`,
    ResponseContentType: args.contentType,
  });
  return getSignedUrl(getS3Client(), cmd, { expiresIn: env.S3_PRESIGNED_TTL_SECONDS });
}

/**
 * Best-effort head — used by confirmUpload() to verify the client
 * actually uploaded before we flip a row from PENDING to READY. If S3
 * doesn't see the object, the row stays PENDING and gets cleaned up by
 * the daily sweep.
 */
export async function objectExists(key: string): Promise<boolean> {
  assertS3Configured();
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: S3_BUCKET(), Key: key }));
    return true;
  } catch (err: any) {
    // S3 raises NotFound (404) or NoSuchKey on missing objects. Any
    // other error is propagated — we don't want to silently mark a doc
    // READY when S3 was down and didn't actually persist it.
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') {
      return false;
    }
    throw err;
  }
}

/**
 * Hard-delete the underlying S3 object. Called by the soft-delete
 * cleanup worker, NOT by user-facing routes (those only flip the row's
 * status to DELETED). Idempotent — S3 returns 204 even for missing keys.
 */
export async function deleteObject(key: string): Promise<void> {
  assertS3Configured();
  await getS3Client().send(new DeleteObjectCommand({ Bucket: S3_BUCKET(), Key: key }));
}
