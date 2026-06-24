# Pulse — Installation & Operator Guide

**Audience:** SUPER_ADMINs deploying Pulse to a fleet, employees installing the agent on their laptop, engineers operating the system.
**Status:** v1, live as of 2026-05-28.
**Companion docs:** [01-architecture.md](./01-architecture.md) (design rationale).

---

## Table of contents

1. [What Pulse is (and what it isn't)](#1-what-pulse-is-and-what-it-isnt)
2. [Architecture at a glance](#2-architecture-at-a-glance)
3. [SUPER_ADMIN: deploying to your fleet](#3-super_admin-deploying-to-your-fleet)
4. [Employee: installing the agent on a Windows laptop](#4-employee-installing-the-agent-on-a-windows-laptop)
5. [How the Windows agent works](#5-how-the-windows-agent-works)
6. [What's tracked (the telemetry inventory)](#6-whats-tracked-the-telemetry-inventory)
7. [What's NOT tracked (privacy posture)](#7-whats-not-tracked-privacy-posture)
8. [The risk scoring rubric](#8-the-risk-scoring-rubric)
9. [The Pulse dashboard — UI tour](#9-the-pulse-dashboard--ui-tour)
10. [Operations & troubleshooting](#10-operations--troubleshooting)
11. [Security model](#11-security-model)
12. [Limitations & future work](#12-limitations--future-work)

---

## 1. What Pulse is (and what it isn't)

### What it is

**Pulse is a SUPER_ADMIN-only fleet view** for Exargen Command Center. It surfaces two things about every company laptop in one place:

1. **Device health** — is this laptop secure and up to date? Missing patches, antivirus / firewall / BitLocker status, unsupported OS, risky software, reboot-pending state.
2. **Employee productivity** — is the laptop actively being used? Per-day active / idle / locked time, both per-employee and team-wide.

Telemetry comes from a small headless agent the employee installs on their Windows laptop. The agent runs as a Windows Service (always on, no UI, no tray icon) and ships a heartbeat every ~5 minutes and a full snapshot every ~60 minutes to the Command Center backend over HTTPS.

### Who uses what

| Role | What they see |
|---|---|
| **SUPER_ADMIN** (founder) | The whole `/pulse` dashboard. Issues enrollment tokens, reviews fleet health, drills into individual devices, resolves alerts. |
| **ADMIN / PM / Engineer** | Nothing. The Pulse module is invisible in their sidebar and any direct `/pulse` URL access is 403'd. |
| **Employee** | Their own clock-in/out and standup card on `/today`. They don't see their own device telemetry from the Pulse dashboard; that's a SUPER_ADMIN view. |
| **Windows agent** | Reads its config file, POSTs telemetry. Has no user-facing surface. |

### What Pulse is NOT

- ❌ **Not a corporate MDM** (Mobile Device Management). It does not push policies, install software, or remotely control devices. It only *observes*.
- ❌ **Not a keylogger or screen recorder.** No keystrokes, no window titles, no browser history, no screenshots, no camera/mic. See [§7](#7-whats-not-tracked-privacy-posture).
- ❌ **Not a billing / payroll system.** Time tracking is for visibility, not for paying people. Use the existing Timesheet system for billable hours.

---

## 2. Architecture at a glance

```
┌──────────────────────────────────────┐
│ Employee laptop (Windows 10/11)      │
│                                       │
│  PulseAgent.exe ──► Windows Service  │
│   (runs as LocalSystem)              │
│      │                                │
│      ├─ heartbeat   (~5 min)         │
│      └─ full snapshot (~60 min)      │
└──────────────┬───────────────────────┘
               │ HTTPS
               │ Authorization: Device <api-key>
               ▼
┌──────────────────────────────────────┐
│ Command Center backend (Node/Express)│
│                                       │
│  deviceAuthenticate middleware       │
│  ↓                                    │
│  Telemetry / Risk services           │
│  ↓                                    │
│  PostgreSQL (Prisma)                 │
└──────────────────┬───────────────────┘
                   │
                   ▼
        Pulse dashboard
        (/pulse — SUPER_ADMIN only)
```

### Components

| Component | Where it lives | What it does |
|---|---|---|
| **Windows agent** | `windows-agent/src/` → packages to `PulseAgent.exe` | Collects telemetry, posts to backend |
| **deviceAuthenticate middleware** | `backend/src/middleware/deviceAuthenticate.ts` | sha-256 lookup of `Authorization: Device <key>`; refuses revoked/inactive devices |
| **device.service** | `backend/src/services/device.service.ts` | Enrollment, revocation, ownership |
| **deviceTelemetry.service** | `backend/src/services/deviceTelemetry.service.ts` | Heartbeat + snapshot ingest (transactional) |
| **deviceRisk.service** | `backend/src/services/deviceRisk.service.ts` | Pure-function risk scorer |
| **devicePulse.service** | `backend/src/services/devicePulse.service.ts` | Admin reads (overview, list, detail, alerts, productivity) |
| **Pulse frontend** | `frontend/src/pages/admin/PulsePage.tsx` | The `/pulse` dashboard |

### Database tables

```
devices                       — identity, current state, hashed API key
device_enrollment_tokens      — single-use bootstrap tokens
device_health_snapshots       — hourly history with productivity buckets
device_installed_software     — per-device app inventory (upsert + prune)
device_missing_patches        — outstanding Windows Update KBs
device_risk_alerts            — open / resolved findings
clock_sessions                — employee-self clock in / out
```

---

## 3. SUPER_ADMIN: deploying to your fleet

### Prerequisites

1. Command Center backend is reachable over HTTPS from your employees' laptops. (LAN-only setups won't work — the agent runs even when the employee is at a coffee shop.) Production deploy or an ngrok / Cloudflare Tunnel for testing.
2. You are signed in to the Command Center as a SUPER_ADMIN.
3. You have a list of employees + the laptops they own (so you can pre-bind tokens — optional but recommended).

### Step 1 — Issue an enrollment token per employee

1. Sidebar → **Pulse** → **Enrollment tokens** tab → **Issue token**
2. Fill in:
   - **Note** — free text, e.g. `"Pankaj's MacBook"` or `"Karthik's Dell XPS"`. Shows up in the audit trail.
   - *(Optional)* **Assigned user** — pre-bind the token to an employee. When they enroll, the device shows up as their owned device automatically.
3. Click **Issue**.
4. **The dialog shows a token like `det_<128 hex chars>` — copy it now.** It's shown only once. If you close the dialog without copying, just issue a new token.

Tokens expire after **7 days** by default (configurable per token: 1 hour to 30 days). They are single-use — once the agent consumes one, the row is marked `consumedAt` and the token can't be reused.

### Step 2 — Send the token + install instructions to the employee

You have two paths:

**Path A — interactive install (current v1):** Send the employee the token plus the [§4 install instructions](#4-employee-installing-the-agent-on-a-windows-laptop). They run a handful of PowerShell commands themselves.

**Path B — packaged `.exe` installer (recommended for fleet rollout):** Built via `windows-agent/installer/build-installer.ps1` on a Windows host. Produces `PulseAgentInstaller-X.Y.Z.exe`. You hand each employee one file + their unique token; they double-click → paste token → done. See [§3.1 below](#31-building-the-installer-once).

### 3.1 Building the installer (once)

You build the installer artifact once per release — typically on the same Windows machine where you tested the agent. After that you redistribute the same `.exe` to every employee.

**Prerequisites:**

- Windows machine (your TechGeek laptop is fine)
- Node.js 20+
- Git
- [Inno Setup 6](https://jrsoftware.org/isinfo.php) (free, ~5 MB)
- Optional but recommended: a code-signing cert (Sectigo, DigiCert, etc.) — without one, Windows SmartScreen will warn employees on first run.

**Build steps in admin PowerShell:**

```powershell
cd $env:USERPROFILE
git clone https://github.com/Exargen-AI/exargen-command-center.git
cd exargen-command-center\windows-agent\installer
.\build-installer.ps1                          # unsigned (SmartScreen warning)
# OR, if you have a code-signing cert:
.\build-installer.ps1 -SignWithThumbprint "1234ABCD…"
```

The build:

1. Installs npm deps + builds shared + agent
2. Bundles agent into single `PulseAgent.exe` via Node SEA (or `pkg` with `-UsePkg`)
3. Compiles `installer/PulseAgent.iss` with Inno Setup → `build/PulseAgentInstaller-X.Y.Z.exe`
4. (Optional) signs both binaries with your cert

The artifact is at `windows-agent/build/PulseAgentInstaller-X.Y.Z.exe`. That's the one file you send to every employee.

#### Why NSSM is bundled

The installer ships a 330 KB binary called `nssm.exe` (the Non-Sucking Service Manager — public domain v2.24). NSSM is a single-file service wrapper required because the bundled `PulseAgent.exe` is a regular Node binary; it doesn't implement the Windows Service Control Manager API. Registering it directly via `sc.exe create` causes SCM to time out after 30 seconds waiting for a `SERVICE_RUNNING` status the exe never reports (Windows Event Log IDs 7000 / 7009).

NSSM solves this by being the SCM-compliant service itself. It launches `PulseAgent.exe` as a child process, supervises it (auto-restart on exit), and pipes the agent's stdout/stderr to log files at `C:\ProgramData\ExargenPulse\logs\pulse-agent.{out,err}.log` (rotated at 10 MB).

The PowerShell installer (Option B) uses `node-windows` instead, which generates a different SCM-compliant wrapper at install time. Both approaches are equivalent in behaviour; NSSM is the right choice here because it's a single file that ships in the installer without needing a Node toolchain on the target machine.

### Step 3 — Wait for the agent to enroll

Within ~1 minute of the employee running the install, the device shows up in **Devices** tab. The token row in **Enrollment tokens** flips to "Consumed by device-XXX".

### Step 4 — Day-to-day fleet management

- **Overview tab** every morning — fleet health summary, today's team-active productivity bar.
- **Devices tab** for drill-downs — sort by risk level, filter by status, click a row to see the detail drawer.
- **Alerts tab** for the action queue — auto-opened on each snapshot when penalties fire. Click "Resolve" once you've worked with the employee to fix the underlying condition.
- **Clock log tab** to see today's clock-in/out per employee.

### Step 5 — Offboarding

When an employee leaves:

1. Sidebar → **People** → mark them inactive (existing flow, not Pulse-specific).
2. Sidebar → **Pulse** → **Devices** → find their device → click **Revoke** → enter reason → confirm.

The agent's next API call returns 401 → agent backs off → device row stays for audit. The same hardware can be reassigned to another employee later by issuing a fresh enrollment token with the new user pre-bound.

---

## 4. Employee: installing the agent on a Windows laptop

> **You should have received from your SUPER_ADMIN:**
> - A token starting with `det_` (~130 characters of hex)
> - The Command Center backend URL (e.g. `https://command.exargen.in/api/v1`)

### System requirements

- Windows 10 21H2 or newer, OR Windows 11 (any version)
- Local administrator rights (to install the service)
- Working internet connection
- Node.js 20+ and Git only for **Option B** (the PowerShell flow). **Option A** ships as a single signed `.exe` and needs nothing pre-installed.

### Option A — signed `.exe` installer (recommended for employees, ~30 sec)

#### 1. Get the installer

A SUPER_ADMIN built `PulseAgentInstaller-X.Y.Z.exe` from the repo (`windows-agent/installer/build-installer.ps1`) and distributed it to you (Slack DM, internal file share, etc.). It's a single file, ~50 MB.

#### 2. Run it

1. Double-click `PulseAgentInstaller-X.Y.Z.exe`
2. Windows UAC prompt → click **Yes**
3. The setup wizard opens. Click **Next** through the welcome / install-location pages.
4. On the **Enrollment details** page, paste:
   - **Server URL** — pre-filled with the company default; only change if your SUPER_ADMIN gave you a different one. Must end in `/api/v1`.
   - **Enrollment token** — paste the `det_…` value your SUPER_ADMIN sent you. (Masked while you type to avoid shoulder-surf disclosure.)
5. Click **Next** → **Install**.
6. The installer writes the config (BOM-free, ACL-locked), registers `ExargenPulseAgent` as a Windows Service, configures auto-restart on failure, registers the `ExargenPulseWatchdog` scheduled task, and starts the service.
7. Click **Finish**.

Total time: ~30 seconds. No PowerShell, no git, no Node.

#### 3. Verify (optional)

Open Services (`services.msc`) — you should see `ExargenPulseAgent` with status **Running**.

#### Uninstall

Settings → Apps → search "Exargen Pulse Agent" → Uninstall. The uninstaller stops the service, removes the watchdog task, and deletes `%ProgramData%\ExargenPulse`.

### Option B — one-line PowerShell installer (~3 min)

#### 1. Install Node.js + Git (if you don't already have them)

- **Node.js 20 LTS:** <https://nodejs.org/en/download/> — `.msi` Windows Installer. Default settings, restart PowerShell after.
- **Git for Windows:** <https://git-scm.com/download/win> — default settings.

To verify (in a fresh PowerShell window):

```powershell
node --version
git --version
```

Both should print version numbers.

#### 2. Open PowerShell as Administrator

Press Windows key → type "PowerShell" → right-click "Windows PowerShell" → "Run as administrator". Click "Yes" to the UAC prompt.

#### 3. Paste the one-line installer

```powershell
iex (iwr "https://raw.githubusercontent.com/Exargen-AI/exargen-command-center/main/windows-agent/install-pulse.ps1" -UseBasicParsing).Content
```

The installer will prompt you for:
- **Server URL** — paste the URL your SUPER_ADMIN gave you (e.g. `https://command.exargen.in/api/v1`). If you forget the `/api/v1` part the script appends it automatically.
- **Enrollment token** — paste the `det_…` token.

The installer then runs through these steps automatically (~3 minutes total). You'll see green `[OK]` lines as each one completes:

```
==> Verifying administrator privileges
    [OK] Running as Administrator
==> Checking for Node.js and Git
    [OK] Node v20.18.0
    [OK] git version 2.45.2.windows.1
==> Fetching the agent source (main branch)
==> Installing dependencies and building
    (this is the slow step — ~3 min on first install)
    [OK] Agent built (C:\Program Files\ExargenPulse\src\windows-agent\dist\index.js)
==> Writing configuration
    [OK] Config at C:\ProgramData\ExargenPulse\config.json (ACL: SYSTEM + Administrators only)
==> Smoke-testing enrollment (10 sec)
    [OK] Enrollment successful (deviceId: 0d287013-2350-46a0-85c8-415e24fb5c46)
==> Registering Windows Service (ExargenPulseAgent)
    [OK] Service status: Running

============================================================
  Pulse agent installed and running
============================================================
```

You're done. The service auto-starts on every boot from now on. Close the PowerShell window.

#### 4. (Optional) confirm the dashboard sees you

Ask your SUPER_ADMIN to check the Pulse dashboard. Your laptop should appear in the **Devices** tab within ~1 minute, with status **HEALTHY** and a risk score around **100**.

### Option C — step-by-step manual install (deepest fallback)

Use this only if the one-line installer is blocked (e.g. corporate PowerShell execution policy, no internet during install, etc.).

Open PowerShell as Administrator, then:

```powershell
# 1. Clone + build
cd $env:USERPROFILE
git clone https://github.com/Exargen-AI/exargen-command-center.git pulse-agent
cd pulse-agent
npm install
npm run build --workspace=shared
cd windows-agent
npm install
npm run build

# 2. Write config (REPLACE the URL + token first!)
$json = '{"serverUrl":"https://YOUR-URL/api/v1","enrollmentToken":"det_PASTE-TOKEN"}'
New-Item -ItemType Directory -Force -Path "C:\ProgramData\ExargenPulse" | Out-Null
[System.IO.File]::WriteAllText("C:\ProgramData\ExargenPulse\config.json", $json, (New-Object System.Text.UTF8Encoding $false))

# 3. (Optional) Smoke-test in foreground for 10 sec — Ctrl+C when you
#    see "Pulse agent running"
node dist\index.js

# 4. Install as Windows Service
node dist\install-service.js
Get-Service ExargenPulseAgent  # confirm Running
```

### Uninstalling

If you ever need to remove the agent (leaving the company, reinstalling fresh, etc.):

```powershell
# Open PowerShell as Administrator
cd "C:\Program Files\ExargenPulse\src\windows-agent"
node dist\install-service.js --uninstall

Remove-Item -Recurse -Force "C:\ProgramData\ExargenPulse"
Remove-Item -Recurse -Force "C:\Program Files\ExargenPulse"
```

---

## 5. How the Windows agent works

The agent is a single Node.js process. Source is in [`windows-agent/src/`](../../windows-agent/src/):

| File | Role |
|---|---|
| `index.ts` | Entry point: enrolls (if needed), starts the heartbeat / snapshot / state-time timers |
| `config.ts` | Reads/writes `config.json` from `%ProgramData%\ExargenPulse\` |
| `fingerprint.ts` | Computes the stable hardware fingerprint |
| `api.ts` | Axios wrapper with retry, Idempotency-Key, and inlined wire types |
| `collectors.ts` | All the PowerShell-backed telemetry collectors |
| `install-service.ts` | node-windows Service registration |

### Boot sequence

1. **Read config.** Loads `C:\ProgramData\ExargenPulse\config.json`. If missing, fatal error.
2. **Check enrollment state.**
   - If `apiKey` is already in config → skip to steady-state.
   - Otherwise → call `enrollIfNeeded()`.
3. **Enroll (first boot only):**
   1. Compute the hardware fingerprint (SHA-256 of MachineGuid + BIOS UUID + primary MAC + hostname).
   2. POST `/devices/enroll` with `{ enrollmentToken, fingerprint, hostname, platform, osVersion, agentVersion }`.
   3. Backend creates a `devices` row, generates a fresh API key, returns the cleartext key once.
   4. Agent persists `{ apiKey, deviceId }` to config and clears `enrollmentToken`.
4. **Start three timers:**
   - **State-time tick** every 30 sec → polls power state, accumulates seconds in the right bucket.
   - **Heartbeat** every 5 min → cheap update of last-seen timestamp + current power state.
   - **Snapshot** every 60 min → full telemetry sweep.
5. **Fire one heartbeat + one snapshot immediately** so the dashboard isn't blank during the first hour.

### Hardware fingerprint

```text
fingerprint = sha256(
  MachineGuid                  (HKLM\SOFTWARE\Microsoft\Cryptography)
+ BIOS UUID                    (Get-CimInstance Win32_ComputerSystemProduct)
+ primary MAC                  (os.networkInterfaces())
+ hostname
+ platform + arch
)
```

This makes the fingerprint stable across agent reinstalls on the same physical machine. If the same laptop re-enrolls (e.g. you wiped the config and reissued a token), the backend recognises the existing device row and rotates its API key instead of creating a duplicate.

The fingerprint is opaque to the backend — it's used only as a uniqueness key.

### Enrollment is single-use + bound to a device

- The enrollment token is consumed atomically. Two agents racing with the same token both fail except the first (DB constraint).
- The cleartext API key is shown to the agent ONCE in the enrollment response. The backend only stores `sha256(apiKey)` in `devices.apiKeyHash`.
- All future calls present `Authorization: Device <apiKey>`. The middleware hashes the presented key and looks up the matching device row.

### Heartbeat (cheap, frequent)

```
POST /devices/me/heartbeat
{
  powerState: "ON" | "IDLE" | "LOCKED",
  uptimeSeconds: 685200,
  agentVersion: "0.1.0"
}
```

Backend updates `Device.lastSeenAt`, `currentPowerState`, `lastHeartbeatIp`. No history row. Used by the offline-detection logic (`agentsOffline` count in the Overview).

### Snapshot (heavy, hourly)

```
POST /devices/me/snapshot
{
  powerState, uptimeSeconds, lastBootAt, loggedInUserName,
  defenderEnabled, firewallEnabled, bitlockerEnabled,
  rebootRequired, pendingRebootSince, unsupportedOs,
  installedSoftware: [{ name, version, publisher, installDate }, …],
  missingPatches: [{ patchId, title, classification, severity, releasedAt }, …],
  activeSecondsBucket, idleSecondsBucket, lockedSecondsBucket,
  agentVersion
}
```

The snapshot ingestion runs in **one Prisma transaction** so a mid-write crash doesn't leave half-state:

1. Insert a new `device_health_snapshots` row.
2. Update `Device` denormalised rollup (`currentRiskScore`, `currentRiskLevel`, `lastSeenAt`, etc.).
3. Upsert + prune `device_installed_software` (apps the snapshot didn't mention are deleted — i.e. uninstalled apps disappear).
4. Upsert + prune `device_missing_patches`.
5. Run the risk scorer on the new state.
6. Reconcile `device_risk_alerts` — open new alerts for active penalties, auto-resolve any whose trigger is no longer firing.

The snapshot call carries an `Idempotency-Key` header (sha256 of the body) so a retry-after-network-timeout doesn't create a duplicate snapshot.

### State-time accumulator (productivity)

A 30-second tick polls `getPowerState()` (returns ON / IDLE / LOCKED) and adds the elapsed seconds to the matching bucket. The power-state probe is cached for 60 sec — so the actual PowerShell call fires only every other tick (~60 spawns/hour instead of 120).

At each snapshot, the accumulator drains its three buckets into `activeSecondsBucket`, `idleSecondsBucket`, `lockedSecondsBucket` on the request body, then resets. The backend sums these across snapshots to render today's-active / 7-day chart views.

### PowerShell collectors

All shell-outs use this pattern:

```text
1. Write the PowerShell script to a temp .ps1 file
2. Run: powershell.exe -NoProfile -NonInteractive
        -ExecutionPolicy Bypass -File <temp.ps1>
3. Parse stdout as JSON
4. Delete temp file (finally{})
5. On any error, log to stderr (NOT the structured agent log)
   and return empty
```

The `-File` approach (vs. inlined `-Command`) is critical: cmd.exe mangles multi-line scripts when relayed via `-Command`. The first deploy hit this — installedSoftware silently returned empty arrays. Now any PowerShell failure logs `[pulse-agent] PowerShell failed: …` to stderr so it's visible in `Get-Content C:\Program Files\ExargenPulse\daemon\*.err.log`.

### Resource cost (steady state)

| What | Cost | Frequency |
|---|---|---|
| Agent Node process resting | ~80–150 MB RAM, ~0% CPU | always |
| PowerShell spawn (each) | ~50–80 MB during run, 0.5–3 s of one core | per collector call |
| Power-state probe | (cached 60 sec) | ~60/hour |
| Heartbeat (each) | 1 PS spawn + 1 HTTPS POST | 12/hour |
| Snapshot (each) | 4 parallel PS spawns + Update Search COM + HTTPS POST | 1/hour |
| Update Search peak | ~150–250 MB RAM, 5–30 sec of one core | 1/hour |

On a typical laptop you will not notice the agent. The Update Search at the top of the hour might cause a momentary fan spike if you're on battery + idle. On AC power: invisible.

### Failure modes + recovery

| Failure | What happens |
|---|---|
| Backend unreachable | axios retries 3× with exponential backoff (1s, 2s, 4s). Snapshot/heartbeat skipped. Next interval tries fresh. |
| API key revoked (401) | Agent logs error, backs off, keeps retrying. SUPER_ADMIN can re-enroll the device with a fresh token to recover. |
| PowerShell collector errors | Returns empty array, logs to stderr. The snapshot still goes through (with empty collector slot) so other data isn't lost. |
| Agent crash | node-windows Service Manager auto-restarts (configured with a 2-sec wait, 0.5 exponential growth, up to 40 retries). |
| Reboot | Service is set to **Automatic** start — comes back on next login session 0. |
| Disk full / temp dir unwritable | PowerShell collectors silently fail (logged); snapshot still posts with whatever it has. |

---

## 6. What's tracked (the telemetry inventory)

### Per heartbeat (~5 min)

| Field | Source | Use |
|---|---|---|
| `powerState` | `WTSQuerySessionInformation` against the active console session (PR #168) — returns the user's session connect state + idle ticks even from Session 0 | ON / IDLE / LOCKED indication |
| `uptimeSeconds` | Node `os.uptime()` | Reboot history, "how long since last boot" |
| `agentVersion` | hardcoded in agent | Track which agents need upgrading |

### Per snapshot (~60 min)

**Productivity buckets** (since the last snapshot):
- `activeSecondsBucket` — time user was actively present (powerState ON)
- `idleSecondsBucket` — time session was idle (no input for 5+ min)
- `lockedSecondsBucket` — time session was locked

**Identity:**
- `lastBootAt` — when the laptop last booted
- `loggedInUserName` — Windows account name (cross-checked against device owner for a soft-warning if mismatched)

**Security posture (Windows-first):**
- `defenderEnabled` — `Get-MpComputerStatus.RealTimeProtectionEnabled`
- `firewallEnabled` — `Get-NetFirewallProfile` (true if any profile is on)
- `bitlockerEnabled` — `Get-BitLockerVolume` for system drive
- `rebootRequired` — true if pending CBS or WU reboot registry keys exist
- `pendingRebootSince` — when the reboot was first required (drives the 7d / 30d alert tiers)
- `unsupportedOs` — true if Windows 10 build < 19041 (past vendor support)

**Inventory:**
- `installedSoftware[]` — name + version + publisher + install date (read from `HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*` and the 32-bit `WOW6432Node` variant)
- `missingPatches[]` — KB ID + title + classification + severity (from the Microsoft.Update.Session COM API)

### Per device row (denormalised current state)

These are updated on every heartbeat/snapshot for fast list queries:
- `currentRiskScore`, `currentRiskLevel` (HEALTHY/AT_RISK/CRITICAL)
- `currentPowerState`
- `lastSeenAt`, `lastHeartbeatIp` (audit only — not used for auth)
- `agentVersion`

### Activity tracking added 2026-05-29

Per the client's monitoring requirement, the agent also collects (and the
SUPER_ADMIN dashboard surfaces):

- **Foreground app** — which app currently has focus (`Win32 GetForegroundWindow`, sampled by the user-session probe — see below)
- **Window title** — the active app's title bar text (so the dashboard can detect browser-tab content: YouTube, Netflix, Twitter, GitHub, etc.)
- **App display name** — friendly name resolved from `FileVersionInfo` (e.g. "Google Chrome" instead of `chrome.exe`)
- **Per-app foreground time** — seconds in each app per hour (the agent ticks every 30 s and reads `foreground.json`; the backend aggregates into hourly buckets)
- **Process count** — `Get-Process` total as a sanity/tamper signal
- **Login session start** — when the user actually logged into Windows (`Win32_LogonSession`, distinct from boot time)
- **Category classification** — each foreground sample is classified into PRODUCTIVE / COMMUNICATION / ENTERTAINMENT / PERSONAL / UNKNOWN / TAMPER at sample time

This information is presented under SUPER_ADMIN only; the Pulse module's three-layer privilege gate covers it.

#### User-session foreground probe (PR #31 → PR #32, 2026-05-29)

The agent runs as `LocalSystem` (Session 0). The Win32
`GetForegroundWindow` / `GetWindowText` /
`GetWindowThreadProcessId` calls are **per-session** APIs — invoked
from Session 0 they return `NULL` or the service desktop's own
window, never the logged-on user's actual foreground app. Before
PR #31 this silently kept per-app foreground time at zero on every
production install.

The fix is a small probe
(`windows-agent/user-probe/main.go` → `user-probe.exe`) registered as
a Scheduled Task `ExargenPulseUserProbe` with `/RU INTERACTIVE` so
Task Scheduler runs it under the logged-on user's token. The probe
samples `GetForegroundWindow` from inside the user session and writes:

```
%ProgramData%\ExargenPulse\probe\foreground.json
```

The main agent (SYSTEM context) reads that file on its 30-second
tick. The probe runs every 60 seconds; anything older than 5 minutes
in the file is treated as stale and the agent omits per-app rows
from that snapshot.

**v1 (PR #31)** shipped this as `user-probe.ps1`. PowerShell.exe is
a CONSOLE-subsystem binary, so every 60-second tick briefly painted
`conhost.exe` before `-WindowStyle Hidden` could take effect — the
most-complained-about UX issue with the agent. **v2 (PR #32)**
replaces it with a Go-compiled `user-probe.exe` built with
`-H=windowsgui` (GUI subsystem). Windows never allocates a console
host for GUI-subsystem binaries, so the flash disappears entirely.
Same Win32 calls, same `foreground.json` contract, ~80× faster cold
start (~3 ms vs ~250 ms), and the binary is signtool-friendly.

| Concern | Resolution |
|---|---|
| Visible console flash | `user-probe.exe` is GUI-subsystem (Go `-ldflags=-H=windowsgui`). No console host ever allocated. |
| Cross-session permissions | `icacls` grants `BUILTIN\Users:(OI)(CI)M` on `…\probe\`. SYSTEM already has `FullControl` by default. |
| Locked desktop / no user logged on | Probe sees no foreground or doesn't run; agent treats the file as stale and reports nothing for that interval. |
| Probe disabled / quarantined | Stale-file fallback prevents over-reporting; foreground category just stays empty until the task fires again. |
| Atomic writes | Probe writes to `foreground.json.tmp` then `os.Rename` (MoveFileEx with REPLACE_EXISTING) — the agent never reads a half-written document. |
| Code signing | Probe is signed by `build-installer.ps1 -SignWithThumbprint <…>` alongside `PulseAgent.exe` and the installer. |
| Uninstall | Inno Setup's `usUninstall` step issues `schtasks /Delete /TN ExargenPulseUserProbe /F`. |

**Build:**

```powershell
cd windows-agent\user-probe
$env:GOOS = "windows"; $env:GOARCH = "amd64"
go build -trimpath -buildvcs=false -ldflags="-s -w -H=windowsgui" -o ..\build\user-probe.exe .
```

Requires Go 1.22+. The full `build-installer.ps1` pipeline does this
automatically.

### What's NOT in the wire payload

- No raw username/password fields (the Windows username is one short string used for owner cross-check)
- No IP for any other host on your network — only the agent's own outbound IP
- No filesystem listing beyond installed apps + active app foreground time
- No keystrokes / mouse coordinates / clipboard
- No screenshots / camera / microphone

---

## 7. What's NOT tracked (privacy posture)

> **Update 2026-05-29:** Window-title and active-app collection moved IN-scope per the client's monitoring requirement. The list below reflects the current boundary.

The agent explicitly does NOT collect:

| Category | Examples |
|---|---|
| **Input contents** | Keystrokes, mouse coordinates, clipboard contents |
| **Browser data** | History, bookmarks, saved passwords, downloads (the dashboard sees window titles, not URLs) |
| **Communications** | Email contents, chat messages, file attachments |
| **Visual / audio** | Screenshots, camera frames, microphone audio, screen recording |
| **Files** | File names beyond installed-software registry entries; no documents folder scan; no OneDrive / Dropbox listing |
| **Network** | DNS queries, browsing destinations, other LAN device discovery |

Each of these is an intentional gap. Expanding any one of them goes through:

1. A design-review PR adding a `docs/pulse/` entry explaining the use case, the data path, and the access control.
2. SUPER_ADMIN approval before code lands.
3. A versioned agent migration so employees can see what changed when upgrading.

This is the **boil-the-lake** approach inverted: we deliberately collect less than we could, document why, and only widen it on demand.

---

## 8. The risk scoring rubric

Pure function in [`backend/src/services/deviceRisk.service.ts`](../../backend/src/services/deviceRisk.service.ts). Score = `max(0, 100 - Σ penalties)`.

### Bands

| Score range | Level | Meaning |
|---|---|---|
| ≥ 80 | **HEALTHY** | Nothing actionable; routine ops |
| 50 – 79 | **AT_RISK** | One or two issues; should be addressed within a week |
| < 50 | **CRITICAL** | Multiple issues OR a single critical one; immediate attention |

### Penalties

| Trigger | Weight | Notes |
|---|---|---|
| Agent offline > 24 h (`lastSeenAt` stale or null) | −30 | Heaviest because we can't trust anything else about a device that isn't reporting |
| Antivirus disabled (`defenderEnabled === false`) | −20 | |
| Firewall disabled (`firewallEnabled === false`) | −15 | |
| BitLocker disabled (`bitlockerEnabled === false`) | −15 | |
| Unsupported OS (`unsupportedOs === true`) | −20 | Vendor no longer patches it |
| Reboot required, pending 7-30 d | −10 | Warning tier |
| Reboot required, pending > 30 d | −20 | Overdue tier (replaces the −10, not additive) |
| Per critical-severity missing patch | −5 each, capped at −30 | |
| Per risky software install | −10 each, capped at −30 | Currently detects BitTorrent clients, remote-access tools (TeamViewer, AnyDesk, VNC), known keyloggers, crypto miners |

### Score-band examples

| Posture | Score | Level |
|---|---|---|
| Clean laptop, fully patched, all security on, reporting normally | **100** | HEALTHY |
| Same but antivirus disabled | **80** | HEALTHY (boundary) |
| Same plus 1 critical patch missing | **75** | AT_RISK |
| Antivirus + firewall + BitLocker all disabled | **50** | AT_RISK (boundary) |
| AV/FW/BL disabled + 1 critical patch | **45** | CRITICAL |
| Everything wrong (offline, AV off, FW off, BL off, unsupported OS, 30-day reboot, 6+ critical patches, 3+ risky apps) | **0** | CRITICAL (floor) |

### Versioning

`SCORING_VERSION = 1`. Each `DeviceHealthSnapshot` stores its score frozen at capture time — so a future rubric change doesn't retroactively rescore historical snapshots. When the rubric changes, bump the version and document the change in this guide.

---

## 9. The Pulse dashboard — UI tour

### Access

- Route: `/pulse`
- Sidebar entry: visible only when `user.role === 'SUPER_ADMIN'`
- Direct URL access by other roles: redirected by `<ProtectedRoute>`; the backend also double-gates with `requireRoles('SUPER_ADMIN')` and a service-layer `assertSuperAdmin` defence-in-depth check

### Tabs (left to right)

1. **Overview** — fleet summary
2. **Employees** — per-employee activity (presence, current app, screen time, categories)
3. **Devices** — list + drill-down
4. **Alerts** — open risk findings, resolvable inline
5. **Clock log** — team-wide clock in/out for a chosen date
6. **Enrollment tokens** — issue, list, revoke

### 9.1 Overview tab

Three sections of cards plus a productivity bar:

**Risk-level summary (top row):**
- Total devices
- Healthy (green)
- At-risk (amber)
- Critical (red)

**Productivity today (full-width card):**
- Big number: total team active hours so far today (UTC)
- Stacked bar: active (green) / idle (amber) / locked (gray) ratio
- Legend with exact times for each segment
- Caption: "Total active across N reporting devices today"

**Security posture (grid):**
- Agents offline 24h
- Missing patches (total)
- Reboot required
- Antivirus disabled / Firewall disabled / BitLocker disabled
- Unsupported OS
- Devices with risky apps

**Open alerts:**
- Critical / Warning / Info counts

Auto-refreshes every 60 seconds.

### 9.2 Employees tab

The primary "what is each employee doing right now" view. One row per active employee:

| Column | Shows |
|---|---|
| Employee | Name + email |
| Status | Presence badge: 🟢 ONLINE (animated dot), 🟡 AWAY, ⚫ LOCKED, ⚪ OFFLINE |
| Current app | App name + window title (truncated) — what's in focus right now |
| Active today | Today's screen time (active seconds across all their devices), in "Xh YYm" |
| Category split | Stacked bar — emerald (productive) / sky (communication) / rose (entertainment) / violet (personal) / gray (unknown) / orange (tamper). Per-segment time on hover. |
| Devices | Count of ACTIVE devices owned by this employee |
| Alerts | Count of open risk alerts across their devices |

Auto-refreshes every 30 seconds. **Click any row → employee detail drawer:**

- **Today** — three big numbers (total active / productive / entertainment), category split bar, login time, "Now on: <app> — <window title>", tamper-tool warning banner if applicable
- **Last 7 days** — stacked-bar chart per day, colored by category, hover for exact times
- **Apps today** — sortable / scrollable table of every app the employee touched today: display name, category badge, latest window title, total foreground time
- **Devices** — every device the employee owns with risk badge + last-seen

### 9.3 Devices tab

Filterable table:

- Filters: search hostname/owner/email, risk level, status
- Columns: Hostname | Owner | Platform | Status | Risk | **Active today** | Last seen | Issues | Revoke

The **Active today** column shows the device's today active hours + a mini stacked bar (active / idle / locked) — the fastest "who's working" read on the dashboard.

Click any row → **device-detail drawer slides in from the right** with these sections:

1. **Identity** — platform, OS version + build, arch, status, API key prefix, last seen, agent version
2. **Latest snapshot** — frozen risk score + power state + uptime + last boot + color-coded antivirus / firewall / BitLocker / reboot-pending / unsupported-OS (green = good, red = bad)
3. **Productivity**:
   - **Today's split** — big "active today" number + idle/locked + one-line stacked bar
   - **7-day stacked-bar chart** — one column per day for the last week. Each column stacks active (green) / idle (amber) / locked (gray) / no-data (light gray) heights proportional to a 24-hour day. Hover a column to see exact times.
4. **Open alerts** — type, severity icon (red/amber/gray), message, opened-at timestamp
5. **Missing patches** — KB ID, title, classification, severity badge, first-seen date
6. **Installed software** — sortable, sticky-header scrollable table, with a "Show risky only" toggle if any risky apps are detected. Each row shows name, version, publisher, and a "Risky" badge with a tooltip explaining why.

Close the drawer with the **X** in the top-right or by clicking the dark overlay.

The **Revoke** button on the row stops propagation — it opens the revoke dialog without opening the drawer.

### 9.4 Alerts tab

Across all devices:

- Severity filter: all / Critical / Warning / Info
- List of open (and optionally resolved) alerts
- Each row: severity icon, type, "on [hostname] · [owner]", message, opened-at, **Resolve** button
- Auto-refreshes every 60 sec

Clicking **Resolve** marks the alert resolved with note "Resolved by admin" and sets `resolvedByUserId` to the current SUPER_ADMIN.

### 9.5 Clock log tab

Team-wide clock in/out view for a selected date (default today):

- Date picker at the top
- Table: Employee | Status (Clocked in / Clocked out badge) | Sessions | Total today | Currently in since

"Currently in since" shows the start time of the open session (or "—" if clocked out).

If an employee forgot to clock out, their row will show with `autoClosedAt` flagged once the sweep runs (currently invoked manually; future cron is on the deferred list).

### 9.6 Enrollment tokens tab

- **Issue token** button (top right)
- List of tokens with: note, last 4 chars of token (`····abcd`), issuer, assigned user (if any), expiration, consumed state
- **Revoke** button on unconsumed tokens — sets `expiresAt = now`

When you click Issue:

1. Modal asks for an optional note
2. Click Issue
3. Second modal shows the cleartext token with a "Copy to clipboard" button
4. Closing the modal hides the cleartext — you cannot retrieve it again

---

## 10. Operations & troubleshooting

### Common admin tasks

**"How do I see who's working right now?"**
→ Overview tab → "Productivity today" card has the team total. Devices tab → "Active today" column has the per-employee breakdown.

**"How do I see what apps an employee has installed?"**
→ Devices tab → click their device row → Installed software section in the drawer.

**"How do I find devices with antivirus disabled?"**
→ Overview tab → "Antivirus disabled" card. Then Devices tab and look for red badges in the detail drawer's snapshot section.

**"How do I respond to a risk alert?"**
→ Alerts tab. Work with the employee to fix the underlying condition (e.g. patch their device, re-enable AV). The next snapshot will auto-resolve the alert. You can also manually resolve with a note.

**"How do I retire an old device?"**
→ Devices tab → find device → click **Revoke** → enter reason. Row stays for audit.

### Troubleshooting

**The employee installed but the device isn't showing up.**
1. On the employee's Windows machine, run: `Get-Service ExargenPulseAgent`. Status should be **Running**.
2. If Running but no device on dashboard: check the service logs at `C:\Program Files\ExargenPulse\daemon\*.err.log`. Common causes: backend unreachable (firewall / VPN), token expired, BOM in config.json.
3. Try running it in the foreground for live output:
   ```powershell
   Stop-Service ExargenPulseAgent
   cd $env:USERPROFILE\pulse-agent\windows-agent
   node dist\index.js
   ```

**The dashboard shows `HEARTBEAT_GAP_DETECTED` for an employee.**
The backend sees no heartbeat for >30 min from an ACTIVE device during work hours (UTC 06:00–22:00). Possible causes ranked by likelihood:
1. **Laptop is genuinely off.** Quiet hours exclude 10pm–6am UTC; outside that, a closed laptop or 30+ min sleep state triggers this.
2. **Network outage.** Auto-resolves on next heartbeat.
3. **Service stopped.** Have the employee check `Get-Service ExargenPulseAgent`. If `Stopped`, the watchdog scheduled task should be bringing it back within 5 min — if it isn't, watchdog itself was disabled.
4. **Config tampered.** Check that `C:\ProgramData\ExargenPulse\config.json` still has a valid `serverUrl` and `apiKey`.
5. **API key revoked.** SUPER_ADMIN: check the `devices` row for that hostname — if `status == REVOKED`, that's expected; if `status == ACTIVE` and the agent log says 401, the apiKeyHash got corrupted.

**The watchdog scheduled task is missing.**
The hardening step of the installer didn't run (pre-PR23 install, or schtasks denied SYSTEM principal on a locked-down domain).

Reapply with:
```powershell
iex (iwr "https://raw.githubusercontent.com/Exargen-AI/exargen-command-center/main/windows-agent/harden-pulse.ps1" -UseBasicParsing).Content
```

**`HTTP 403 "Origin header required for this request"` in the agent log.**
The backend's CSRF middleware isn't exempting `/api/v1/devices/`. Either the backend is stale or someone reverted the requireOrigin fix. Check the `PUBLIC_PATH_PREFIXES` list in `backend/src/middleware/requireOrigin.ts`.

**`HTTP 400 "Validation failed"` with `"Expected string, received null"`.**
The snapshot validator hit an unaccepted null. Check that the Pulse validators use `.nullish()` not `.optional()` and that `isoDateOptional` uses the permissive `Date.parse`-based check.

**`HTTP 401 "Invalid device credential"`.**
The device was likely revoked by a SUPER_ADMIN, or its API key got corrupted. Resolve by issuing a fresh enrollment token and having the employee re-enroll (deletes the config and runs the install steps again).

**Agent process keeps crashing.**
Check `daemon\*.err.log`. If it's a config issue (missing serverUrl, malformed token), fix the config and the service will auto-restart on the next retry. If it's a node-windows wrapper issue, run `node dist\install-service.js --uninstall` and then re-install.

**`softwareCount: 0` or `patchCount: 0` when you expect non-zero.**
Pre-deploy this was a real bug (PowerShell scripts mangled via `-Command` quoting). The fix landed in PR #157. If you see it again, check `daemon\*.err.log` for `[pulse-agent] PowerShell failed: …` lines — those are added specifically to surface this case.

### Where the logs live

| What | Where |
|---|---|
| Windows agent (Service) | `C:\Program Files\ExargenPulse\daemon\*.out.log` (stdout), `daemon\*.err.log` (stderr) |
| Windows agent (foreground) | The PowerShell window stdout |
| Backend (dev) | The terminal running `npm run dev --workspace=backend` |
| Backend (production) | Wherever your deploy platform routes stdout (Railway, Vercel, etc.) |
| Activity audit log | `activities` table — every enrollment, revocation, telemetry-related event |

---

## 11. Security model

### Three-layer privilege gate

| Layer | Where | What it does |
|---|---|---|
| **Frontend route guard** | `<ProtectedRoute roles={['SUPER_ADMIN']} />` in `App.tsx` | Redirects non-SUPER_ADMIN to login; sidebar entry hidden |
| **Route middleware** | `authenticate` + `requireRoles('SUPER_ADMIN')` on every `/admin/pulse/*` route | Returns 403 on the wrong role |
| **Service-layer assertion** | `assertSuperAdmin(callerRole)` at the top of every Pulse read service | Throws `ForbiddenError` BEFORE any DB call; defends against an accidentally-unprotected new route |

Bypassing all three would require both a bug in the frontend AND a bug in the route middleware AND a bug in the service.

### Agent-side auth (separate dimension)

The Windows agent uses `Authorization: Device <api-key>` not a Bearer JWT. The `deviceAuthenticate` middleware:

1. Reads the header
2. `sha256()` the cleartext
3. `prisma.device.findUnique({ where: { apiKeyHash } })`
4. Refuses if no match
5. Refuses if `device.status !== 'ACTIVE'`
6. Sets `req.device` (distinct from `req.user`)

Cleartext never reaches the DB or query logs. The hash is the only thing stored.

### Audit trail

Every consequential action writes an `activities` row:

| Action | Audited when |
|---|---|
| `pulse_enrollment_token_issued` | SUPER_ADMIN issues a token |
| `pulse_enrollment_token_revoked` | SUPER_ADMIN revokes an unconsumed token |
| `pulse_device_enrolled` | An agent successfully enrolls (logged against the token issuer) |
| `pulse_device_revoked` | SUPER_ADMIN revokes an active device |
| `pulse_device_reassigned` | SUPER_ADMIN changes a device's owner |
| `clock_in` / `clock_out` | Any user clocks in/out |
| `clock_session_auto_closed` | The 12-hour stale-session sweep auto-closes (logged per affected user) |

You can review by querying the `activities` table directly or by extending the activity feed (existing infrastructure).

### Data retention

- `device_health_snapshots` — kept indefinitely currently (no cleanup sweep yet)
- `device_installed_software` / `device_missing_patches` — upsert + prune, so always reflect the current state
- `device_risk_alerts` — open + resolved kept forever
- `clock_sessions` — kept forever
- `device_enrollment_tokens` — kept after consumption for audit

A retention sweep is a deferred follow-up; for v1 the volumes are small enough that "keep everything" is fine.

### Anti-tamper hardening (2026-05-29)

Three layers make it hard for a non-admin user to silence the agent:

1. **Windows Service Recovery.** On agent crash or manual stop, the Service Control Manager auto-restarts it. Configured during install via `sc.exe failure ExargenPulseAgent reset= 86400 actions= restart/5000/restart/5000/restart/5000` — three retries with 5-sec delays, counter reset daily.
2. **Scheduled-task watchdog.** A task named `ExargenPulseWatchdog` runs every 5 minutes as `SYSTEM`. If the service isn't Running, it starts it. Defeats "kill the service via Task Manager" because the watchdog brings it back within 5 minutes.
3. **Heartbeat-gap detection (server-side).** If a device that should be online goes quiet for >30 minutes during work hours (UTC 06:00–22:00), a `HEARTBEAT_GAP_DETECTED` alert opens automatically with the message "Agent has been silent for N min — service may have been stopped or config tampered with". The alert auto-resolves when the agent reports again.

A user with local admin privileges can defeat all of this. That's acceptable — admin-protected hardware is the deployment assumption.

To apply hardening to a pre-existing install (pre-PR23), the operator can run:

```powershell
iex (iwr "https://raw.githubusercontent.com/Exargen-AI/exargen-command-center/main/windows-agent/harden-pulse.ps1" -UseBasicParsing).Content
```

To intentionally remove the hardening (e.g. during decommissioning):

```powershell
schtasks.exe /Delete /TN ExargenPulseWatchdog /F
sc.exe failure "ExargenPulseAgent" reset= 0 actions= ""
```

### Productivity score rubric (2026-05-29)

Every employee row carries a 0–100 score + band (HIGH ≥ 70 / MEDIUM 40–69 / LOW < 40). Pure function of today's category-weighted time, mirroring the device-risk-score pattern so it's deterministic and auditable.

**Formula:**

```
base   = (productive + 0.7 × communication) / activeSeconds × 100
score  = base
       − max(0, (entertainment − 1h) × 10/h)     // capped at −40
       − max(0, (personal      − 2h) × 10/h)     // capped at −20
       − 50 if any tamper time
score  = clamp(score, 0, 100)
```

The breakdown is surfaced inline on the employee detail drawer so a SUPER_ADMIN can read exactly why someone is a 42 vs 82.

`SCORING_VERSION = 1`. When the rubric changes, bump the version + update this guide so historical interpretations remain clear.

### Activity classification rubric (2026-05-29)

Each captured app is classified into one of six categories by the agent at sample time. The classifier ([`windows-agent/src/classifier.ts`](../../windows-agent/src/classifier.ts)) is conservative — unmapped apps fall to UNKNOWN rather than PRODUCTIVE so the dashboard never overstates real work.

| Category | Examples | Source |
|---|---|---|
| **PRODUCTIVE** | VS Code, Cursor, JetBrains IDEs, Office, Terminal, Postman, Figma, Notion, GitHub Desktop, Docker, github.com tab, jira/confluence/docs.google tabs | app-name + browser-title patterns |
| **COMMUNICATION** | Slack, Teams, Zoom, Outlook, Discord, Telegram, Signal, WhatsApp, meet.google in browser | app-name + browser-title patterns |
| **ENTERTAINMENT** | Netflix, Spotify, VLC, Steam, Epic, Battle.net, OBS, well-known games, youtube/netflix/twitch/tiktok browser tabs | app-name + browser-title patterns |
| **PERSONAL** | facebook/instagram/twitter/reddit/pinterest tabs, personal-email tabs (gmail.com, outlook.live) | browser-title patterns |
| **UNKNOWN** | Browser tabs that don't match any pattern; unmapped desktop apps | default |
| **TAMPER** | Caffeine.exe, mousejiggler.exe, moveit.exe, keepalive.exe, awakemate.exe, AutoHotkey.exe | app-name patterns |

When any TAMPER-category app accumulates foreground time, a `TAMPER_TOOL_DETECTED` alert fires at WARNING severity. When ENTERTAINMENT exceeds 30 minutes in any one-hour bucket, an `EXCESSIVE_DISTRACTION` alert fires at INFO. Both auto-resolve on the next snapshot that no longer trips them.

---

## 12. Limitations & future work

### What's deferred (in priority order)

1. **Risky-software block list editor** — a SUPER_ADMIN UI to edit the pattern list (currently hardcoded to ~8 patterns: BitTorrent, TeamViewer, AnyDesk, VNC, keyloggers, crypto miners). When the list changes, retroactively re-classify existing inventory.
2. **Signed `.exe` / `.msi` installer** — so deployment doesn't require git + node + admin PowerShell. Plan: `pkg` (or Node SEA) on a Windows host produces `PulseAgent.exe`; Inno Setup wraps it plus enrollment-token prompt + service install into a signed `.msi`. Employee experience becomes "download, double-click, paste token, done". Interim solution today is `install-pulse.ps1` (the one-line installer), which removes the multi-step manual flow.
3. **Productivity timeline graph** — beyond the 7-day stacked bar, a fuller "active hours" trend per employee over months.
4. **macOS / Linux collectors** — currently the agent no-ops on non-Windows (PowerShell isn't there). For macOS we'd use `system_profiler` and `defaults`; for Linux, `/proc` + `apt list` / `rpm -qa`.
5. **Scheduled cron for `autoCloseStaleSessions`** — currently the 12-hour stale-session sweep is invoked on demand; make it daily.
6. **Outbound webhooks** for `device.critical` / `agent.offline` / `risky_software_detected` — so SUPER_ADMIN can wire alerts to Slack / Discord / pager.
7. **Per-device baseline + anomaly detection** — "this device usually has 7 hours active by 4pm; today it has 1" → soft warning.
8. **Data retention sweep** — snapshots older than N days get archived or deleted.

### Known limitations (v1)

- **Agent never runs without Windows.** macOS / Linux collectors are stubs.
- **No remote action.** Pulse can only observe — there's no "force-apply Windows patches" or "remotely wipe" button. That's intentional (boundary between observation and MDM).
- **Productivity is observed, not enforced.** "Active" means power state ON for that bucket; it doesn't measure actual work output. Treat it as a signal of laptop usage, not employee output.
- **Single backend URL.** The agent has one server URL in its config. If your backend moves domains, every agent needs its config updated (no DNS round-robin or failover).
- **Free-tier ngrok in dev** has a browser warning interstitial for `*.ngrok-free.dev` URLs. The agent ignores it because it uses a non-browser user agent.
- **Foreground app only when a user is signed in.** The user-session probe added in PR #31 (see §6) requires an interactive logon to sample anything — between Windows boot and the first user login, or between sign-out and the next sign-in, foreground tracking is silent. Online / idle still works in that window because `getPowerState` uses `WTSQuerySessionInformation` from Session 0. This is the correct behaviour: with no user on the box there is nothing to attribute.

---

## Appendix A — File map

```
backend/
  prisma/schema.prisma                       — 7 Pulse tables + 6 enums
  prisma/migrations/20260528000000_pulse_module/
                                             — initial migration SQL
  src/
    middleware/
      deviceAuthenticate.ts                  — sha-256 device auth
      requireOrigin.ts                       — CSRF (with /devices/ exemption)
    services/
      device.service.ts                      — enrollment, revoke, reassign
      deviceAuthenticate.test.ts             — 12 tests
      deviceRisk.service.ts                  — pure risk scorer
      deviceRisk.service.test.ts             — 21 tests
      deviceTelemetry.service.ts             — heartbeat + snapshot ingest
      devicePulse.service.ts                 — admin reads + productivity
      devicePulse.service.test.ts            — 13 tests
      clockSession.service.ts                — clock in/out
      clockSession.service.test.ts           — 9 tests
    handlers/
      pulse.handler.ts                       — device + admin endpoints
      clock.handler.ts                       — clock endpoints
    routes/
      pulse.routes.ts                        — all Pulse routes
    validators/
      pulse.schema.ts                        — zod validators
    openapi/
      pulse.paths.ts                         — OpenAPI documentation

frontend/
  src/
    pages/
      TodayPage.tsx                          — clock + standup cards above the feed
      admin/PulsePage.tsx                    — the /pulse dashboard
    components/today/
      ClockCard.tsx                          — clock in/out widget
      StandupCard.tsx                        — daily standup form
    api/
      pulse.ts                               — Pulse API client
      clock.ts                               — clock + productivity API client

shared/
  src/
    enums.ts                                 — DevicePlatform, DeviceRiskLevel, etc.
    types/pulse.ts                           — wire DTOs (shared FE/BE/agent)

windows-agent/
  package.json                               — bin: pulse-agent
  tsconfig.json
  README.md                                  — build / install instructions
  src/
    index.ts                                 — entry: enroll + loop
    config.ts                                — config.json reader (BOM-tolerant)
    fingerprint.ts                           — hardware fingerprint
    api.ts                                   — axios wrapper (retry, Idempotency-Key)
    collectors.ts                            — PowerShell telemetry collectors
    install-service.ts                       — node-windows Service wrapper
    types.d.ts                               — ambient types (process.pkg, node-windows)

docs/pulse/
  01-architecture.md                         — high-level design rationale
  02-installation-and-operator-guide.md      — this file
```

## Appendix B — Quick command reference

### SUPER_ADMIN (Mac/Linux)

```bash
# Apply migrations after pulling Pulse changes
cd backend && npx prisma migrate deploy

# Watch backend logs
npm run dev --workspace=backend

# Run Pulse-specific tests
cd backend && npx vitest run src/services/device*.test.ts
```

### Employee (Windows, admin PowerShell)

**One-line install:**

```powershell
iex (iwr "https://raw.githubusercontent.com/Exargen-AI/exargen-command-center/main/windows-agent/install-pulse.ps1" -UseBasicParsing).Content
```

(prompts for ServerUrl + EnrollmentToken)

**Unattended install (SUPER_ADMIN scripting):**

```powershell
.\install-pulse.ps1 -ServerUrl "https://command.exargen.in/api/v1" -EnrollmentToken "det_…"
```

**Uninstall:**

```powershell
cd "C:\Program Files\ExargenPulse\src\windows-agent"
node dist\install-service.js --uninstall
Remove-Item -Recurse -Force "C:\ProgramData\ExargenPulse"
Remove-Item -Recurse -Force "C:\Program Files\ExargenPulse"
```

### Inspect a deployment

```bash
# What devices does the SUPER_ADMIN's account see?
curl -H "Authorization: Bearer $JWT" \
     https://your-backend/api/v1/admin/pulse/overview

# Get one device's detail
curl -H "Authorization: Bearer $JWT" \
     https://your-backend/api/v1/admin/pulse/devices/<device-id>

# Get one device's 7-day productivity
curl -H "Authorization: Bearer $JWT" \
     "https://your-backend/api/v1/admin/pulse/devices/<device-id>/productivity?days=7"
```

---

**This guide updates with every Pulse release.** When the rubric changes, sections [§5](#5-how-the-windows-agent-works) and [§8](#8-the-risk-scoring-rubric) get updated. When new telemetry lands, sections [§6](#6-whats-tracked-the-telemetry-inventory) and [§7](#7-whats-not-tracked-privacy-posture) get updated. The architecture doc ([01-architecture.md](./01-architecture.md)) is the place for *why*; this guide is the place for *how*.
