/**
 * Pulse Agent — HTTP client wrapper.
 *
 * Wraps axios with:
 *   - Per-device API key auth (`Authorization: Device <apiKey>`)
 *   - Exponential backoff retry on network errors / 5xx — applied to
 *     BOTH heartbeats and snapshots since 2026-05-30. (Prior behaviour:
 *     only heartbeats retried; snapshots threw on a single transient
 *     5xx and lost an entire hour of buckets. Same retry shape now,
 *     scoped not to spam servers — `retry()` skips 4xx because those
 *     are permanent errors, not load-balancer hiccups.)
 *   - Idempotency-Key on snapshot writes so a flaky network can't
 *     create a duplicate snapshot row.
 *   - `AuthRevokedError` thrown on 401 / 403 so the main loop can
 *     short-circuit the agent (revoked devices used to retry forever).
 *   - Server-time capture on enrollment + heartbeat so the agent can
 *     detect a skewed laptop clock without an NTP dependency.
 *
 * No logging of bodies — the snapshot body contains installed-software
 * names which could be considered semi-sensitive on a personal device.
 * `scrubSecrets()` redacts the few error shapes that might echo back a
 * credential. See `scrubError()` below.
 */

import axios, { type AxiosError, type AxiosInstance } from 'axios';
import { randomUUID, createHash } from 'crypto';

// Local wire DTOs (mirror of shared/src/types/pulse.ts on the backend).
// The agent is standalone — it ships as a single .exe to employee
// laptops and is NOT a monorepo workspace member, so we duplicate the
// thin wire-shape here rather than depend on @exargen/shared. The
// backend's zod validator surfaces any drift as a 400 immediately.
type PlatformLit = 'WINDOWS' | 'MACOS' | 'LINUX';
type PowerStateLit = 'ON' | 'IDLE' | 'LOCKED' | 'OFF';

export interface DeviceEnrollRequest {
  enrollmentToken: string;
  fingerprint: string;
  hostname: string;
  platform: PlatformLit;
  osVersion?: string;
  osBuild?: string;
  arch?: string;
  agentVersion: string;
}
export interface DeviceEnrollResponse {
  deviceId: string;
  apiKey: string;
  ownerUserId: string | null;
  serverTime: string;
}
export interface DeviceHeartbeatRequest {
  powerState: PowerStateLit;
  uptimeSeconds: number;
  agentVersion: string;
  // Wave 9 — agent self-health (optional).
  cpuPercent?: number;
  memoryMb?: number;
  errorCount?: number;
  lastErrorAt?: string;
  lastErrorMessage?: string | null;
}
export interface DeviceHeartbeatResponse {
  ok: true;
  nextHeartbeatInSeconds: number;
  // Wave 9 — kill switch. When true the agent stops scheduling
  // heartbeats / snapshots and exits cleanly.
  revoked?: boolean;
  // 2026-05-30 — server-side wall clock at the moment the heartbeat
  // was received. Optional because older deployments may not return
  // it; main loop treats undefined as "skip skew check this cycle".
  serverTime?: string;
}
export interface DeviceSnapshotRequest {
  powerState: PowerStateLit;
  uptimeSeconds: number;
  lastBootAt?: string;
  // 2026-05-29 — When the user actually logged in (distinct from boot).
  currentSessionStart?: string;
  // 2026-05-29 — Total process count, sanity/tamper signal.
  runningProcessCount?: number;
  loggedInUserName?: string;
  defenderEnabled?: boolean;
  firewallEnabled?: boolean;
  bitlockerEnabled?: boolean;
  rebootRequired?: boolean;
  pendingRebootSince?: string;
  unsupportedOs?: boolean;
  installedSoftware: {
    name: string;
    version?: string;
    publisher?: string;
    installDate?: string;
  }[];
  missingPatches: {
    patchId: string;
    title?: string;
    classification?: string;
    severity?: string;
    releasedAt?: string;
  }[];
  activeSecondsBucket?: number;
  idleSecondsBucket?: number;
  lockedSecondsBucket?: number;
  // 2026-05-29 — Per-app foreground time for this snapshot window.
  // Backend upserts into device_app_activity keyed by
  // (deviceId, appBucketStart, appName).
  appBucketStart?: string;
  appBucketEnd?: string;
  appBuckets?: {
    appName: string;
    appDisplayName?: string;
    lastWindowTitle?: string;
    foregroundSeconds: number;
    category: 'PRODUCTIVE' | 'COMMUNICATION' | 'ENTERTAINMENT' | 'PERSONAL' | 'UNKNOWN' | 'TAMPER';
    categoryReason?: string;
  }[];
  // Wave 9 — agent resilience signals.
  runningTamperProcesses?: { name: string; pid?: number }[];
  batteryPercent?: number;
  batteryCharging?: boolean;
  batteryHealthPercent?: number;
  diskFreePercent?: number;
  diskFreeGb?: number;
  networkType?: 'ETHERNET' | 'WIFI' | 'CELLULAR' | 'VPN' | 'UNKNOWN';
  networkConnectivity?: 'INTERNET' | 'LOCAL_ONLY' | 'NO_TRAFFIC' | 'UNKNOWN';
  agentVersion: string;
}
export interface DeviceSnapshotResponse {
  ok: true;
  riskScore: number;
  riskLevel: 'HEALTHY' | 'AT_RISK' | 'CRITICAL';
  openAlertCount: number;
}

