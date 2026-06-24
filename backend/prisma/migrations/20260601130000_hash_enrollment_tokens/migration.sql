-- Hash device enrollment tokens at rest (2026-06-01 enterprise-hardening M7).
--
-- Previously `device_enrollment_tokens.token` stored the single-use
-- bootstrap secret in CLEARTEXT. Anyone with DB read access (a leaked
-- backup, errant SQL, an insider) could read an active token and enroll a
-- rogue device. We now store only a SHA-256 hash — the same at-rest
-- posture as `devices.apiKeyHash`.
--
-- Backfill strategy: existing active tokens stay USABLE. We hash the
-- existing cleartext in-place (sha256, lowercase hex — byte-identical to
-- the app's hashDeviceApiKey), so an agent that still holds a copied
-- cleartext token can complete enrollment. Admins simply can no longer
-- VIEW the cleartext (it was already shown only once at issuance). We also
-- keep the last 4 chars for the masked list display ("····ab12").

-- pgcrypto provides digest() for the in-SQL backfill.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "device_enrollment_tokens" ADD COLUMN "tokenHash"  TEXT;
ALTER TABLE "device_enrollment_tokens" ADD COLUMN "tokenLast4" TEXT;

-- Backfill from the existing cleartext. encode(digest(...,'sha256'),'hex')
-- matches Node's createHash('sha256').update(token,'utf8').digest('hex').
UPDATE "device_enrollment_tokens"
SET "tokenHash"  = encode(digest("token", 'sha256'), 'hex'),
    "tokenLast4" = right("token", 4);

ALTER TABLE "device_enrollment_tokens" ALTER COLUMN "tokenHash"  SET NOT NULL;
ALTER TABLE "device_enrollment_tokens" ALTER COLUMN "tokenLast4" SET NOT NULL;

-- Drop the cleartext column (its unique index drops with it) and add the
-- hash unique index used for enrollment lookup.
ALTER TABLE "device_enrollment_tokens" DROP COLUMN "token";

CREATE UNIQUE INDEX "device_enrollment_tokens_tokenHash_key"
  ON "device_enrollment_tokens"("tokenHash");
