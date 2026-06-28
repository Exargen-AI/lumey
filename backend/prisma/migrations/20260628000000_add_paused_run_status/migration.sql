-- Add the PAUSED run status: a human-held, resumable suspend of an in-flight run
-- (the loop parks at a turn boundary with its transcript alive). Positioned after
-- RUNNING to mirror the lifecycle order in schema.prisma.
ALTER TYPE "RunStatus" ADD VALUE 'PAUSED' AFTER 'RUNNING';
