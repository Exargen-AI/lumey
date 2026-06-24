-- Pre-onboarding polish: add webhook-error fields to GitHub integration so
-- the settings UI can flag a broken webhook even when a much-older success
-- exists in lastWebhookAt. Round 2 follow-up #11.
ALTER TABLE "project_github_integrations" ADD COLUMN "lastWebhookErrorAt" TIMESTAMP(3);
ALTER TABLE "project_github_integrations" ADD COLUMN "lastWebhookError" TEXT;

-- Pre-onboarding polish: distinguish "comment was edited by author" from
-- the auto-bumping `updatedAt`. Round 2 follow-up R2.
ALTER TABLE "comments" ADD COLUMN "editedAt" TIMESTAMP(3);
