-- User profile photo (2026-06). Stores the private-bucket S3 object key; the
-- API serves a fresh presigned GET URL on each auth response.

ALTER TABLE "users" ADD COLUMN "avatarKey" TEXT;
