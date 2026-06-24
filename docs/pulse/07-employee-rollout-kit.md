# Pulse Agent — Employee Rollout Kit

**For the SUPER_ADMIN / IT lead rolling Pulse out across the
team.** This is the distribution package: the email you'll send,
the one-page printable summary, and the admin checklist for the
deployment day. All three pieces are designed to be cut-and-pasted
verbatim — minor edits for company-specific details (signing key
URL, support contact) only.

The deep technical reference lives in
[`06-employee-onboarding-guide.md`](./06-employee-onboarding-guide.md);
employees who want the full picture follow that link from any of
the three pieces below.

---

## 1) Email template — send 48 hours before install day

> **Subject:** Heads-up: installing Pulse Agent on your work laptop
> on **[DATE]**

Hi team,

We're rolling out **Pulse Agent** across every work laptop on
**[DATE]**. This is the productivity-monitoring component we
described at the last all-hands. Sending this 48 hours in advance
so nothing about the install day is a surprise.

**Why we're doing this.** We want a fairer, evidence-based picture
of how work is actually getting done across the team — instead of
the current "whoever's the loudest gets the credit" failure mode.
Pulse looks at seven signals (standups, task execution, GitHub
activity, comments, presence, deep-work blocks, and device
hygiene) and produces a single composite score per person, per
cadence. The score is visible **only to me** (the SUPER_ADMIN),
not to your manager, not to your peers, not to you. By design.

**What's being monitored (and what isn't).** The honest list is
in the full guide linked at the bottom. The short version:

- **Yes:** time active vs. idle, which app has focus, window
  titles, installed-software inventory, device security posture,
  battery / disk / network state.
- **No:** keystrokes, screen contents, file contents, browser
  history, webcam, microphone, location, personal email
  contents, other people's activity.

If anything in that list feels off, **reply to this email** before
install day and we'll talk it through. Better to surface concerns
now than after the fact.

**What to do.** On **[DATE]**:

1. You'll receive a second email with a **download link** to
   `PulseAgentInstaller-x.y.z.exe` and a **single-use
   enrollment token** that looks like `det_…`.
2. Double-click the installer. Approve the UAC prompt. Paste your
   token when the wizard asks. Click Next → Install → Finish.
3. **Done.** The agent runs as a Windows Service. There is no tray
   icon, no notification, no dashboard you log into. You keep
   working the way you already do.

Install takes about 30 seconds. The whole thing should be invisible
within 5 minutes.

**Where to read more.** The full employee guide — what's
collected, what isn't, how the score is calculated, FAQ, how to
uninstall — is at:
`docs/pulse/06-employee-onboarding-guide.md` in the repo, or ask
me for a PDF copy.

**Where to flag concerns.** Reply directly. Privacy questions are
welcome; "why is X on the monitored list" is welcome; "I want to
opt out" is also welcome (we'll talk).

Thanks,
[Founder name]

---

## 2) Install-day email — send the morning of [DATE]

> **Subject:** Pulse Agent install — your token + 3-minute steps

Hi [first name],

