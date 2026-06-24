import { Request, Response, NextFunction } from 'express';
import * as service from '../services/githubIntegration.service';

// 64-byte hex placeholder used when no integration exists for the
// requested projectId. Lets us run the HMAC compute on every request so
// the response timing of "no integration" matches "bad signature" — closes
// the timing-side-channel that could otherwise enumerate which projects
// have GitHub wired up (pre-launch finding H3). The value itself is
// arbitrary; the only requirement is that it stays the same across requests
// (so we don't add a per-request cost), and that it would never match a
// real generated secret (real secrets are random 32-byte hex, this is the
// fixed string).
const PLACEHOLDER_SECRET = '__no_integration__'.padEnd(64, '0');

export async function connectHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.connectGitHub(req.params.id, req.body, req.user!.id);
    // Build the URL the admin pastes into GitHub. We don't know the public
    // hostname for sure, so we read it from the X-Forwarded-Host / Host
    // header. Falls back to a relative path the admin can prepend manually.
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) || req.protocol;
    const host = (req.headers['x-forwarded-host'] as string | undefined) || req.get('host');
    const webhookUrl = host
      ? `${proto}://${host}/api/v1/integrations/github/webhook?projectId=${req.params.id}`
      : `/api/v1/integrations/github/webhook?projectId=${req.params.id}`;
    res.status(201).json({ success: true, data: { ...result, webhookUrl } });
  } catch (err) { next(err); }
}

export async function disconnectHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await service.disconnectGitHub(req.params.id, req.user!.id);
    res.json({ success: true, data: { message: 'GitHub integration disconnected' } });
  } catch (err) { next(err); }
}

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.getGitHubIntegration(req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function listTaskExternalLinksHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.getTaskExternalLinks(req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * Webhook entry point. UNAUTHENTICATED at the bearer-token level — the
 * trust boundary is the HMAC of the raw body against the per-project secret.
 *
 * Express's JSON body parser already consumed `req.body`; we capture the raw
 * buffer in `req.rawBody` via the `verify` hook on the JSON parser (see
 * index.ts). On any verification failure we respond with a generic 401 so
 * an attacker can't distinguish "wrong project" from "wrong signature".
 */
export async function webhookHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.query.projectId || '');
    if (!projectId) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'projectId query param required' } });
      return;
    }
    const { default: prisma } = await import('../config/database');
    const integration = await prisma.projectGitHubIntegration.findUnique({
      where: { projectId },
      select: { webhookSecret: true },
    });

    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Raw body unavailable' } });
      return;
    }
    const sig = req.header('x-hub-signature-256');

    // Constant-time-equivalent path for both "no integration" and "wrong
    // signature" branches (pre-launch finding H3). Without this, the
    // missing-integration path skips the HMAC compute and responds in ~1ms
    // while a present-but-wrong-secret response takes the bcrypt-equivalent
    // ~few ms — letting an attacker enumerate which projectIds have an
    // integration via response timing.
    //
    // We always run verifyGitHubSignature, against the real secret if
    // there is one or a 64-byte placeholder otherwise. Both paths return
    // the same generic 401 below.
    const SECRET_FOR_VERIFY = integration?.webhookSecret ?? PLACEHOLDER_SECRET;
    const valid = service.verifyGitHubSignature(SECRET_FOR_VERIFY, rawBody, sig);
    if (!integration || !valid) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid signature' } });
      return;
    }

    const event = req.header('x-github-event');
    if (event === 'ping') {
      // GitHub fires a `ping` immediately on webhook setup. Acknowledging it
      // lets the admin see the green checkmark in GitHub's webhook UI.
      res.json({ success: true, data: { pong: true } });
      return;
    }
    if (event !== 'pull_request') {
      // Other events (push, issues, etc.) are fine — we just don't act on them yet.
      res.json({ success: true, data: { ignored: event } });
      return;
    }

    const payload = req.body as service.GitHubPullRequestEvent;
    // We act on the action types that change PR state. `synchronize` /
    // `edited` re-fire the same payload — fine, our upsert is idempotent.
    const interestingActions = new Set(['opened', 'reopened', 'edited', 'synchronize', 'closed']);
    if (!interestingActions.has(payload.action)) {
      res.json({ success: true, data: { ignored: `action=${payload.action}` } });
      return;
    }

    const result = await service.processPullRequestEvent(projectId, payload);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
