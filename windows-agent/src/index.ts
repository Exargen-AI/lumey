/**
 * Pulse Agent — entry point.
 *
 * Runs as a Windows Service (or in foreground for dev). Three phases:
 *
 *   1. boot()       — read config, decide enroll-vs-steady-state.
 *   2. enrollIfNeeded() — first-boot only: POST /devices/enroll, persist
 *                          the issued apiKey + deviceId, clear the
 *                          enrollment token from disk.
 *   3. loop()       — two timers: heartbeat (~5 min) + snapshot (~60 min).
 *                     Each is independent; a snapshot failure doesn't
 *                     stop heartbeats and vice versa.
 *
 * Critical invariants:
 *   - Agent never writes the DB. All state changes go through the
 *     backend's authenticated REST endpoints.
 *   - apiKey is only ever in memory or on the ACL-restricted config
 *     file. Never logged.
 *   - Snapshot calls carry an Idempotency-Key so a retry-after-timeout
 *     can't create a duplicate snapshot row server-side.
 */

import { loadConfig, saveConfig, bootstrapConfig, getHostname, AgentConfig } from './config';
import { computeFingerprint } from './fingerprint';
import { PulseApiClient, AuthRevokedError, scrubError } from './api';
import {
  getPowerState,
  getUptimeSeconds,
  getLastBootAt,
  getLoggedInUserName,
  getSecurityPosture,
  getOsVersion,
  getInstalledSoftware,
  getMissingPatches,
  getForegroundApp,
  getRunningProcessCount,
  getCurrentSessionStart,
  // Wave 9 — agent resilience collectors.
  getRunningTamperProcesses,
  getBatteryStatus,
  getDiskFree,
  getNetworkProfile,
  type PowerState,
} from './collectors';
import { classifyApp, type AppCategory } from './classifier';

const AGENT_VERSION = process.env.npm_package_version ?? '0.1.0';

// ─── State-time accounting + foreground-app accounting ───────────────
//
// We tick every 30 seconds. Each tick records:
//   1. Time in the current PowerState (active / idle / locked)
//   2. Time the current FOREGROUND APP held focus (per-app bucket)
//
// On each hourly snapshot, both buckets are drained and shipped. The
// agent never persists this data to disk — if the process dies mid-
// bucket, the last partial hour is lost. Acceptable trade-off:
// crashes are rare, and the next bucket starts fresh.

const TICK_INTERVAL_MS = 30_000;

interface AppBucket {
  appName: string;
  appDisplayName: string | null;
  lastWindowTitle: string | null;
  foregroundSeconds: number;
  category: AppCategory;
  categoryReason: string | null;
}

class StateTimeAccumulator {
  private activeSeconds = 0;
  private idleSeconds = 0;
  private lockedSeconds = 0;
  // Per-app foreground bucket. Key = lowercased appName so we merge
  // chrome.exe / Chrome.exe (Windows is case-insensitive).
  private appBuckets = new Map<string, AppBucket>();
  // The window where this bucket began — needed for the hourly upsert
  // key on the backend (bucketStart).
  private bucketStart = new Date();
  private lastTickAt = Date.now();

  private addPowerState(state: PowerState, elapsedSec: number): void {
    if (state === 'ON') this.activeSeconds += elapsedSec;
    else if (state === 'IDLE') this.idleSeconds += elapsedSec;
    else if (state === 'LOCKED') this.lockedSeconds += elapsedSec;
    // OFF is not observable (agent isn't running).
  }

  private addAppTime(
    appName: string | null,
    displayName: string | null,
    windowTitle: string | null,
    elapsedSec: number,
  ): void {
    if (!appName) return;
    const key = appName.toLowerCase();
    const existing = this.appBuckets.get(key);
    if (existing) {
      existing.foregroundSeconds += elapsedSec;
      if (windowTitle) existing.lastWindowTitle = windowTitle;
    } else {
      const cls = classifyApp(key, windowTitle);
      this.appBuckets.set(key, {
        appName: key,
        appDisplayName: displayName,
        lastWindowTitle: windowTitle,
        foregroundSeconds: elapsedSec,
        category: cls.category,
        categoryReason: cls.reason,
      });
    }
  }

