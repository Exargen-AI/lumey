/**
 * Pulse org-level GitHub webhook routes — CODE signal (Wave 3, PR #33).
 *
 *   POST /api/v1/webhooks/github/pulse
 *
 * Receives push / pull_request / pull_request_review deliveries for
 * the whole Exargen-AI org and emits CODE productivity events.
 *
 * Auth: HMAC verification of X-Hub-Signature-256 against
 * PULSE_GITHUB_WEBHOOK_SECRET (env var). No JWT, no session.
 *
 * Separate from the per-project webhook at
 * /api/v1/integrations/github/webhook (project-task linking).
 */

import { Router } from 'express';
import { pulseGithubWebhookHandler } from '../handlers/pulseGithubWebhook.handler';

const router = Router();

router.post('/webhooks/github/pulse', pulseGithubWebhookHandler);

export default router;
