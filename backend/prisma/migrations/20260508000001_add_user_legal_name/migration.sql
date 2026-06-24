-- Add User.legalName: the full legal name used on signed compliance
-- documents. Captured once before the user signs their first document.
-- Distinct from `name` (display name, often a first-name shorthand
-- derived from the email at lazy-create).
-- Null means the user has not yet gone through the legal-name capture
-- step. The OnboardingGate forces it before any signature is allowed.

ALTER TABLE "users"
  ADD COLUMN "legalName" TEXT;