  async tick(): Promise<void> {
    const now = Date.now();
    const elapsedSec = Math.max(0, Math.floor((now - this.lastTickAt) / 1000));
    this.lastTickAt = now;
    if (elapsedSec === 0) return;

    // Both probes are cheap: getPowerState is cached for 60 s, and
    // getForegroundApp now reads a JSON file written by the
    // ExargenPulseUserProbe scheduled task (PR #31) — no PowerShell
    // spawn on the hot path anymore.
    const [state, foreground] = await Promise.all([
      getPowerState(),
      getForegroundApp(),
    ]);

    this.addPowerState(state, elapsedSec);

    // We only attribute foreground time when the user is actually
    // present (ON). Idle / locked time isn't "using" any app.
    if (state === 'ON' && foreground) {
      this.addAppTime(
        foreground.appName,
        foreground.appDisplayName,
        foreground.windowTitle,
        elapsedSec,
      );
    }
  }

  drainAndReset(): {
    activeSeconds: number;
    idleSeconds: number;
    lockedSeconds: number;
    bucketStart: Date;
    bucketEnd: Date;
    apps: AppBucket[];
  } {
    const apps = Array.from(this.appBuckets.values());
    const out = {
      activeSeconds: this.activeSeconds,
      idleSeconds: this.idleSeconds,
      lockedSeconds: this.lockedSeconds,
      bucketStart: this.bucketStart,
      bucketEnd: new Date(),
      apps,
    };
    this.activeSeconds = 0;
    this.idleSeconds = 0;
    this.lockedSeconds = 0;
    this.appBuckets = new Map();
    this.bucketStart = new Date();
    this.lastTickAt = Date.now();
    return out;
  }
}

const stateAccumulator = new StateTimeAccumulator();

// ─── Wave 9 — agent self-health tracking ─────────────────────────────
//
// Tracks the agent's OWN resource usage + error count so heartbeats
// can ship those numbers to the backend. SUPER_ADMIN can then spot an
// agent that's quietly leaking memory, throwing errors silently, or
// running on a CPU-starved machine — without having to RDP in.
//
// CPU is sampled via `process.cpuUsage()` deltas across the
// heartbeat window. Memory is RSS in MB. Errors are incremented by
// any `log('error', …)` call.

class SelfHealth {
  private lastCpuSample = process.cpuUsage();
  private lastCpuSampleAt = Date.now();
  errorCount = 0;
  lastErrorAt: Date | null = null;
  lastErrorMessage: string | null = null;

  recordError(message: string): void {
    this.errorCount += 1;
    this.lastErrorAt = new Date();
    // Truncate to fit the backend's 512-char cap.
    this.lastErrorMessage = message.slice(0, 512);
  }

  sample(): { cpuPercent: number; memoryMb: number } {
    const now = Date.now();
    const cpu = process.cpuUsage(this.lastCpuSample);
    // cpuUsage delta is in microseconds (user + system).
    const elapsedMicros = (now - this.lastCpuSampleAt) * 1000;
    const cpuPercent =
      elapsedMicros > 0
        ? Math.min(100, ((cpu.user + cpu.system) / elapsedMicros) * 100)
        : 0;
    this.lastCpuSample = process.cpuUsage();
    this.lastCpuSampleAt = now;
    const mem = process.memoryUsage();
    return {
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      memoryMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
    };
  }
}

const selfHealth = new SelfHealth();

function log(level: 'info' | 'warn' | 'error', message: string, extra?: unknown) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(extra && typeof extra === 'object' ? { extra } : {}),
  });
  if (level === 'error') {
    console.error(line);
    // Wave 9 — feed the self-health tracker so the next heartbeat
    // surfaces "this agent is throwing errors" to the dashboard.
    selfHealth.recordError(message);
  } else if (level === 'warn') console.warn(line);
  else console.log(line);
}

