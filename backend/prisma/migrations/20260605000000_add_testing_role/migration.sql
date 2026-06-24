-- Add TESTING role to UserRole enum. Used for internal QA / testing
-- accounts that need broad access to exercise every feature.
ALTER TYPE "UserRole" ADD VALUE 'TESTING';
