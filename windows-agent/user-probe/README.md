# Pulse Agent — User-Session Foreground Probe

Tiny Go binary that samples the foreground window of the logged-on
user and writes the result to
`%ProgramData%\ExargenPulse\probe\foreground.json`.

## Why this exists

The Pulse agent (`PulseAgent.exe`) runs as `LocalSystem` in Windows
Session 0. The Win32 APIs we use to identify the foreground app —
`GetForegroundWindow`, `GetWindowText`, `GetWindowThreadProcessId` —
are *per-session*. Called from Session 0 they return either `NULL`
or the service desktop's own window, never the logged-on user's app.

This binary is registered as a Task Scheduler job
(`ExargenPulseUserProbe`) with `/RU INTERACTIVE` so it runs under the
console user's token. The agent (still in SYSTEM context) reads the
JSON file the probe writes.

## Why a separate Go binary (not PowerShell)

PR #31 originally shipped this as `user-probe.ps1`. PowerShell.exe is
a CONSOLE-subsystem binary, so every 60-second tick briefly painted
`conhost.exe` on screen before `-WindowStyle Hidden` could suppress
the window. That visible flash was the most-complained-about UX
issue with the v1 agent.

PR #32 replaces it with this Go binary, compiled with
`-ldflags=-H=windowsgui`. GUI-subsystem binaries never allocate a
console host, so the flash disappears entirely. Other wins:

| Property | `.ps1` (v1) | `.exe` (v2) |
|---|---|---|
| Cold start | ~250 ms (Add-Type JIT) | ~3 ms |
| Console flash | yes (conhost.exe) | none |
| Runtime deps | PowerShell 5.1+ / .NET | none |
| Code-signable | not really | yes (signtool) |
| Size | ~6 KB | ~2 MB |

Same approach Defender, Sysmon, CrowdStrike Falcon, Slack helper, and
Teams update agent use for their user-session components.

## Build

Requires Go 1.22+. Cross-compiles from any host (macOS, Linux, WSL).

```bash
cd windows-agent/user-probe
GOOS=windows GOARCH=amd64 \
  go build \
    -trimpath \
    -buildvcs=false \
    -ldflags="-s -w -H=windowsgui" \
    -o ../build/user-probe.exe \
    .
```

Flags:

| Flag | Purpose |
|---|---|
| `-trimpath` | Strip local filesystem paths from the binary (reproducibility) |
| `-buildvcs=false` | Skip embedding VCS info (we don't want commit hashes in the binary) |
| `-s -w` | Strip symbol table + DWARF debug info (smaller binary) |
| `-H=windowsgui` | Compile for the GUI subsystem (no console host) |

`build-installer.ps1` runs this automatically before invoking Inno
Setup.

## Output JSON

```jsonc
{
  "capturedAt":     "2026-05-29T14:35:49.150075000Z",   // RFC3339 UTC
  "sessionId":      1,                                    // 0 = wrong context (Session 0); non-zero = user session
  "userName":       "madge",                              // bare account name (no DOMAIN\ prefix)
  "hasForeground":  true,                                 // false when desktop is locked or no window
  "appName":        "chrome.exe",                         // lowercased base filename
  "appDisplayName": "Google Chrome",                      // FileDescription / ProductName from PE resource
  "windowTitle":    "Inbox (3) - Gmail"                   // current window title
}
```

Atomic write: probe stages to `foreground.json.tmp` then `os.Rename`
into place. `os.Rename` on Windows uses `MoveFileEx` with
`MOVEFILE_REPLACE_EXISTING`, which is atomic on the same volume — the
agent never reads a half-written document.

## Schedule contract

```
schtasks /Create /TN ExargenPulseUserProbe ^
  /SC MINUTE /MO 1 ^
  /RU INTERACTIVE /RL LIMITED ^
  /TR "C:\ProgramData\ExargenPulse\user-probe.exe" ^
  /F
```

The agent treats `foreground.json` as stale if `capturedAt` is older
than 5 minutes (i.e. user logged off, screen locked + idle for a
while, or scheduled task disabled / quarantined).

## Failure modes

The probe is deliberately tiny and swallows all errors. Failure
modes:

| Symptom | Cause | Recovery |
|---|---|---|
| `foreground.json` missing | First-ever run; no user signed in | Auto-resolves once a user signs in |
| `capturedAt` stale (>5 min) | User signed out / locked + idle | Auto-resolves on next user activity |
| `hasForeground: false` | Desktop locked, or no foreground window | Auto-resolves on unlock |
| Task `Last Result: 0x1` | Probe crashed (rare) | Re-run `harden-pulse.ps1` |
| Task not registered | Installer pre-PR-#32, or schtasks failed | Re-run `harden-pulse.ps1` |

The agent treats every failure mode the same way: omit per-app rows
from that snapshot. We'd rather under-report than pin "last seen app"
to whatever the user was doing 30 minutes ago.