It's install day. As promised — here is your **single-use
enrollment token** (don't share it):

```
det_<paste-the-token-here>
```

**3-minute install:**

1. **Download:** [PulseAgentInstaller-x.y.z.exe link]
2. **Double-click** the installer. Approve UAC ("Yes" to "do you
   want to allow this app to make changes…").
3. **Paste the token** above into the wizard's "Enrollment token"
   field. Leave the server URL alone (it's pre-filled to our
   production Command Center).
4. **Next → Install → Finish.**

Total time including download: ~3 minutes on a normal connection.

**If something goes wrong:**

- *SmartScreen warns about an "unrecognized app":* Click **More
  info** → **Run anyway**. The installer is signed but new
  releases haven't yet built reputation with Microsoft. Safe to
  proceed.
- *UAC says you don't have admin rights:* Ping me — I'll walk you
  through a 30-second elevated install.
- *Installer says "enrollment failed":* The token is single-use;
  if it was already consumed (maybe you clicked twice), reply and
  I'll issue you a fresh one.
- *Anything else:* Reply with a screenshot. I'll respond same-day.

**Verifying it's running** (optional — only if you're curious):
Press `Win + R`, type `services.msc`, find **Exargen Pulse Agent**.
Status should say "Running."

Welcome aboard.
[Founder name]

---

## 3) One-page printable summary — pin in Slack / print on a sticker

> **Print this on letter or A4 — fits on one side, no shrinking
> needed.**

---

### Exargen Pulse Agent — TL;DR for the team

**What:** A small program that produces a 0–100 productivity
score per person, derived from seven signals, refreshed daily and
weekly. Score is visible **only to the founder**.

**Install:** Double-click installer → approve UAC → paste
`det_…` token → Next → Install → Finish. ~30 seconds.

**Monitored:** Active/idle time, foreground app name + window
title, installed software, device security posture, battery /
disk / network state.

**NOT monitored:** Keystrokes, screen contents, file contents,
browser history, webcam, microphone, location, personal email
content.

**Lives at:** `services.msc` → Exargen Pulse Agent. Two helper
scheduled tasks: ExargenPulseUserProbe (every 1 min, samples the
active window), ExargenPulseWatchdog (every 5 min, restarts the
agent if it crashed).

**Footprint:** ~0.3% CPU average, ~70 MB RAM, < 5 MB egress / day.

**Anti-cheat:** Mouse jigglers and keep-awake tools are detected
and flagged. Don't run them. AutoHotKey for legitimate key
remapping is fine — talk to the founder about a per-device
whitelist.

**Uninstall:** Settings → Apps → Installed apps → Exargen Pulse
Agent → Uninstall. Clean removal, no leftover files.

**Leaving the company:** Account deactivation triggers a clean
agent exit within 5 min. Data is retained 13 months for audit,
then auto-nulled.

**Questions:** Read
`docs/pulse/06-employee-onboarding-guide.md` or message the
founder.

---

## 4) IT admin / SUPER_ADMIN deployment checklist

For the person physically doing the rollout, in order. Tick each
box; don't skip ahead.

### Pre-rollout (T-7 days)

- [ ] **Backend on the planned release tag.** Confirm via
      `GET /api/v1/system/version` returns the expected commit.
- [ ] **Migration `20260530200000_extended_client_access` and
      every prior one** applied to prod via `npx prisma migrate
      deploy`. (Required for the `extendedClientAccess` field,
      not for Pulse itself, but a green migration run is the gate
      anyway.)
- [ ] **Feature flag `FEATURE_PULSE_COMPOSITE_SCORE_BETA` is
      OFF.** Agents collect + send data; backend computes
      nothing until the flag flips on. Verify in the flag store.
- [ ] **Installer is built and code-signed.** Build via
      `windows-agent/installer/build-installer.ps1`. Verify the
      signature on the output `.exe` with `signtool verify /v`.
- [ ] **Hosting decision for the installer.** Pick one: internal
      file share, signed S3 URL, or a private GitHub Release. Do
      NOT post to a public URL — the .exe is for employees only.
- [ ] **Enrollment-token batch issued.** Generate one per
      employee laptop via the SUPER_ADMIN device console
      (`/admin/pulse/devices`). Store the mapping `(employee →
      token)` in a password manager, not a spreadsheet.
- [ ] **Pre-rollout email** sent to all employees (template above)
      48 hours in advance. Replies addressed.

### Install day (T-0)

- [ ] **Install-day email** sent in the morning, each with that
      employee's specific token in the body.
- [ ] **Slack / Teams channel pinned** with the printable summary
      so people can self-serve.
- [ ] **You're on call** for the first 2 hours after sending.
      Most issues are SmartScreen warnings or UAC fumbles — both
      are 60-second fixes.
- [ ] **Dashboard check at end-of-day.** Every enrolled device
      should appear in `/admin/pulse/devices` with status
      `ACTIVE`, last-seen timestamp within the last hour, and
      agent version matching the installer.

### Post-install (T+24h, T+72h)

- [ ] **T+24h: review the device list.** Anyone whose laptop
      hasn't checked in? Investigate (likely: install failed, or
      they didn't run the installer). Reach out personally; don't
      Slack-shame.
- [ ] **T+24h: check agent self-health.** Sort the device list by
      `agentErrorCount` descending. Any agent reporting > 0
      errors is silently broken — pull the error message and
      either patch or pull the device out of the dashboard for
      manual review.
- [ ] **T+24h: clock-skew sweep.** Any device with a
      `lastErrorMessage` matching `/clock skew/` has a bad RTC or
      a misconfigured timezone. Reach out — the data from those
      devices is wrong until the user fixes their clock.
- [ ] **T+72h: smoke-test the score path.** Pick one engineer's
      device. Check that their `productivity_events` rows are
      accumulating (standup, presence, deep-work bucket from the
      foreground probe). If the rows are zero or near-zero, the
      foreground-probe scheduled task isn't running on that
      device — see runbook below.

### Calibration window (T+1 week → T+2 weeks)

- [ ] **Spot-check 3 random employees per day.** Look at their
      breakdown drawer. Anything obviously wrong (the classifier
      is mis-tagging a tool they use a lot, presence is
      under-counting because they take long lunches off-laptop,
      etc.) — fix the classifier rules or surface to the team.
- [ ] **No flag-flip yet.** During calibration, scores are
      computed for inspection but not surfaced anywhere.
- [ ] **Tighten the weights** if calibration shows one signal is
      dominating. The R5 universal weights (STANDUP=0.13,
      EXECUTION=0.22, CODE=0.10, COMMUNICATION=0.10, PRESENCE=0.18,
      DEEP_WORK=0.22, DEVICE_HYGIENE=0.05) are the launch
      default; tune in the SUPER_ADMIN weight-set editor if needed
      and re-validate against the same calibration window.

### Flag-flip (after calibration is signed off)

- [ ] **Run the dev-seed wipe tool** to clear any test data:
      `NODE_ENV=production bun run
      backend/scripts/wipeDevProductivityEvents.ts
      --apply --allow-production`.
- [ ] **Flip the flag.** Set
      `FEATURE_PULSE_COMPOSITE_SCORE_BETA=true` in the flag store
      (or env, depending on your deployment).
- [ ] **Watch `/admin/pulse/scores` for the first 30 minutes.**
      The worker repopulates scores from real events on the 5-min
      poll. If the dashboard stays empty after 10 min, the worker
      isn't running — see runbook.
- [ ] **Send a "live now" all-hands ping.** Short and honest:
      "scores are now computed live. The first month is the
      calibration window we talked about. Talk to me if anything
      looks wrong."

---

## 5) Common-failure runbook (for support tickets)

The first three are 90% of the tickets you'll get.

### "SmartScreen warns about an unrecognized app"

Click **More info → Run anyway**. Happens to every freshly-signed
installer until SmartScreen builds reputation. Safe; we
double-checked the signature.

### "I get a UAC prompt I can't approve"

The employee isn't a local admin on their laptop. Two options:
- Have IT do the install for them (one-time, ~3 minutes).
- Pre-elevate via `Run as administrator` on the installer.

### "Installer says enrollment failed"

The `det_…` token is single-use. Most likely cause: the user
clicked the installer twice in a row, and the first one consumed
the token. Issue a fresh token from `/admin/pulse/devices` and
ask them to retry.

### "Service is installed but not running"

Open `services.msc`, find **Exargen Pulse Agent**, right-click →
Properties → check the **Log On** tab is set to **Local System**
account. If it's anything else, fix it. Then:
`schtasks /Run /TN ExargenPulseWatchdog` from an admin terminal
fires the watchdog manually, which will start the service.

Look at `%ProgramData%\ExargenPulse\logs\pulse-agent.err.log` for
the actual error. Common causes:

- *`Pulse config not found`* — installer didn't write the config.
  Re-run the installer.
- *`serverUrl is required`* — installer was run without a server
  URL. Re-run with the wizard, not in silent mode.
- *Network unreachable* — firewall is blocking
  `command.exargen.in:443`. Open the rule.

### "Per-app data is missing for one employee"

The user-probe scheduled task isn't firing. Check:

1. `taskschd.msc` → `ExargenPulseUserProbe` task exists, is
   **Enabled**, runs as the **interactive user** (not SYSTEM).
2. The probe binary is at
   `C:\Program Files\ExargenPulse\user-probe.exe` and isn't
   quarantined by antivirus. (If Defender ate it, restore it from
   quarantine and add an exclusion for the install path.)
3. The output file at
   `%ProgramData%\ExargenPulse\probe\foreground.json` is being
   updated every ~60 seconds. If it's stale, run
   `schtasks /Run /TN ExargenPulseUserProbe` manually and check.

### "A PowerShell / black window flashes every 5 minutes"

This is the single most-reported cosmetic complaint, and it has
exactly one cause: the device has an **old-style watchdog
scheduled task** that runs `powershell.exe -WindowStyle Hidden`
every 5 minutes. The `-WindowStyle Hidden` flag is applied *after*
conhost.exe has already begun painting a console, so the user sees
a brief black flash. (The 5-minute cadence is the giveaway — it's
the watchdog interval. The 1-minute foreground probe was migrated
to a flash-free Go binary back in PR #32.)

The current agent ships a Go-compiled `watchdog.exe` (GUI
subsystem, no console) that never flashes. A device still flashing
either installed an older build or hit the now-removed
flaky-network fallback.

**Fastest fix (no reinstall) — run on the affected machine as
admin:**

```powershell
powershell -ExecutionPolicy Bypass -File repair-watchdog-flash.ps1
```

That script detects a flashing PowerShell watchdog, removes it, and
re-stages the Go `watchdog.exe` (falling back to "remove it and let
SCM recovery cover the service" if the binary can't be found). Safe
to run repeatedly; it's a no-op on an already-clean machine.

**Manual one-liner to just check what's registered:**

```powershell
Get-ScheduledTask ExargenPulseWatchdog | ForEach-Object { $_.Actions } | Format-List Execute, Arguments
```

If `Execute` is `powershell.exe` → it's the flashing one, run the
repair. If `Execute` is `…\watchdog.exe` → it's already clean and
the flash is something else (check Task Scheduler for non-Pulse
tasks).

**Manual nuke (if you just want the flash gone and don't care about
the 5-min liveness watchdog — SCM recovery still restarts the
service on crash):**

```powershell
schtasks /Delete /TN ExargenPulseWatchdog /F
```

Re-running the installer (or `harden-pulse.ps1`) also repairs this
automatically — both delete the old task and re-register the Go
binary.

### "Clock skew detected" alert on a device

The user's laptop clock is wrong by > 5 minutes. Fix:

1. Open **Settings → Time & language → Date & time**.
2. **Set time automatically** → On.
3. **Sync now**.
4. If sync fails (corporate network blocks `time.windows.com`),
   set the time manually to the correct value.
5. Restart the Pulse Agent service from `services.msc` so the
   next heartbeat picks up the corrected clock.

### "Agent is using a lot of CPU / RAM"

Open the device's breakdown drawer in
`/admin/pulse/devices/<id>`. The `cpuPercent` and `memoryMb`
gauges are reported by the agent itself on every heartbeat. Two
common causes:

- *PowerShell collector hanging* — usually a misbehaving
  third-party security tool intercepting the `Get-MpComputerStatus`
  or `Get-NetFirewallProfile` call. Identify via Process Explorer
  → look for a long-running `powershell.exe` whose parent is
  `PulseAgent.exe`. Whitelist the agent in the security tool's
  exclusions.
- *Memory leak* — if `memoryMb` is climbing steadily, escalate
  to engineering with the device ID and 24h of self-health
  readings.

### "I want to uninstall it myself"

Settings → Apps → Installed apps → Exargen Pulse Agent →
Uninstall. This is the supported path and it cleanly removes the
service, both scheduled tasks, the install directory, and
`%ProgramData%\ExargenPulse\`. The user does NOT need IT
permission for this — by design, anyone with admin on their own
laptop can uninstall.

---

## 6) What "good" looks like at the end of week 1

- ≥ 95% of laptops in the dashboard, status `ACTIVE`, last-seen
  within the last 15 minutes.
- Zero devices with `agentErrorCount > 5` (a 1-off error is fine;
  a recurring count is a silently-broken agent that needs
  attention).
- < 2% of devices with any clock-skew alert.
- Calibration window has ≥ 5 working days of data per active
  employee before the flag flips.
- Two replies to your post-rollout "anything you noticed?" check-in
  message, with at least one being a real signal you can act on.

If you're hitting all five, the rollout went well. Flip the flag
and let the system run.

---

*Living document — `docs/pulse/07-employee-rollout-kit.md`. Edit
in place when reality teaches you something better than what's
written here.*
