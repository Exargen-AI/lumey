/**
 * Pulse Agent — telemetry collectors (Windows-first).
 *
 * Each collector returns a Promise that resolves to the relevant slice.
 * All shell-outs go through PowerShell / wmic / CIM queries with bounded
 * timeouts; failures degrade to a `null` / `undefined` field rather than
 * aborting the snapshot.
 *
 * Why PowerShell and not a native binding? The agent has to package
 * into a single .exe via `pkg`, which doesn't support N-API modules
 * well. PowerShell is universally available on Windows 10+ and gives
 * us everything we need with one tool.
 *
 * macOS / Linux collectors are stubs — Pulse v1 is Windows-only. We
 * keep the platform abstraction so non-Windows hosts can no-op
 * gracefully when the agent is mistakenly installed on one.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const POWERSHELL_TIMEOUT_MS = 30_000;

function runPs(cmd: string): string {
  if (process.platform !== 'win32') return '';
  // We used to inline the script via `-Command "..."` with quote-escaping,
  // but cmd.exe mangles multi-line scripts (newlines collapse, $-expansion
  // surprises, quoting hell). Writing to a temp .ps1 file and running via
  // `-File` is bulletproof — PowerShell reads the file verbatim, no shell
  // escaping involved. Same approach Microsoft recommends for non-trivial
  // scripts. The temp file is deleted whether the call succeeds or fails.
  let tempFile = '';
  try {
    tempFile = path.join(
      os.tmpdir(),
      `pulse-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`,
    );
    fs.writeFileSync(tempFile, cmd, 'utf8');
    // Wave 11 — `windowsHide: true` passes the CREATE_NO_WINDOW flag
    // (0x08000000) to CreateProcess. Without it, Node briefly allocates
    // conhost.exe → visible black flash on the user's desktop even
    // though PowerShell will immediately apply `-NonInteractive`.
    // Critical when the agent ever runs in foreground / dev mode; in
    // SYSTEM Session-0 mode it's belt-and-braces (Session 0 has no
    // visible desktop, but services have been observed inheriting an
    // unrelated console handle on locked-down domain configs).
    return execSync(
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tempFile}"`,
      { encoding: 'utf8', timeout: POWERSHELL_TIMEOUT_MS, windowsHide: true },
    ).trim();
  } catch (err) {
    // Surface the failure on stderr so debugging "why is everything 0?"
    // doesn't require sleuthing. Stays out of the structured agent log.
    console.error(
      `[pulse-agent] PowerShell failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return '';
  } finally {
    if (tempFile) {
      try {
        fs.unlinkSync(tempFile);
      } catch {
        /* ignore — temp file cleanup is best-effort */
      }
    }
  }
}

function safeJsonParse<T>(raw: string): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ─── Power / lock state ──────────────────────────────────────────────

export type PowerState = 'ON' | 'IDLE' | 'LOCKED' | 'OFF';

// LEGACY — kept as a type comment for the pre-WTS-fix implementation.
// The new WTS-aware probe returns { state, idleSeconds } inline.
interface LockStateProbe {
  locked: boolean;
  idleSeconds: number;
}

const IDLE_THRESHOLD_SECONDS = 5 * 60;

/**
 * Cost model: each `getPowerState()` call spawns a fresh PowerShell
 * process (~200–500ms cold-start, ~50 MB RAM during the run). The
 * state-time accumulator ticks every 30s, and the heartbeat ticks
 * every 5 min — without caching, that's ~125 spawns/hour just for
 * productivity tracking.
 *
 * The cache below short-circuits any caller that runs within
 * `POWER_STATE_CACHE_TTL_MS` of the previous probe — typically halves
 * spawn rate to ~60/hour while preserving lock-attribution granularity
 * to within one cache window.
 *
 * Future optimisation: replace the PowerShell probe with a koffi /
 * ffi-napi binding against user32.dll (`GetForegroundWindow`,
 * `GetLastInputInfo`). Eliminates the PowerShell hot path entirely
 * (~100× faster, no spawn cost) — but needs verification that koffi
 * packages cleanly with `pkg`. Deferred to a follow-up PR.
 */
const POWER_STATE_CACHE_TTL_MS = 60_000;

let cachedPowerState: PowerState | null = null;
let cachedPowerStateAt = 0;

