/**
 * Run receipts — the governance record of *what a run actually did*. When a run
 * reaches a rest state (AWAITING_REVIEW or terminal) we snapshot it: identity,
 * outcome, timing, token usage, and the work it produced (steps, commits, PR,
 * checks). The snapshot is hashed into a `digest` — HMAC-SHA256 when a server
 * secret (`LUMEY_RECEIPT_SECRET`) is configured, plain SHA-256 otherwise — so any
 * later tampering with the stored snapshot is detectable on read.
 *
 * Cost is deliberately absent: the platform measures **tokens** (the honest,
 * model-agnostic unit; cost is a frontier-pricing concern the SDK derives). A
 * receipt is refreshed (upserted) each time the run rests, so it always reflects
 * the latest truth even if a run resumes after review.
 */
import crypto from 'crypto';
import prisma from '../config/database';
import { RunStepType, type Prisma } from '@prisma/client';
import { getRunSdlc } from './runSdlc.service';

/** Deterministic JSON: object keys sorted recursively, so the hash is stable. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
}

/** Hash the canonical content — HMAC with the server secret if set, else SHA-256. */
function computeDigest(content: unknown): { digest: string; algo: string } {
  const canonical = canonicalize(content);
  const secret = process.env.LUMEY_RECEIPT_SECRET;
  if (secret) {
    return { digest: crypto.createHmac('sha256', secret).update(canonical).digest('hex'), algo: 'hmac-sha256' };
  }
  return { digest: crypto.createHash('sha256').update(canonical).digest('hex'), algo: 'sha256' };
}

/** Assemble the receipt snapshot for a run, or null if the run is gone. */
async function buildReceiptContent(runId: string): Promise<Record<string, unknown> | null> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: {
      id: true, taskId: true, agentId: true, model: true, status: true, summary: true,
      startedAt: true, endedAt: true, inputTokens: true, outputTokens: true, totalTokens: true,
    },
  });
  if (!run) return null;

  const steps = await prisma.runStep.findMany({ where: { runId }, select: { type: true } });
  const stepTypes = steps.reduce<Record<string, number>>((acc, s) => {
    acc[s.type] = (acc[s.type] ?? 0) + 1;
    return acc;
  }, {});

  const sdlc = await getRunSdlc(runId);
  const checks = {
    total: sdlc.checks.length,
    passed: sdlc.checks.filter((c) => c.status === 'COMPLETED' && c.conclusion === 'SUCCESS').length,
    failed: sdlc.checks.filter((c) => c.status === 'COMPLETED' && (c.conclusion === 'FAILURE' || c.conclusion === 'TIMED_OUT' || c.conclusion === 'ACTION_REQUIRED')).length,
  };

  const durationMs = run.startedAt && run.endedAt ? run.endedAt.getTime() - run.startedAt.getTime() : null;

  return {
    version: 1,
    run: { id: run.id, taskId: run.taskId, agentId: run.agentId, model: run.model },
    outcome: { status: run.status, summary: run.summary },
    timing: { startedAt: run.startedAt?.toISOString() ?? null, endedAt: run.endedAt?.toISOString() ?? null, durationMs },
    usage: { inputTokens: run.inputTokens, outputTokens: run.outputTokens, totalTokens: run.totalTokens },
    work: {
      steps: steps.length,
      stepTypes,
      commits: sdlc.commits.length,
      pullRequest: sdlc.pullRequest
        ? { externalId: sdlc.pullRequest.externalId, number: sdlc.pullRequest.number, url: sdlc.pullRequest.url, state: sdlc.pullRequest.state }
        : null,
      checks,
    },
  };
}

/**
 * Issue (or refresh) the receipt for a run. Upserts by runId so a run that rests,
 * resumes, and rests again always carries its latest record. No-op (null) if the
 * run no longer exists.
 */
export async function issueRunReceipt(runId: string) {
  const content = await buildReceiptContent(runId);
  if (!content) return null;
  const { digest, algo } = computeDigest(content);
  return prisma.runReceipt.upsert({
    where: { runId },
    create: { runId, digest, algo, content: content as Prisma.InputJsonValue },
    update: { digest, algo, content: content as Prisma.InputJsonValue, issuedAt: new Date() },
  });
}

/**
 * Read a run's receipt and verify its integrity by recomputing the digest over
 * the stored content. `verified: false` means the snapshot was altered after
 * issuance (or the signing secret changed). Null if no receipt exists yet.
 */
export async function getRunReceipt(runId: string) {
  const receipt = await prisma.runReceipt.findUnique({ where: { runId } });
  if (!receipt) return null;
  const recomputed = computeDigest(receipt.content);
  return { ...receipt, verified: recomputed.algo === receipt.algo && recomputed.digest === receipt.digest };
}
