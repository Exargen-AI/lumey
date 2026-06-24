/**
 * Pulse GitHub webhook handler — CODE signal (Wave 3, PR #33).
 *
 * POST /api/v1/webhooks/github/pulse
 *
 * Anonymous endpoint. HMAC is the trust boundary. Verifies the
 * X-Hub-Signature-256 header against `PULSE_GITHUB_WEBHOOK_SECRET`
 * using a constant-time compare, then processes the delivery
 * (audit log + productivity event emit) inside one transaction.
 *
 * Failure modes:
 *   - Missing secret env var      → 503 (service unavailable)
 *   - No raw body (middleware bug) → 400
 *   - Missing/invalid signature   → 401
 *   - Missing delivery id header  → 400 (GitHub always sends it)
 *   - DB error                    → 500 (propagated to next())
 *   - Duplicate delivery          → 200 with { deduped: true }
 *   - Bot actor / unknown event   → 200 with { ignored: ... }
 *
 * GitHub treats any 2xx as "delivered." Anything else triggers
 * exponential-backoff retries (up to 30 in 24h). We deliberately
 * return 2xx for deduped + ignored cases so GitHub doesn't keep
 * retrying.
 */

import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import prisma from '../config/database';
import {
  processPulseWebhookDelivery,
  verifyPulseWebhookSignature,
} from '../services/pulseGithubWebhook.service';

/**
 * Placeholder secret used when env var isn't set, to keep the timing
 * of "no integration" and "wrong secret" indistinguishable. Pattern
 * mirrors the existing per-project webhook handler.
 */
const PLACEHOLDER_SECRET = 'pulse-github-webhook-secret-not-set'.repeat(2);

export async function pulseGithubWebhookHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const secret = env.PULSE_GITHUB_WEBHOOK_SECRET ?? '';

    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Raw body unavailable' },
      });
      return;
    }

    const sig = req.header('x-hub-signature-256');

    // Constant-time HMAC verification. We always run the compute
    // (using a placeholder if no secret is configured) so an
    // unauthenticated probe can't tell the difference between
    // "PULSE_GITHUB_WEBHOOK_SECRET unset" and "wrong signature" via
    // response timing. Both produce the same 401.
    const secretForVerify = secret || PLACEHOLDER_SECRET;
    const valid = verifyPulseWebhookSignature(secretForVerify, rawBody, sig);
    if (!secret || !valid) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid signature' },
      });
      return;
    }

    const eventType = req.header('x-github-event');
    if (!eventType) {
      res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Missing X-GitHub-Event header' },
      });
      return;
    }

    const deliveryId = req.header('x-github-delivery');
    if (!deliveryId) {
      res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Missing X-GitHub-Delivery header' },
      });
      return;
    }

    // Body was parsed by express.json (1MB cap). Treat as opaque JSON object.
    const payload = (req.body ?? {}) as Record<string, unknown>;

    // The transaction wraps: github_webhook_events insert + outbox
    // event emits + audit row update. If any step fails, rollback
    // means no half-state in the audit log.
    const result = await prisma.$transaction(async (tx) => {
      return processPulseWebhookDelivery(tx, {
        deliveryId,
        eventType,
        rawBody: rawBody.toString('utf8'),
        payload,
      });
    });

    res.json({
      success: true,
      data: {
        deduped: result.deduped,
        eventsEmitted: result.emittedCount,
      },
    });
  } catch (err) {
    next(err);
  }
}