async function enrollIfNeeded(config: AgentConfig): Promise<AgentConfig> {
  if (config.apiKey && config.deviceId) return config;

  if (!config.enrollmentToken) {
    throw new Error(
      'Pulse agent has no API key and no enrollment token. Re-run installer with a fresh token.',
    );
  }

  log('info', 'Enrolling device…');

  const fingerprint = computeFingerprint();
  const osv = getOsVersion();
  const tmpClient = new PulseApiClient({ serverUrl: config.serverUrl });
  const result = await tmpClient.enroll({
    enrollmentToken: config.enrollmentToken,
    fingerprint,
    hostname: getHostname(config),
    platform: process.platform === 'win32' ? 'WINDOWS' : process.platform === 'darwin' ? 'MACOS' : 'LINUX',
    osVersion: osv.version,
    osBuild: osv.build,
    arch: osv.arch,
    agentVersion: AGENT_VERSION,
  });

  log('info', 'Enrollment successful', { deviceId: result.deviceId });

  const updated: AgentConfig = {
    ...config,
    deviceId: result.deviceId,
    apiKey: result.apiKey,
    enrollmentToken: undefined,
  };
  saveConfig(updated);
  return updated;
}

/**
 * Wave 9 — signature returns `revoked` so the main loop can stop
 * timers and exit cleanly when the SUPER_ADMIN revokes this device.
 *
 * 2026-05-30 (god-mode pass) — three additions:
 *   • `AuthRevokedError` (thrown by api.ts on a 401/403) propagates as
 *     `revoked: true` so the main loop short-circuits instead of
 *     retrying a permanently bad credential forever.
 *   • If the heartbeat response carries `serverTime`, we compare it to
 *     local Date.now() and warn when the skew is > 5 minutes — the
 *     prod data is only as good as the laptop clock that timestamped
 *     it.
 *   • All error logging now goes through `scrubError()` so an
 *     unexpected response body can't echo a credential into
 *     %ProgramData%\ExargenPulse\logs\ where any local admin can read
 *     it.
 */
async function sendHeartbeat(client: PulseApiClient): Promise<{ revoked: boolean }> {
  try {
    const powerState = await getPowerState();
    const health = selfHealth.sample();
    const resp = await client.heartbeat({
      powerState,
      uptimeSeconds: getUptimeSeconds(),
      agentVersion: AGENT_VERSION,
      cpuPercent: health.cpuPercent,
      memoryMb: health.memoryMb,
      errorCount: selfHealth.errorCount,
      lastErrorAt: selfHealth.lastErrorAt?.toISOString(),
      lastErrorMessage: selfHealth.lastErrorMessage,
    });
    const revoked = resp.revoked === true;
    log('info', 'heartbeat ok', { powerState, cpuPercent: health.cpuPercent, memoryMb: health.memoryMb, revoked });

    // Clock skew check. Backend echoes `serverTime` on every heartbeat
    // (added in the same god-mode pass on the backend side, optional
    // for back-compat with older deployments). When the laptop's RTC
    // is dead, daylight-savings was misapplied, or the user manually
    // misconfigured the timezone, every timestamp the agent emits is
    // wrong by the same offset and the productivity rollups silently
    // ship garbage. Warn at 5 min skew; the operator can act on the
    // selfHealth lastErrorMessage in the dashboard.
    if (resp.serverTime) {
      const skewSeconds = Math.abs(Date.now() - new Date(resp.serverTime).getTime()) / 1000;
      if (skewSeconds > 300) {
        log('warn', 'clock skew detected — laptop clock differs from server', {
          skewSeconds: Math.round(skewSeconds),
          serverTime: resp.serverTime,
        });
        // Surface to the next heartbeat / snapshot as agent-health
        // metadata. selfHealth gives the dashboard a "this agent has
        // a known issue" badge without needing a separate alert
        // channel.
        selfHealth.recordError(`clock skew ${Math.round(skewSeconds)}s`);
      }
    }

    return { revoked };
  } catch (err) {
    // 401/403 → permanent. Propagate as revoked so the main loop
    // stops the service cleanly. Same end state as the in-band
    // {revoked:true} response, just delivered via the error channel.
    if (err instanceof AuthRevokedError) {
      log('warn', 'heartbeat auth revoked', { status: err.status });
      return { revoked: true };
    }
    log('error', 'heartbeat failed', { error: scrubError(err) });
    return { revoked: false };
  }
}

