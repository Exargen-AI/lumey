# Pulse Agent (Windows)

Headless TypeScript/Node.js agent that ships device-health + productivity telemetry to the Exargen Command Center backend. Packaged as a single `PulseAgent.exe`, installed as a LocalSystem Windows Service.

## Architecture

```
┌──────────────────────────────────────┐
│ Employee laptop (Windows 10/11)      │
│                                       │
│  PulseAgent.exe ──► Windows Service  │
│      │                                │
│      ├── heartbeat (~5 min)          │
│      └── snapshot  (~60 min)         │
│              │                        │
│              ▼                        │
│        HTTPS + per-device API key    │
└──────────────┬───────────────────────┘
               │
               ▼
       Command Center backend
       (SUPER_ADMIN dashboard at /pulse)
```

The agent **never writes the DB directly.** Everything goes through the authenticated REST endpoints documented at `/api/v1/docs`:

| Endpoint | When |
|---|---|
| `POST /devices/enroll` | First boot (single-use bootstrap token) |
| `POST /devices/me/heartbeat` | Every 5 min |
| `POST /devices/me/snapshot` | Every 60 min |

## What it collects

**Productivity / presence**
- Power state (`ON`, `IDLE`, `LOCKED`, `OFF`) — derived from `GetForegroundWindow` + `GetLastInputInfo`
- System uptime + last boot time
- Logged-in user name (cross-checked against the registered device owner)

**Security posture (Windows-only)**
- Windows Defender real-time protection on/off
- Firewall enabled (any profile)
- BitLocker enabled on the system drive
- Reboot-required flag (CBS + Windows Update registry keys)
- Unsupported OS detection (build < 19041)

**Inventory (full snapshot only)**
- Installed software (HKLM Uninstall registry, both 32-bit and 64-bit)
- Missing Windows Update KBs (via the Microsoft.Update.Session COM API)

The backend's risk scorer turns these into a 0–100 score + a HEALTHY/AT_RISK/CRITICAL band. See `docs/pulse/01-architecture.md`.

## Install (employee laptop)

### Option A — one-line installer (recommended)

The simplest path. Employee opens **PowerShell as Administrator**, pastes one command, answers two prompts. Total time ~3 minutes.

```powershell
iex (iwr "https://raw.githubusercontent.com/Exargen-AI/exargen-command-center/main/windows-agent/install-pulse.ps1" -UseBasicParsing).Content
```

The script prompts for:
1. **Server URL** — e.g. `https://command.exargen.in/api/v1`
2. **Enrollment token** — the `det_<hex>` value the SUPER_ADMIN sent

It then handles end-to-end:

1. Verifies admin elevation
2. Verifies Node.js 20 + Git are installed (fails fast with download links if not)
3. Clones the repo into `C:\Program Files\ExargenPulse\src\`
4. `npm install` + build (the slow part, ~3 min on first run)
5. Writes `C:\ProgramData\ExargenPulse\config.json` (BOM-free, ACL locked to SYSTEM + Administrators)
6. Smoke-tests enrollment (waits up to 20 sec for the API key to be persisted)
7. Registers `ExargenPulseAgent` as a Windows Service (auto-starts on boot)
8. Confirms the service is Running

Re-running the same command upgrades in place (git pull → rebuild → service restart).

**For SUPER_ADMINs scripting fleet installs** — pass values directly to skip the prompts:

```powershell
.\install-pulse.ps1 -ServerUrl "https://command.exargen.in/api/v1" -EnrollmentToken "det_…"
```

### Option B — manual install

If the one-line installer is blocked (corporate proxy, strict script policy), the step-by-step manual flow still works. See [docs/pulse/02-installation-and-operator-guide.md §4](../docs/pulse/02-installation-and-operator-guide.md#4-employee-installing-the-agent-on-a-windows-laptop).

### Option C — signed .exe / .msi (planned)

Not built yet. Plan: `npm run package` (uses `pkg`) on a Windows host produces `PulseAgent.exe`; Inno Setup wraps that plus enrollment prompt + service install into a signed `.msi`. Employee experience becomes "double-click → paste token → done". Tracked as a follow-up.

## Uninstall

```powershell
# In admin PowerShell:
cd "C:\Program Files\ExargenPulse\src\windows-agent"
node dist\install-service.js --uninstall
Remove-Item -Recurse -Force "C:\ProgramData\ExargenPulse"
Remove-Item -Recurse -Force "C:\Program Files\ExargenPulse"
```

The SUPER_ADMIN can also revoke the device via the dashboard — the next call from a revoked device returns 401 and the agent will log and back off.

## Build

```bash
# From this folder (windows-agent/)
npm install
npm run build         # compile TypeScript → dist/
npm run package       # produce build/PulseAgent.exe via pkg
```

The `pkg` step requires a network connection on first run (fetches the Node 20 Windows base image) but is offline-cached after that. CI matrix runs the package step on a Windows host.

## Dev (Mac / Linux / Windows)

```bash
# Set up a local config that points at your dev backend:
echo '{ "serverUrl": "http://localhost:3002/api/v1", "enrollmentToken": "det_…" }' > pulse-config.json

PULSE_CONFIG_PATH=$PWD/pulse-config.json npm run dev
```

Most collectors no-op on macOS / Linux (PowerShell isn't there); you'll get a working enrollment + heartbeat loop but empty security-posture fields. Useful for poking the wire format end-to-end.

## File layout

```
windows-agent/
├── package.json           # bin: pulse-agent → dist/index.js
├── tsconfig.json
├── README.md              # this file
└── src/
    ├── index.ts           # entry — enroll + loop
    ├── config.ts          # config.json reader / writer
    ├── fingerprint.ts     # stable hardware fingerprint
    ├── api.ts             # axios wrapper + retry + Idempotency-Key
    ├── collectors.ts      # PowerShell-backed telemetry collectors
    └── install-service.ts # node-windows wrapper (install/uninstall)
```

## Security notes

- **No DB access.** The agent only knows the backend's REST URL and its own API key. It can't be used as a pivot into the DB even if compromised.
- **API key storage.** `config.json` is written with `mode: 0o600` plus a Windows ACL set by the installer. Only Administrators + SYSTEM can read it. The key is sent only over HTTPS in the `Authorization: Device <key>` header — never logged.
- **PowerShell.** All shell-outs use `-NoProfile -NonInteractive` and a 30s timeout. No user input is ever interpolated into a command.
- **No registry writes.** The agent reads but never writes the Windows registry.
- **No outbound to anywhere else.** Single backend URL is the only destination.
- **Revocation.** SUPER_ADMIN can revoke a device's API key at any time via the dashboard; next call returns 401 and the agent logs + backs off.

## What it does NOT collect (yet)

- Keyboard / mouse input contents
- Window titles or process command lines (only the logged-in username + lock state)
- Browser history
- Email / messaging contents
- Screenshots
- Camera or microphone

These are intentional gaps. Future expansion goes through a `docs/pulse/` design review and the privacy posture is documented before implementation.