/**
 * For tests + maintenance: force a fresh probe on the next call.
 */
export function invalidatePowerStateCache(): void {
  cachedPowerState = null;
  cachedPowerStateAt = 0;
}

export async function getPowerState(): Promise<PowerState> {
  if (process.platform !== 'win32') return 'ON';

  const now = Date.now();
  if (
    cachedPowerState !== null &&
    now - cachedPowerStateAt < POWER_STATE_CACHE_TTL_MS
  ) {
    return cachedPowerState;
  }

  // The agent runs as LocalSystem (Session 0). GetLastInputInfo and
  // GetForegroundWindow are PER-SESSION — called from Session 0, they
  // return "always idle" and "no foreground window" regardless of what
  // the real user is doing. The result was every heartbeat reporting
  // IDLE even when the user was actively typing.
  //
  // The cross-session fix: WTSQuerySessionInformation(WTSSessionInfo)
  // returns a WTSINFOW struct for an arbitrary session, including its
  // LastInputTime + CurrentTime + connect state. We use
  // WTSGetActiveConsoleSessionId to find the user's physical-console
  // session, then query that. Works correctly when called from SYSTEM.
  //
  // Session state mapping → PowerState:
  //   WTSActive (0)        + idle < 5min  → ON
  //   WTSActive (0)        + idle ≥ 5min  → IDLE
  //   WTSConnected (1) / WTSDisconnected (4) — typical of locked/RDP-
  //   disconnected screens → LOCKED
  //   Anything else (no console session, init, down)  → OFF
  const probeScript = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class WtsProbe {
        [DllImport("kernel32.dll")] public static extern uint WTSGetActiveConsoleSessionId();
        [DllImport("Wtsapi32.dll", CharSet=CharSet.Unicode)]
        public static extern bool WTSQuerySessionInformationW(IntPtr hServer, uint sessionId, int infoClass, out IntPtr ppBuffer, out uint pBytesReturned);
        [DllImport("Wtsapi32.dll")] public static extern void WTSFreeMemory(IntPtr pMemory);
        public const int WTSSessionInfo = 24;
        [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
        public struct WTSINFOW {
          public int State;
          public uint SessionId;
          public uint IncomingBytes;
          public uint OutgoingBytes;
          public uint IncomingFrames;
          public uint OutgoingFrames;
          public uint IncomingCompressedBytes;
          public uint OutgoingCompressedBytes;
          [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 33)] public string WinStationName;
          [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 17)] public string Domain;
          [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 21)] public string UserName;
          public long ConnectTime;
          public long DisconnectTime;
          public long LastInputTime;
          public long LogonTime;
          public long CurrentTime;
        }
      }