async function sendSnapshot(client: PulseApiClient) {
  log('info', 'snapshot starting…');
  try {
    // Drain state-time + app-time buckets BEFORE the heavy collectors
    // so a long-running snapshot doesn't bias the next window's
    // accounting.
    const stateTime = stateAccumulator.drainAndReset();

    const [powerState, posture, software, patches, battery, disk, network] = await Promise.all([
      getPowerState(),
      getSecurityPosture(),
      getInstalledSoftware(),
      getMissingPatches(),
      // Wave 9 — agent resilience signals.
      getBatteryStatus(),
      getDiskFree(),
      getNetworkProfile(),
    ]);

    const sessionStart = getCurrentSessionStart();
    const procCount = getRunningProcessCount();
    // Wave 9 — background tamper-process scan. Synchronous (single
    // PowerShell spawn) — cheap given the once-per-snapshot cadence.
    const tamperProcs = getRunningTamperProcesses();

    const appBuckets = stateTime.apps.map((a) => ({
      appName: a.appName,
      appDisplayName: a.appDisplayName ?? undefined,
      lastWindowTitle: a.lastWindowTitle ?? undefined,
      foregroundSeconds: a.foregroundSeconds,
      category: a.category,
      categoryReason: a.categoryReason ?? undefined,
    }));

    const result = await client.snapshot({
      powerState,
      uptimeSeconds: getUptimeSeconds(),
      lastBootAt: getLastBootAt().toISOString(),
      currentSessionStart: sessionStart ? sessionStart.toISOString() : undefined,
      runningProcessCount: procCount,
      loggedInUserName: getLoggedInUserName(),
      defenderEnabled: posture.defenderEnabled ?? undefined,
      firewallEnabled: posture.firewallEnabled ?? undefined,
      bitlockerEnabled: posture.bitlockerEnabled ?? undefined,
      rebootRequired: posture.rebootRequired ?? undefined,
      unsupportedOs: posture.unsupportedOs ?? undefined,
      installedSoftware: software,
      missingPatches: patches,
      activeSecondsBucket: stateTime.activeSeconds,
      idleSecondsBucket: stateTime.idleSeconds,
      lockedSecondsBucket: stateTime.lockedSeconds,
      appBucketStart: stateTime.bucketStart.toISOString(),
      appBucketEnd: stateTime.bucketEnd.toISOString(),
      appBuckets,
      // Wave 9 — agent resilience.
      runningTamperProcesses: tamperProcs.length > 0 ? tamperProcs : undefined,
      batteryPercent: battery.percent ?? undefined,
      batteryCharging: battery.charging ?? undefined,
      batteryHealthPercent: battery.healthPercent ?? undefined,
      diskFreePercent: disk.freePercent ?? undefined,
      diskFreeGb: disk.freeGb ?? undefined,
      networkType: network.type,
      networkConnectivity: network.connectivity,
      agentVersion: AGENT_VERSION,
    });
    log('info', 'snapshot ok', {
      riskScore: result.riskScore,
      riskLevel: result.riskLevel,
      alerts: result.openAlertCount,
      softwareCount: software.length,
      patchCount: patches.length,
      activeSeconds: stateTime.activeSeconds,
      idleSeconds: stateTime.idleSeconds,
      lockedSeconds: stateTime.lockedSeconds,
      appCount: appBuckets.length,
      sessionStart: sessionStart?.toISOString() ?? null,
      processes: procCount,
      tamperProcs: tamperProcs.length,
      batteryPercent: battery.percent,
      diskFreePercent: disk.freePercent,
      networkType: network.type,
      networkConnectivity: network.connectivity,
    });
  } catch (err) {
    // 401/403 on the snapshot path is the same signal as on heartbeat
    // — propagate so the main loop terminates cleanly. We rethrow
    // (rather than swallowing like below) so the snapshot interval's
    // catch block can pick it up and tear the agent down.
    if (err instanceof AuthRevokedError) {
      log('warn', 'snapshot auth revoked', { status: err.status });
      throw err;
    }
    log('error', 'snapshot failed', { error: scrubError(err) });
  }
}

// ─── CLI arg parsing ─────────────────────────────────────────────────
//
// Minimal arg parser — no yargs / commander dep. Supports the install-
// time flags the .exe installer passes:
//
//   PulseAgent.exe --server-url <url> --enroll <det_…>
//   PulseAgent.exe --help
//   PulseAgent.exe --version
//
// All flags can also be set via env vars: PULSE_SERVER_URL,
// PULSE_ENROLLMENT_TOKEN.