const AGENT_USER_AGENT = `pulse-agent/${process.env.npm_package_version ?? '0.1.0'}`;

export interface ApiClientOpts {
  serverUrl: string;
  apiKey?: string;
}

export class PulseApiClient {
  private readonly http: AxiosInstance;

  constructor(private readonly opts: ApiClientOpts) {
    this.http = axios.create({
      baseURL: opts.serverUrl,
      timeout: 60_000,
      headers: {
        'User-Agent': AGENT_USER_AGENT,
        'Content-Type': 'application/json',
        ...(opts.apiKey ? { Authorization: `Device ${opts.apiKey}` } : {}),
      },
      // Don't throw on 4xx — let the caller see the body for debugging.
      validateStatus: (s) => s >= 200 && s < 500,
    });
  }

  async enroll(body: DeviceEnrollRequest): Promise<DeviceEnrollResponse> {
    const res = await this.http.post('/devices/enroll', body);
    if (res.status !== 201) {
      // Enrollment cannot use scrubSecrets blindly because the request
      // body carried the enrollmentToken — we want the error to NOT
      // echo it. Use the safer summary form.
      throw new Error(`Enrollment failed: HTTP ${res.status}`);
    }
    return (res.data as { success: true; data: DeviceEnrollResponse }).data;
  }

  async heartbeat(body: DeviceHeartbeatRequest): Promise<DeviceHeartbeatResponse> {
    const res = await retry(() => this.http.post('/devices/me/heartbeat', body));
    assertNotAuthRevoked(res.status, 'heartbeat');
    if (res.status !== 200) {
      throw new Error(`Heartbeat failed: HTTP ${res.status}`);
    }
    return (res.data as { success: true; data: DeviceHeartbeatResponse }).data;
  }

  async snapshot(body: DeviceSnapshotRequest): Promise<DeviceSnapshotResponse> {
    // Deterministic idempotency key so a retry within the dedup TTL
    // (24h) replays. We hash the body's installed-software signature
    // so legitimate same-state snapshots collapse, but a fresh
    // snapshot 60-min later has different uptime / power-state and
    // doesn't collide.
    const idKey = `pulse-snap-${sha256(JSON.stringify(body)).slice(0, 32)}`;
    // 2026-05-30: snapshot now retries on transient errors, same shape
    // as heartbeat. Previously a single 5xx from the LB dropped an
    // entire 60-min telemetry window. Retry skips 4xx so a permanent
    // schema bug fails fast (next cycle has fresh data anyway).
    const res = await retry(() =>
      this.http.post('/devices/me/snapshot', body, {
        headers: { 'Idempotency-Key': idKey },
      }),
    );
    assertNotAuthRevoked(res.status, 'snapshot');
    if (res.status !== 201) {
      throw new Error(`Snapshot failed: HTTP ${res.status}`);
    }
    return (res.data as { success: true; data: DeviceSnapshotResponse }).data;
  }
}

// ─── Error helpers ─────────────────────────────────────────────────────

/**
 * Thrown when the backend tells us our API key is no longer valid —
 * either 401 (auth header missing/wrong) or 403 (device record
 * exists but is revoked). The main loop catches this, logs a
 * structured warning, clears the heartbeat/snapshot/tick timers and
 * exits(0). NSSM treats exit 0 as a normal stop and does NOT restart
 * the service — preventing the "revoked device retries forever and
 * burns server bandwidth" pathology.
 *
 * Distinct from the in-band `{revoked: true}` heartbeat response
 * which the backend may also send (a graceful kill-switch on a 200).
 * Both end at the same `stopAgent()` path; this class just lets the
 * code separate "explicit deny" from "transient network".
 */