"@
    $sid = [WtsProbe]::WTSGetActiveConsoleSessionId()
    if ($sid -eq [uint32]::MaxValue) {
      '{"state":-1,"idleSeconds":0}' | Out-String; return
    }
    $pBuf = [IntPtr]::Zero
    $bytes = 0
    $ok = [WtsProbe]::WTSQuerySessionInformationW([IntPtr]::Zero, $sid, [WtsProbe]::WTSSessionInfo, [ref]$pBuf, [ref]$bytes)
    if (-not $ok) {
      '{"state":-1,"idleSeconds":0}' | Out-String; return
    }
    try {
      $info = [System.Runtime.InteropServices.Marshal]::PtrToStructure($pBuf, [Type]([WtsProbe+WTSINFOW]))
      # LastInputTime / CurrentTime are 100ns ticks (FILETIME-style).
      $idleTicks = $info.CurrentTime - $info.LastInputTime
      $idleSeconds = [Math]::Floor($idleTicks / 10000000)
      [PSCustomObject]@{ state = [int]$info.State; idleSeconds = [int]$idleSeconds } | ConvertTo-Json -Compress
    } finally {
      [WtsProbe]::WTSFreeMemory($pBuf)
    }
  `;
  const probe = safeJsonParse<{ state: number; idleSeconds: number }>(runPs(probeScript));
  let next: PowerState;
  if (!probe || probe.state === -1) {
    next = 'OFF';
  } else if (probe.state === 1 /*Connected*/ || probe.state === 4 /*Disconnected*/) {
    // Typical of locked screen / RDP-disconnected user.
    next = 'LOCKED';
  } else if (probe.state !== 0 /*not Active*/) {
    // WTSInit / WTSDown / WTSListen etc. — no real user session.
    next = 'OFF';
  } else if (probe.idleSeconds > IDLE_THRESHOLD_SECONDS) {
    next = 'IDLE';
  } else {
    next = 'ON';
  }

  cachedPowerState = next;
  cachedPowerStateAt = now;
  return next;
}

// ─── Uptime / boot time ──────────────────────────────────────────────

export function getUptimeSeconds(): number {
  return Math.floor(os.uptime());
}

export function getLastBootAt(): Date {
  return new Date(Date.now() - os.uptime() * 1000);
}

// ─── Logged-in user ──────────────────────────────────────────────────

export function getLoggedInUserName(): string | undefined {
  try {
    return os.userInfo().username;
  } catch {
    return undefined;
  }
}

// ─── Security posture (Windows) ──────────────────────────────────────

export interface SecurityPosture {
  defenderEnabled: boolean | null;
  firewallEnabled: boolean | null;
  bitlockerEnabled: boolean | null;
  rebootRequired: boolean | null;
  unsupportedOs: boolean | null;
}

export async function getSecurityPosture(): Promise<SecurityPosture> {
  if (process.platform !== 'win32') {
    return {
      defenderEnabled: null,
      firewallEnabled: null,
      bitlockerEnabled: null,
      rebootRequired: null,
      unsupportedOs: null,
    };
  }

  const script = `
    $av = $null
    try { $av = (Get-MpComputerStatus -ErrorAction Stop).RealTimeProtectionEnabled } catch {}

    $fw = $null
    try {
      $profiles = Get-NetFirewallProfile -ErrorAction Stop
      $fw = ($profiles | Where-Object { $_.Enabled -eq $true } | Measure-Object).Count -gt 0
    } catch {}

    $bl = $null
    try {
      $sys = Get-BitLockerVolume -ErrorAction Stop | Where-Object { $_.VolumeType -eq 'OperatingSystem' }
      $bl = $sys -and $sys.ProtectionStatus -eq 1
    } catch {}

    $reboot = $false
    if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') { $reboot = $true }
    if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending') { $reboot = $true }

    $os = Get-CimInstance Win32_OperatingSystem
    $build = [int]$os.BuildNumber
    # Win10 < 19041 (20H2 baseline) treated as unsupported. Win11 OK.
    $unsupported = $build -gt 0 -and $build -lt 19041

    [PSCustomObject]@{
      defenderEnabled = $av
      firewallEnabled = $fw
      bitlockerEnabled = $bl
      rebootRequired = $reboot
      unsupportedOs = $unsupported
    } | ConvertTo-Json -Compress
  `;
  const parsed = safeJsonParse<SecurityPosture>(runPs(script));
  if (!parsed) {
    return {
      defenderEnabled: null,
      firewallEnabled: null,
      bitlockerEnabled: null,
      rebootRequired: null,
      unsupportedOs: null,
    };
  }
  return parsed;
}

// ─── OS version ──────────────────────────────────────────────────────

export interface OsVersion {
  version: string;
  build: string;
  arch: string;
}

export function getOsVersion(): OsVersion {
  if (process.platform !== 'win32') {
    return { version: `${process.platform} ${os.release()}`, build: '', arch: os.arch() };
  }
  const raw = runPs(
    "$os = Get-CimInstance Win32_OperatingSystem; '{0} ({1})' -f $os.Caption, $os.Version",
  );
  const build = runPs('(Get-CimInstance Win32_OperatingSystem).BuildNumber');
  return {
    version: raw || os.release(),
    build,
    arch: os.arch(),
  };
}

// ─── Installed software ──────────────────────────────────────────────

export interface InstalledApp {
  name: string;
  version?: string;
  publisher?: string;
  installDate?: string; // ISO
}

export async function getInstalledSoftware(): Promise<InstalledApp[]> {
  if (process.platform !== 'win32') return [];

  // Read both 64-bit and 32-bit uninstall registries. Newer machines
  // also have Get-AppxPackage entries but those are mostly OS UWP
  // bundles — skip for v1 to keep the inventory focused on installed
  // applications.
  const script = `
    $keys = @(
      'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    )
    $apps = foreach ($k in $keys) {
      Get-ItemProperty -Path $k -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -and $_.SystemComponent -ne 1 } |
        Select-Object @{n='name';e={$_.DisplayName}},
                      @{n='version';e={$_.DisplayVersion}},
                      @{n='publisher';e={$_.Publisher}},
                      @{n='installDate';e={$_.InstallDate}}
    }
    $apps | ConvertTo-Json -Compress -Depth 3
  `;
  const raw = runPs(script);
  const parsed = safeJsonParse<InstalledApp[] | InstalledApp>(raw) ?? [];
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list
    .filter((a) => !!a.name)
    .map((a) => ({
      name: a.name,
      version: a.version || undefined,
      publisher: a.publisher || undefined,
      installDate: parseRegInstallDate(a.installDate),
    }));
}

function parseRegInstallDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Registry format is yyyymmdd. Convert to ISO.
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return undefined;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// ─── Missing patches (Windows Update) ────────────────────────────────

export interface MissingPatch {
  patchId: string;
  title?: string;
  classification?: string;
  severity?: string;
  releasedAt?: string;
}

export async function getMissingPatches(): Promise<MissingPatch[]> {
  if (process.platform !== 'win32') return [];

  // Use the Windows Update Agent COM API. This call can be slow (10-30s
  // on a fresh boot) — the snapshot loop runs hourly so amortizing the
  // cost is fine.
  const script = `
    try {
      $session = New-Object -ComObject Microsoft.Update.Session
      $searcher = $session.CreateUpdateSearcher()
      $result = $searcher.Search("IsInstalled=0 and IsHidden=0")
      $patches = foreach ($u in $result.Updates) {
        $kb = ($u.KBArticleIDs | ForEach-Object { 'KB' + $_ }) -join ','
        $sev = $u.MsrcSeverity
        $cat = ($u.Categories | ForEach-Object { $_.Name }) -join ','
        [PSCustomObject]@{
          patchId = if ($kb) { $kb } else { $u.Identity.UpdateID }
          title = $u.Title
          classification = $cat
          severity = $sev
          releasedAt = if ($u.LastDeploymentChangeTime) { $u.LastDeploymentChangeTime.ToString('o') } else { $null }
        }
      }
      $patches | ConvertTo-Json -Compress -Depth 3
    } catch {
      '[]'
    }
  `;
  const raw = runPs(script);
  const parsed = safeJsonParse<MissingPatch[] | MissingPatch>(raw) ?? [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

// ─── Foreground app probe (high-frequency, 30-sec tick) ───────────────
//
// Returns the app name and window title of whatever has focus right
// now. This is the high-volume signal that drives per-app time
// accounting in the state-time accumulator.
//
// IMPLEMENTATION NOTE — Why we read a JSON file instead of calling
// GetForegroundWindow directly:
//
//   The agent runs as LocalSystem (Session 0). GetForegroundWindow,
//   GetWindowText, and GetWindowThreadProcessId are PER-SESSION Win32
//   APIs — called from Session 0 they return either NULL or the
//   service desktop's own window, never the logged-on user's
//   foreground app. That was the long-standing reason per-app
//   foreground time stayed at 0 in production.
//
//   The fix (PR #31 → PR #32) is a scheduled task
//   `ExargenPulseUserProbe` running every minute under the logged-on
//   user's session (`/RU INTERACTIVE`). As of PR #32 the probe is a
//   Go-compiled `user-probe.exe` built with `-H=windowsgui` so
//   Windows never allocates a console host — zero visible flash on
//   the 1-min cadence. (PR #31 originally shipped this as a .ps1;
//   PowerShell.exe is console-subsystem and conhost.exe flashed
//   briefly before -WindowStyle Hidden could suppress the window.)
//
//   The probe writes a small JSON document to
//   %ProgramData%\ExargenPulse\probe\foreground.json, which this
//   function reads. Cost: ~3 ms cold-start, ~6 KB write per minute.
//
// Staleness:
//   The probe file's `capturedAt` is checked against
//   FOREGROUND_PROBE_MAX_AGE_MS. If the file is missing or older than
//   the threshold (e.g. user logged off, task disabled, screen
//   locked for a while), we treat the foreground as unknown and
//   return null. Per-app rows are then absent from that snapshot,
//   which is the behavior we want — we'd rather under-report than
//   pin "last seen app" to whatever the user was doing 30 minutes ago.

export interface ForegroundApp {
  appName: string;            // e.g. "chrome.exe"
  appDisplayName: string | null;  // e.g. "Google Chrome"
  windowTitle: string;        // "(2) Slack | exargen | Pankaj Vudutha"
}

/**
 * Path the user-session scheduled task writes to. Hard-coded to the
 * ProgramData location the installer / PulseAgent.iss uses; we don't
 * accept overrides because the path is part of the install contract.
 */
const FOREGROUND_PROBE_PATH = path.join(
  process.env.ProgramData || 'C:\\ProgramData',
  'ExargenPulse',
  'probe',
  'foreground.json',
);

/**
 * 5 minutes. The probe runs every 60 seconds; anything older than
 * 5× the cadence means the task isn't firing (user logged off,
 * scheduled task disabled, AV quarantine) and we shouldn't trust
 * the data anymore.
 */
const FOREGROUND_PROBE_MAX_AGE_MS = 5 * 60 * 1000;

interface ProbeFileShape {
  capturedAt: string;
  sessionId?: number;
  userName?: string;
  hasForeground: boolean;
  appName: string;
  appDisplayName: string | null;
  windowTitle: string;
}

export async function getForegroundApp(): Promise<ForegroundApp | null> {
  if (process.platform !== 'win32') return null;

  let raw: string;
  try {
    raw = fs.readFileSync(FOREGROUND_PROBE_PATH, 'utf8');
  } catch {
    // File missing — task hasn't fired yet (fresh install, no logon),
    // or the probe was uninstalled. Either way: no foreground data.
    return null;
  }

  // Strip a UTF-8 BOM if the writer ever leaves one. user-probe.ps1
  // writes without a BOM, but harden-pulse.ps1 has been known to
  // touch the file too, and PowerShell 5.1 `Set-Content -Encoding UTF8`
  // adds one by default.
  const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const parsed = safeJsonParse<ProbeFileShape>(cleaned);
  if (!parsed || !parsed.capturedAt) return null;

  const captured = Date.parse(parsed.capturedAt);
  if (!Number.isFinite(captured)) return null;
  if (Date.now() - captured > FOREGROUND_PROBE_MAX_AGE_MS) {
    // Stale — user logged off, screen locked + idle for ages, or the
    // scheduled task is dead. Treat as no foreground rather than
    // double-count old activity.
    return null;
  }

  // Wave 10 guard — refuse foreground attribution when the probe
  // ran in Session 0 (SYSTEM context). The probe scheduled task is
  // registered with `/RU INTERACTIVE` so this should never happen on
  // a healthy machine, but on locked-down domain configs the Task
  // Scheduler has been observed to fall back to SYSTEM when no
  // interactive user is logged on. In that case `sessionId` is 0 and
  // any foreground window the probe sees belongs to the service
  // desktop, not the real user. Attributing that as productive /
  // entertainment activity would silently corrupt scores.
  if (parsed.sessionId === 0) return null;
  if (!parsed.hasForeground || !parsed.appName) return null;
  return {
    appName: parsed.appName,
    appDisplayName: parsed.appDisplayName ?? null,
    windowTitle: parsed.windowTitle ?? '',
  };
}

// ─── Process count (cheap sanity signal) ─────────────────────────────

export function getRunningProcessCount(): number {
  if (process.platform !== 'win32') return 0;
  const raw = runPs('(Get-Process | Measure-Object).Count');
  const n = parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

// ─── Wave 9 — background tamper-process enumeration ─────────────────
//
// The classifier only categorises the FOREGROUND app. A mouse jiggler
// running in the background while the user "uses VSCode" is invisible
// to the foreground TAMPER signal. This collector enumerates ALL
// running processes once per snapshot and returns any whose name
// matches `TAMPER_TOOL_PATTERNS`. Cost: one PowerShell spawn per hour;
// negligible against the existing snapshot cost.
//
// Output goes into `runningTamperProcesses` on the snapshot payload.
// The DEEP_WORK scorer treats a non-empty list the same as a
// foreground TAMPER hit — proportional penalty via `tamperRatio`.

import { TAMPER_TOOL_PATTERNS } from './tamperPatterns';

export interface RunningTamperProcess {
  name: string;
  pid?: number;
}

export function getRunningTamperProcesses(): RunningTamperProcess[] {
  if (process.platform !== 'win32') return [];
  // ProcessName from Get-Process drops the `.exe` suffix on Windows; we
  // append it back before matching so the patterns (which all end in
  // `.exe`) hit. We also accept the full Process.Path basename as a
  // fallback for processes Get-Process returns under an unusual name.
  const raw = runPs(
    `Get-Process | ` +
      `Select-Object @{n='name';e={$_.ProcessName + '.exe'}}, Id | ` +
      `ConvertTo-Json -Compress`,
  );
  const parsed = safeJsonParse<Array<{ name: string; Id: number }> | { name: string; Id: number }>(
    raw,
  );
  if (!parsed) return [];
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const matches: RunningTamperProcess[] = [];
  for (const entry of list) {
    const name = String(entry?.name ?? '').toLowerCase();
    if (!name) continue;
    if (TAMPER_TOOL_PATTERNS.some((p) => p.test(name))) {
      matches.push({ name, pid: Number(entry?.Id) || undefined });
    }
  }
  // Cap at 50; same bound the backend validator enforces. A real
  // machine with > 50 distinct tamper processes is broken in deeper
  // ways than scoring can describe.
  return matches.slice(0, 50);
}

// ─── Wave 9 — battery state ──────────────────────────────────────────

export interface BatteryStatus {
  percent: number | null;
  charging: boolean | null;
  healthPercent: number | null;
}

export async function getBatteryStatus(): Promise<BatteryStatus> {
  if (process.platform !== 'win32') {
    return { percent: null, charging: null, healthPercent: null };
  }
  const script = `
    try {
      $b = Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop
      if (-not $b) {
        '{"percent":null,"charging":null,"healthPercent":null}'
        return
      }
      # BatteryStatus code 2 = charging (per WMI docs).
      $charging = ($b.BatteryStatus -eq 2)
      $health = $null
      try {
        $des = Get-CimInstance -ClassName BatteryStaticData -Namespace 'ROOT\\WMI' -ErrorAction Stop
        $full = Get-CimInstance -ClassName BatteryFullChargedCapacity -Namespace 'ROOT\\WMI' -ErrorAction Stop
        if ($des -and $full -and $des.DesignedCapacity -gt 0) {
          $health = [int](100 * $full.FullChargedCapacity / $des.DesignedCapacity)
        }
      } catch {}
      [PSCustomObject]@{
        percent = [int]$b.EstimatedChargeRemaining
        charging = $charging
        healthPercent = $health
      } | ConvertTo-Json -Compress
    } catch {
      '{"percent":null,"charging":null,"healthPercent":null}'
    }
  `;
  const parsed = safeJsonParse<BatteryStatus>(runPs(script));
  return parsed ?? { percent: null, charging: null, healthPercent: null };
}

// ─── Wave 9 — disk free on OS volume ─────────────────────────────────

export interface DiskFree {
  freePercent: number | null;
  freeGb: number | null;
}

export async function getDiskFree(): Promise<DiskFree> {
  if (process.platform !== 'win32') return { freePercent: null, freeGb: null };
  const script = `
    try {
      $sys = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
      $letter = ($sys.SystemDrive.TrimEnd(':'))
      $drv = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($letter):'" -ErrorAction Stop
      if (-not $drv -or $drv.Size -eq 0) {
        '{"freePercent":null,"freeGb":null}'
        return
      }
      $freePct = [int](100 * $drv.FreeSpace / $drv.Size)
      $freeGb  = [math]::Round($drv.FreeSpace / 1GB, 2)
      [PSCustomObject]@{ freePercent = $freePct; freeGb = $freeGb } | ConvertTo-Json -Compress
    } catch {
      '{"freePercent":null,"freeGb":null}'
    }
  `;
  const parsed = safeJsonParse<DiskFree>(runPs(script));
  return parsed ?? { freePercent: null, freeGb: null };
}

// ─── Wave 9 — network connection profile ─────────────────────────────

export type NetworkType = 'ETHERNET' | 'WIFI' | 'CELLULAR' | 'VPN' | 'UNKNOWN';
export type NetworkConnectivity = 'INTERNET' | 'LOCAL_ONLY' | 'NO_TRAFFIC' | 'UNKNOWN';

export interface NetworkProfile {
  type: NetworkType;
  connectivity: NetworkConnectivity;
}

export async function getNetworkProfile(): Promise<NetworkProfile> {
  if (process.platform !== 'win32') return { type: 'UNKNOWN', connectivity: 'UNKNOWN' };
  const script = `
    try {
      # Pick the active (default-route) interface.
      $prof = Get-NetConnectionProfile -ErrorAction Stop |
        Where-Object { $_.IPv4Connectivity -eq 'Internet' -or $_.IPv6Connectivity -eq 'Internet' } |
        Select-Object -First 1
      if (-not $prof) {
        $prof = Get-NetConnectionProfile -ErrorAction Stop | Select-Object -First 1
      }
      if (-not $prof) {
        '{"type":"UNKNOWN","connectivity":"UNKNOWN"}'
        return
      }
      # Map InterfaceType to our enum. InterfaceType per IANA ifType:
      #   6 = Ethernet, 71 = Wi-Fi, 243/244 = Cellular, 53/131 = VPN.
      $adapter = Get-NetAdapter -InterfaceIndex $prof.InterfaceIndex -ErrorAction SilentlyContinue
      $type = 'UNKNOWN'
      if ($adapter) {
        switch ($adapter.MediaType) {
          '802.3'           { $type = 'ETHERNET' }
          'Native 802.11'   { $type = 'WIFI' }
          'Wireless WAN'    { $type = 'CELLULAR' }
          default {
            # Wave 10 — broader VPN-adapter list. The base regex
            # catches generic VPN/TAP/TUN device descriptions. The
            # rest are explicit product names for clients common in
            # 2026 enterprise deployments (Tailscale + Zscaler are
            # the two most-likely-missing on the original Wave 9 list).
            if ($adapter.InterfaceDescription -match 'VPN|TAP|TUN|Pulse|GlobalProtect|Cisco AnyConnect|OpenVPN|WireGuard|Tailscale|Zscaler|NordLayer|Twingate|Cloudflare WARP|Forticlient|Sophos Connect|Citrix|PAN-GP|Perimeter 81') {
              $type = 'VPN'
            }
          }
        }
      }
      $conn = 'UNKNOWN'
      $any = $prof.IPv4Connectivity, $prof.IPv6Connectivity
      if ($any -contains 'Internet') { $conn = 'INTERNET' }
      elseif ($any -contains 'LocalNetwork') { $conn = 'LOCAL_ONLY' }
      elseif ($any -contains 'NoTraffic' -or $any -contains 'Disconnected') { $conn = 'NO_TRAFFIC' }
      [PSCustomObject]@{ type = $type; connectivity = $conn } | ConvertTo-Json -Compress
    } catch {
      '{"type":"UNKNOWN","connectivity":"UNKNOWN"}'
    }
  `;
  const parsed = safeJsonParse<NetworkProfile>(runPs(script));
  return parsed ?? { type: 'UNKNOWN', connectivity: 'UNKNOWN' };
}

// ─── Current Windows session start ───────────────────────────────────
//
// Distinct from boot time. A laptop might boot at 7am and the user
// logs in at 9am — we care about 9am, not 7am.

export function getCurrentSessionStart(): Date | null {
  if (process.platform !== 'win32') return null;
  // Win32_LogonSession with LogonType in (2, 10, 11) is the interactive
  // session (2 = local console, 10 = remote desktop, 11 = cached creds).
  const script = `
    try {
      $sessions = Get-CimInstance Win32_LogonSession -ErrorAction Stop |
        Where-Object { $_.LogonType -in @(2, 10, 11) -and $_.StartTime } |
        Sort-Object StartTime -Descending
      if ($sessions -and $sessions[0].StartTime) {
        $sessions[0].StartTime.ToUniversalTime().ToString('o')
      }
    } catch {}
  `;
  const raw = runPs(script).trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Tamper tool detection (mouse jiggler etc.) ──────────────────────
//
// A small set of well-known "keep awake" tools. If we see one running,
// we tag it as a TAMPER process so the backend can fire an alert.

// Tamper patterns live in `tamperPatterns.ts` — a tiny pure module so
// the classifier (and its tests) can import them without dragging in
// this file's PowerShell IPC code. Re-exported here for back-compat
// with the existing collector call-sites.
export { TAMPER_TOOL_PATTERNS, isTamperTool } from './tamperPatterns';