interface CliFlags {
  serverUrl?: string;
  enrollmentToken?: string;
  showHelp?: boolean;
  showVersion?: boolean;
}

function parseCliFlags(argv: string[]): CliFlags {
  const out: CliFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help':
      case '-h':
        out.showHelp = true;
        break;
      case '--version':
      case '-v':
        out.showVersion = true;
        break;
      case '--server-url':
        out.serverUrl = argv[++i];
        break;
      case '--enroll':
      case '--enrollment-token':
        out.enrollmentToken = argv[++i];
        break;
    }
  }
  // Env fallbacks.
  out.serverUrl ??= process.env.PULSE_SERVER_URL;
  out.enrollmentToken ??= process.env.PULSE_ENROLLMENT_TOKEN;
  return out;
}

function printHelp(): void {
  console.log(`Exargen Pulse Agent v${AGENT_VERSION}

Usage:
  PulseAgent.exe [options]

Options:
  --server-url <url>     Backend base URL (ends in /api/v1). Required
                         on first run if config.json is empty.
  --enroll <token>       Single-use enrollment token (det_…). Required
                         on first run if no apiKey is persisted yet.
  --version              Print version and exit.
  --help                 Print this help and exit.

Environment variables:
  PULSE_SERVER_URL          Same as --server-url
  PULSE_ENROLLMENT_TOKEN    Same as --enroll
  PULSE_CONFIG_PATH         Override the default config.json location

Without flags, the agent loads config from %ProgramData%\\ExargenPulse\\config.json.
The .exe installer writes that file for you — flags exist for unattended
deploys and embedded-token installer scenarios.
`);
}