export class AuthRevokedError extends Error {
  readonly status: number;
  constructor(status: number, label: string) {
    super(`Auth revoked on ${label}: HTTP ${status}`);
    this.name = 'AuthRevokedError';
    this.status = status;
  }
}

function assertNotAuthRevoked(status: number, label: string): void {
  if (status === 401 || status === 403) {
    throw new AuthRevokedError(status, label);
  }
}

/**
 * Strip credentials from any object that might be echoed into a log.
 *
 * The agent's logs land in `%ProgramData%\ExargenPulse\logs\` which
 * any local admin can read. Bug-bounty / blue-team rule of thumb:
 * assume every stderr line is forever. Cheap to redact; expensive to
 * find out a year later that an enrollmentToken sat in a log file on
 * a hundred laptops.
 *
 * Handles the three shapes we actually log:
 *   • Axios error objects (config.data, response.data echo body)
 *   • Plain Error (message string)
 *   • Arbitrary objects (deep walk)
 */
const REDACT_KEYS = new Set<string>([
  'apiKey',
  'apikey',
  'api_key',
  'enrollmentToken',
  'enrollmenttoken',
  'enrollment_token',
  'authorization',
  'token',
  'password',
]);
const REDACTED = '«redacted»';

export function scrubSecrets<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    // Token shapes we emit: `det_<128hex>` (enrollment) and
    // `Device <opaque>` (Authorization header). Strip both.
    return value
      .replace(/det_[A-Za-z0-9_-]{8,}/g, 'det_«redacted»')
      .replace(/Device\s+[A-Za-z0-9_.+\-/=]+/g, 'Device «redacted»') as unknown as T;
  }
  if (typeof value !== 'object') return value;
  if (seen.has(value as object)) return value; // cycle guard
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.map((v) => scrubSecrets(v, seen)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else {
      out[k] = scrubSecrets(v, seen);
    }
  }
  return out as unknown as T;
}

/**
 * Coerce an unknown thrown value into a log-safe string. Pulls just
 * the human-meaningful surface (message + status + url) — we
 * deliberately do NOT include response.data because we can't trust
 * the backend to redact secrets it happens to echo back.
 */
export function scrubError(err: unknown): string {
  if (err instanceof AuthRevokedError) return err.message;
  // Axios shape — preferred path
  const maybeAxios = err as Partial<AxiosError> | undefined;
  if (maybeAxios && maybeAxios.isAxiosError) {
    const status = maybeAxios.response?.status;
    const url = scrubSecrets(maybeAxios.config?.url ?? '');
    const code = maybeAxios.code ?? 'ERR';
    return `${code} ${status ?? '—'} ${url}`.trim();
  }
  if (err instanceof Error) return scrubSecrets(err.message);
  return scrubSecrets(String(err));
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Exponential-backoff retry for transient network / 5xx errors.
 *
 * Heartbeat and snapshot both wrap their POST in this. We deliberately
 * do NOT retry on 4xx responses (axios returns those as a fulfilled
 * promise per `validateStatus`, so they don't even reach this catch —
 * but if the caller ever bypasses that they shouldn't be retried
 * either). 4xx means "request is permanently bad", and burning the
 * exponential backoff window only delays the inevitable.
 *
 * Empirically the 3-attempt / 1-2-4 second shape is sized for a brief
 * LB blip during a deploy or a captive-portal momentarily intercepting
 * the connection. It's NOT sized for "the office WiFi is down" — that
 * scenario is handled by the next heartbeat/snapshot cycle 5 / 60 min
 * later. The point of retry here is to bridge a 1–7 second outage
 * without losing the data.
 */
async function retry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseMs?: number } = {},
): Promise<T> {
  const max = opts.maxAttempts ?? 3;
  const base = opts.baseMs ?? 1_000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < max) {
        await sleep(base * 2 ** (attempt - 1));
      }
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Generate a fresh UUID for a new idempotency key (unused snapshots use
 *  a deterministic hash instead — exposed here for ad-hoc calls). */
export function newIdempotencyKey(): string {
  return randomUUID();
}
