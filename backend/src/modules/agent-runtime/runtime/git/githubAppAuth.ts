/**
 * GitHub App installation-token auth — mint **short-lived** (≈1h) installation
 * tokens instead of carrying a long-lived PAT. The flow, all over raw HTTPS (no
 * Octokit): sign an App JWT (RS256) with the App's private key → look up the
 * installation for a repo → exchange the JWT for an installation access token.
 * Tokens are cached per repo until shortly before expiry.
 *
 * Short-lived, least-privilege, auto-rotating — the right credential for an
 * automated agent that pushes branches and opens PRs.
 */
import crypto from 'crypto';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A GitHub App JWT (RS256), valid ~9 min, signed with the App's private key. */
export function signAppJwt(input: { appId: string; privateKey: string; nowSec: number }): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: input.nowSec - 60, exp: input.nowSec + 540, iss: String(input.appId) };
  const signingInput = `${base64url(Buffer.from(JSON.stringify(header)))}.${base64url(Buffer.from(JSON.stringify(payload)))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), input.privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

export interface InstallationTokenSource {
  /** A current installation access token for the repo (cached until near expiry). */
  getInstallationToken(owner: string, repo: string): Promise<string>;
}

export interface GitHubAppConfig {
  readonly appId: string;
  /** PEM private key (newlines real, not `\n`-escaped). */
  readonly privateKey: string;
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  /** Injectable clock (ms). Default `Date.now`. */
  readonly nowFn?: () => number;
}

function appHeaders(jwt: string): Record<string, string> {
  return { authorization: `Bearer ${jwt}`, accept: 'application/vnd.github+json', 'user-agent': 'lumey-agent-runtime' };
}

export function createInstallationTokenSource(cfg: GitHubAppConfig): InstallationTokenSource {
  if (!cfg.appId || !cfg.privateKey) throw new Error('createInstallationTokenSource: appId and privateKey are required');
  const apiBase = (cfg.apiBaseUrl ?? 'https://api.github.com').replace(/\/$/, '');
  const fetchImpl = cfg.fetchImpl ?? globalThis.fetch;
  const now = cfg.nowFn ?? (() => Date.now());
  const cache = new Map<string, { token: string; expEpochMs: number }>();

  return {
    async getInstallationToken(owner, repo) {
      const key = `${owner}/${repo}`;
      const cached = cache.get(key);
      if (cached && cached.expEpochMs - now() > 60_000) return cached.token; // 1-min skew

      const jwt = signAppJwt({ appId: cfg.appId, privateKey: cfg.privateKey, nowSec: Math.floor(now() / 1000) });

      const instRes = await fetchImpl(`${apiBase}/repos/${owner}/${repo}/installation`, { headers: appHeaders(jwt) });
      if (!instRes.ok) throw new Error(`GitHub App: installation lookup for ${key} failed (${instRes.status})`);
      const inst = (await instRes.json()) as { id?: number };
      if (!inst.id) throw new Error(`GitHub App: no installation for ${key}`);

      const tokRes = await fetchImpl(`${apiBase}/app/installations/${inst.id}/access_tokens`, { method: 'POST', headers: appHeaders(jwt) });
      if (!tokRes.ok) throw new Error(`GitHub App: token mint for ${key} failed (${tokRes.status})`);
      const tok = (await tokRes.json()) as { token?: string; expires_at?: string };
      if (!tok.token) throw new Error(`GitHub App: token mint for ${key} returned no token`);

      const expEpochMs = tok.expires_at ? Date.parse(tok.expires_at) : now() + 3_600_000;
      cache.set(key, { token: tok.token, expEpochMs });
      return tok.token;
    },
  };
}