async function main() {
  const flags = parseCliFlags(process.argv.slice(2));
  if (flags.showHelp) {
    printHelp();
    return;
  }
  if (flags.showVersion) {
    console.log(AGENT_VERSION);
    return;
  }

  let config: AgentConfig;
  // If we have flags OR no config file exists, run bootstrap so the
  // .exe-with-args path works without anyone hand-editing config.json.
  if (flags.serverUrl || flags.enrollmentToken) {
    config = bootstrapConfig({
      serverUrl: flags.serverUrl,
      enrollmentToken: flags.enrollmentToken,
    });
  } else {
    config = loadConfig();
  }
  config = await enrollIfNeeded(config);

  const client = new PulseApiClient({
    serverUrl: config.serverUrl,
    apiKey: config.apiKey!,
  });

  // Send one of each immediately at boot so the dashboard reflects
  // recent reality without waiting a full interval.
  const firstHeartbeat = await sendHeartbeat(client);
  if (firstHeartbeat.revoked) {
    // Wave 9 — remote kill switch. SUPER_ADMIN revoked this device
    // while the agent was offline; first heartbeat after boot picks
    // up `revoked: true` and we exit before scheduling work.
    log('warn', 'Device has been revoked by SUPER_ADMIN — agent exiting cleanly. Re-enroll with a fresh token if needed.');
    return;
  }
  try {
    await sendSnapshot(client);
  } catch (err) {
    if (err instanceof AuthRevokedError) {
      log('warn', 'Initial snapshot revealed revoked credentials — agent exiting cleanly.');
      return;
    }
    throw err;
  }

  const heartbeatMs = (config.heartbeatIntervalSeconds ?? 300) * 1000;
  const snapshotMs = (config.snapshotIntervalSeconds ?? 3600) * 1000;

  // ─── Shared shutdown path ──────────────────────────────────────────
  //
  // Three independent triggers can stop the agent:
  //
  //   1. Heartbeat response carries `{revoked: true}` (in-band kill
  //      switch from SUPER_ADMIN).
  //   2. Heartbeat / snapshot throws AuthRevokedError (401/403 — the
  //      backend forgot us or rotated the key).
  //   3. NSSM sends SIGTERM (service stop, Windows shutdown, uninstall).
  //
  // All three converge on `stopAgent(reason)`. Idempotent — a SIGTERM
  // arriving while a revocation shutdown is mid-flight is a no-op.
  // We exit(0) in every case so NSSM treats the stop as intentional
  // and doesn't restart-loop us through the same failing state.

  let stopped = false;
  const stopAgent = (reason: string, exitCode = 0) => {
    if (stopped) return;
    stopped = true;
    log('info', 'Pulse agent shutting down', { reason });
    clearInterval(tickHandle);
    clearInterval(heartbeatHandle);
    clearInterval(snapshotHandle);
    // Best-effort drain — give the JSON logger a tick to flush stdout
    // (NSSM redirects stdout to a log file, and stdout is line-buffered)
    // before the process leaves. 250ms is more than enough for a few
    // KB of log lines on any reasonable disk.
    setTimeout(() => process.exit(exitCode), 250);
  };

  // State-time accumulator ticks ~every 30s, regardless of heartbeat/
  // snapshot cadence. The buckets are drained + reset on each snapshot.
  //
  // Wave 10 — wrap each interval callback in a defensive try/catch so
  // a stray throw inside the awaited work doesn't surface as an
  // unhandledRejection and kill the agent service. NSSM would restart
  // us, but the dashboard would briefly flash the device as down.
  const tickHandle = setInterval(() => {
    void (async () => {
      if (stopped) return;
      try {
        await stateAccumulator.tick();
      } catch (err) {
        log('error', 'state-time tick threw', { error: scrubError(err) });
      }
    })();
  }, TICK_INTERVAL_MS);
  const snapshotHandle = setInterval(() => {
    void (async () => {
      if (stopped) return;
      try {
        await sendSnapshot(client);
      } catch (err) {
        if (err instanceof AuthRevokedError) {
          stopAgent('auth-revoked-on-snapshot');
          return;
        }
        log('error', 'snapshot interval threw outside sendSnapshot', {
          error: scrubError(err),
        });
      }
    })();
  }, snapshotMs);
  // Wave 9 — heartbeat timer holds a kill-switch check. When the
  // backend tells us we're revoked, clear all timers and exit so the
  // service supervisor can either restart us (and we'll re-detect
  // and exit again) or accept the clean shutdown.
  //
  // Wave 10 defence-in-depth: any throw OUTSIDE sendHeartbeat's own
  // try/catch (e.g. process.cpuUsage failure, an OOM, a stray
  // rejection from process.exit timing) would otherwise leak as an
  // unhandledRejection — which is fatal under Node ≥ 15 default
  // settings, instantly killing the agent service. NSSM would
  // restart it, but we'd lose the heartbeat for ~5s and the dashboard
  // would briefly flash the device as down. Catching here keeps
  // transient errors local.
  const heartbeatHandle: NodeJS.Timeout = setInterval(() => {
    void (async () => {
      if (stopped) return;
      try {
        const r = await sendHeartbeat(client);
        if (r.revoked) {
          stopAgent('device-revoked');
        }
      } catch (err) {
        log('error', 'heartbeat interval threw outside sendHeartbeat', {
          error: scrubError(err),
        });
      }
    })();
  }, heartbeatMs);

  // ─── Graceful shutdown — SIGTERM / SIGINT (god-mode 2026-05-30) ───
  //
  // NSSM sends SIGTERM when the service stops (Windows shutdown, manual
  // `Stop-Service`, uninstall). Node ignores SIGTERM by default, so
  // without this handler the agent would die mid-tick: any in-flight
  // POST is dropped, the current hour's app buckets are lost from
  // memory, and the next NSSM startup loses 5–60 min of attribution.
  //
  // Catching SIGTERM lets us:
  //   • Clear the timers cleanly (no zombie callbacks during teardown).
  //   • Exit(0) so NSSM logs a "stopped normally" entry instead of
  //     "service crashed".
  //   • Let log lines flush before the process actually leaves
  //     (the `setTimeout(exit, 250)` in stopAgent).
  //
  // SIGINT (ctrl+c during `npm run dev`) wires through the same path
  // so the dev experience matches prod.
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => stopAgent(`signal-${sig.toLowerCase()}`));
  }

  log('info', 'Pulse agent running', {
    heartbeatSeconds: heartbeatMs / 1000,
    snapshotSeconds: snapshotMs / 1000,
    stateTimeTickSeconds: TICK_INTERVAL_MS / 1000,
  });
}

main().catch((err) => {
  // 2026-05-30: scrubError instead of String(err) so a credential in
  // a thrown error message never reaches the NSSM log file.
  log('error', 'Fatal: agent failed to start', { error: scrubError(err) });
  process.exit(1);
});
