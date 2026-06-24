/**
 * Pulse Agent — config loader.
 *
 * Reads from %ProgramData%\ExargenPulse\config.json on Windows. Falls
 * back to ./pulse-config.json in the working directory for dev runs.
 *
 * Two distinct phases:
 *   1. INSTALL/ENROLL: the installer drops an enrollment token into the
 *      config. The agent reads it on first boot, calls /devices/enroll,
 *      and persists the resulting deviceId + apiKey.
 *   2. STEADY-STATE: enrollmentToken is cleared after consumption. The
 *      agent uses apiKey for all subsequent requests.
 *
 * The config file is permission-restricted (Windows ACL: Administrators
 * + SYSTEM only) by the installer. The agent itself runs as LocalSystem.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AgentConfig {
  // Base URL of the Command Center backend (without trailing slash).
  // Example: "https://command.exargen.in/api/v1".
  serverUrl: string;

  // Single-use bootstrap secret. Present only until the agent successfully
  // enrolls; cleared from config after that.
  enrollmentToken?: string;

  // Set after enrollment. Persisted to config.json.
  deviceId?: string;
  apiKey?: string;

  // Cadence (seconds). Adjustable via the steady-state install config.
  heartbeatIntervalSeconds?: number;
  snapshotIntervalSeconds?: number;

  // Override the auto-detected hostname (handy for VMs / kiosks where
  // the OS name is not user-meaningful).
  hostnameOverride?: string;
}

const DEFAULT_CONFIG: Required<Pick<AgentConfig, 'heartbeatIntervalSeconds' | 'snapshotIntervalSeconds'>> = {
  heartbeatIntervalSeconds: 300, // 5 min
  snapshotIntervalSeconds: 3600, // 60 min
};

function defaultConfigPath(): string {
  if (process.platform === 'win32') {
    const programData = process.env.PROGRAMDATA ?? 'C:\\ProgramData';
    return path.join(programData, 'ExargenPulse', 'config.json');
  }
  // dev fallback
  return path.join(process.cwd(), 'pulse-config.json');
}

export function getConfigPath(): string {
  return process.env.PULSE_CONFIG_PATH ?? defaultConfigPath();
}

// Strip a leading UTF-8 BOM (U+FEFF) before parsing. PowerShell's
// `Set-Content -Encoding UTF8` writes a BOM by default on Windows
// PowerShell 5.1 (the default on Windows 10/11), and JSON.parse
// rejects it with a confusing "Unexpected token" error. Tolerating the
// BOM here means any reasonable text editor or PowerShell invocation
// produces a config file we can read.
//
// The literal BOM character is invisible in source, so we match it
// via the U+FEFF code point in the regex below rather than pasting a
// raw BOM into this file (which would trip no-irregular-whitespace).
const BOM_REGEX = new RegExp('^\\uFEFF');

/**
 * Load the persisted config file. Throws if missing — the installer
 * flow uses `bootstrapConfig` instead, which accepts CLI / installer
 * inputs and writes the file before this is called.
 */
export function loadConfig(): AgentConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Pulse config not found at ${configPath}. ` +
        `Did the installer run? Expected fields: serverUrl, enrollmentToken.`,
    );
  }
  const raw = fs.readFileSync(configPath, 'utf8').replace(BOM_REGEX, '');
  const parsed = JSON.parse(raw) as AgentConfig;
  if (!parsed.serverUrl) {
    throw new Error('Pulse config is missing required field: serverUrl');
  }
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
  };
}

/**
 * Bootstrap a config from CLI overrides, falling back to an existing
 * config file when present. Used by the .exe installer path:
 *
 *   PulseAgent.exe --server-url https://… --enroll det_…
 *
 * Idempotent: re-running with the same arguments after enrollment is a
 * no-op (the persisted apiKey takes precedence over a new enrollment
 * token).
 */
export function bootstrapConfig(overrides: {
  serverUrl?: string;
  enrollmentToken?: string;
}): AgentConfig {
  const configPath = getConfigPath();
  const existing: AgentConfig | null = fs.existsSync(configPath)
    ? (() => {
        try {
          const raw = fs.readFileSync(configPath, 'utf8').replace(BOM_REGEX, '');
          return JSON.parse(raw) as AgentConfig;
        } catch {
          return null;
        }
      })()
    : null;

  // Merge with precedence: existing apiKey/deviceId (post-enrollment
  // state) > CLI overrides > existing config values.
  const merged: AgentConfig = {
    serverUrl: existing?.serverUrl ?? overrides.serverUrl ?? '',
    enrollmentToken: existing?.apiKey
      ? undefined
      : (overrides.enrollmentToken ?? existing?.enrollmentToken),
    deviceId: existing?.deviceId,
    apiKey: existing?.apiKey,
    heartbeatIntervalSeconds:
      existing?.heartbeatIntervalSeconds ?? DEFAULT_CONFIG.heartbeatIntervalSeconds,
    snapshotIntervalSeconds:
      existing?.snapshotIntervalSeconds ?? DEFAULT_CONFIG.snapshotIntervalSeconds,
    hostnameOverride: existing?.hostnameOverride,
  };

  // CLI server URL takes precedence (the installer always passes the
  // current URL, useful for cases where the backend moved).
  if (overrides.serverUrl) merged.serverUrl = overrides.serverUrl;

  if (!merged.serverUrl) {
    throw new Error('serverUrl is required (pass --server-url <url> or write it to config.json).');
  }
  if (!merged.apiKey && !merged.enrollmentToken) {
    throw new Error(
      'enrollmentToken is required on first boot (pass --enroll <token>).',
    );
  }

  // Persist the bootstrap result so the next launch can rely on the
  // file alone.
  saveConfig(merged);
  return merged;
}

export function saveConfig(next: AgentConfig): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // ── Atomic write — write→fsync→rename (2026-05-30 god-mode pass) ──
  //
  // Previous version did `fs.writeFileSync(configPath, …)` directly. If
  // the agent crashed mid-write (power loss, AV pulling the file, an
  // ill-timed `nssm restart`), config.json could end up half-written
  // on disk. The next boot, `JSON.parse(raw)` throws → NSSM restart
  // loops forever on the same broken file → the device falls off the
  // dashboard with no clear cause.
  //
  // The fix is the standard POSIX-style "durable write" dance, ported
  // to Windows (rename within the same volume is atomic on NTFS):
  //
  //   1. Write to <configPath>.tmp.
  //   2. fsync the tmp file so the bytes are on the physical medium
  //      (not just in the OS write cache) before we replace the live
  //      file.
  //   3. rename(tmp → configPath). NTFS guarantees atomicity for
  //      same-volume rename, so any reader either sees the previous
  //      full file or the next full file — never a torn read.
  //
  // Same shape as `user-probe/main.go:writeOutput()` (the Go probe
  // that writes foreground.json) — keeping the patterns aligned.

  const tmpPath = configPath + '.tmp';
  const fd = fs.openSync(tmpPath, 'w', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(next, null, 2), 0, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // Final swap. On Windows, fs.renameSync replaces the destination
  // atomically when both paths sit on the same volume (which they
  // always do — both under %ProgramData%\ExargenPulse).
  fs.renameSync(tmpPath, configPath);
}

export function getHostname(config: AgentConfig): string {
  return config.hostnameOverride ?? os.hostname();
}
