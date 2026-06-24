# Pulse Agent — Employee Onboarding Guide

> **Read this once. ~10 minutes. Covers what we measure, what we
> deliberately don't measure, the install steps, and what to do if
> something looks off.**

This is the guide your manager will send you with the installer. It's
written for the person installing it, not for engineers.

---

## TL;DR

1. **Open the installer email** your manager sent. It contains a 1-time
   `det_…` enrollment token.
2. **Double-click `PulseAgentInstaller-x.y.z.exe`.** Approve the UAC
   prompt. Paste the token when the wizard asks. Click Next → Install
   → Finish.
3. **You're done.** The agent runs silently as a Windows Service. There
   is no tray icon, no notification, no dashboard you log into. You
   keep working the way you already do.

If anything below looks wrong or surprising, talk to your manager
before doing the install. You can always stop the install with
Cancel.

---

## What this is

**Pulse** is a small program that helps the company understand how
work is going — across the whole team, not for any individual call-out.
It produces a productivity score on a 0–100 scale, derived from seven
signals (more on those below), refreshed daily and weekly.

The score is visible **only to the founder / company admin**. Not to
your manager, not to your peers, not to you. (Yes, even you — by
founder directive, this dashboard is locked to one person.)

---

## What's actually monitored (the honest list)

### Signals the agent collects from your laptop

When the agent is running, it sends a "heartbeat" every 5 minutes (a
tiny ping) and a "snapshot" every 60 minutes (a fuller report). The
snapshot contains:

| What | What it's used for |
|---|---|
| **Time you were active / idle / locked** (seconds per hour) | Presence signal — counts hours present per working day |
| **Which app had focus**, second-by-second, with its category (productive / communication / entertainment / personal) | Deep-work signal — flags Pomodoro-length focus blocks on productive apps |
| **Window title of the foreground app** (e.g. "(2) Slack | exargen | inbox") | Used to classify what's on screen — a browser tab on github.com counts differently from netflix.com |
| **When you logged into your Windows session today** (vs when the laptop booted) | Presence consistency bonus — same start time across days |
| **Power state** (laptop on / idle / lock screen / off) | The above three depend on this |
| **Windows security posture** (Defender / Firewall / BitLocker on, reboot pending, OS support level) | Device hygiene signal — IT sees machines that need attention |
| **Installed software inventory + missing Windows patches** | Same — feeds device hygiene |
| **Battery state, free disk space, network type** (Wave 9) | Lets your admin see "this laptop is offline because the user is on a flight" instead of guessing |
| **Background processes that look like mouse jigglers / keep-awake tools** (Wave 9) | Anti-cheat — flags software whose only purpose is to fake activity |
| **The agent's own CPU + memory usage** (Wave 9) | Lets IT spot an agent that's silently broken |

### Signals NOT from your laptop, but counted toward your score

The 0–100 productivity score is built from seven signals total. Three
come from the laptop (above). The other four come from things you
already do in the Command Center:

- **Standup** — whether you submitted a substantive daily standup
- **Execution** — whether your tasks are being closed at a healthy rate
- **Code** — your GitHub activity (commits / PRs opened / PRs merged
  / reviews given on the org's repos)
- **Communication** — comments + @-mentions in the Command Center

---

## What is deliberately NOT monitored

This is the most important section. **The agent does NOT collect:**

- ❌ **Keystrokes.** No keylogging. The agent doesn't see what you
  typed, ever. It only sees how long the keyboard / mouse have been
  idle (to tell "active" from "idle"), not the keys themselves.
- ❌ **Screen contents.** No screenshots. No screen recording. The
  agent never sees what's actually rendered on your monitor — only
  the **name** of the foreground app and its **window title** (the
  text in the title bar).
- ❌ **File contents.** Your code, documents, photos, music — none of
  this is read. Only the **list** of installed applications (from the
  Windows registry) is sent, and only at the snapshot cadence (~once
  per hour). No paths, no file names.
- ❌ **Browser history.** No URLs. The agent reads the active browser
  **window title** (which often contains the page title, e.g.
  "GitHub - exargen/repo") to classify the tab, but it does not read
  your full browser history, cookies, passwords, bookmarks, or
  inactive tabs.
- ❌ **Webcam, microphone, location.** Never accessed.
- ❌ **Personal accounts.** Your personal email (Gmail / Hotmail /
  Yahoo) is categorised as "personal" if it's the active tab —
  meaning that time is counted as personal time, not as work time —
  but the agent doesn't read the email content, sender, or subject.
- ❌ **Other people's activity.** If you share the laptop with a
  spouse or family member, only the time **you** are logged into
  your Windows account is reported. When they log in under their own
  Windows account, the agent ignores it.

### What if I leave the company?

When your account is deactivated, the SUPER_ADMIN revokes your
device. Within one heartbeat (≤ 5 minutes), the agent receives a
"revoked" signal from the backend and **exits cleanly on its own**.
It stops collecting and stops sending. You can also uninstall it
manually (see "Uninstall" below).

The same clean-shutdown path fires if anything ever goes wrong with
your account-to-device pairing — the agent treats an unexpected
permission error from the server (HTTP 401 / 403) as a "you've been
deauthorized" signal, exits cleanly, and the Windows Service
supervisor (NSSM) does NOT restart it. No retry-loop burns your
battery or your bandwidth.

Historical telemetry is retained for **13 months** for audit
purposes, then automatically nulled per the data-retention policy.

---

## Installation — step by step

### Before you start

You'll need:

- A Windows 10 (build 19041 / version 20H2 or newer) or Windows 11
  machine.
- A user account with administrator rights, OR an admin standing by
  to approve the UAC prompt.
- The **enrollment token** your manager sent you. It looks like
  `det_…` followed by ~64 characters. **Single use** — once consumed
  it can't be reused, so don't share it.

### Step 1 — Download

Your manager sends you a link to `PulseAgentInstaller-x.y.z.exe`.
Save it to your Downloads folder. The file is ~30 MB and signed by
Exargen AI (you can verify by right-clicking → Properties → Digital
Signatures).

If SmartScreen warns you about an "unrecognized app," click **More
info** → **Run anyway**. (This happens on every freshly-signed
installer until SmartScreen builds reputation. Your IT team will let
you know if a particular release is expected to be flagged.)

### Step 2 — Run the installer

Double-click `PulseAgentInstaller-x.y.z.exe`. Approve the UAC prompt
("Do you want to allow this app to make changes to your device?"). 

You'll see a small wizard:

1. **Welcome** — click Next.
2. **Enrollment details** — paste the `det_…` token. The server URL is
   pre-filled to the production Command Center — **leave it alone**
   unless your admin explicitly tells you to change it. Click Next.
3. **Ready to install** — click Install. UAC may prompt again.
4. **Finished** — click Finish.

The installer takes about 30 seconds. When it's done the agent is
already running — there's nothing else to start.

### Step 3 — Verify (optional)

You don't have to verify, but if you want to:

- Open **Services** (`Win+R` → `services.msc` → Enter).
- Scroll to **Exargen Pulse Agent**. The status should say "Running"
  and Startup Type should be "Automatic."
- Also visible: **ExargenPulseUserProbe** and **ExargenPulseWatchdog**
  scheduled tasks (`taskschd.msc`). These are the foreground-app
  sampler and the auto-restart watchdog.

If the service isn't running 60 seconds after install, check
`%ProgramData%\ExargenPulse\logs\pulse-agent.err.log` and forward it
to your admin.

---

## Day-to-day: do's and don'ts

### ✅ Do

- **Forget about it.** The point of a headless agent is that it stays
  out of your way. There's no tray icon to click, no settings panel
  to tune, no notifications to dismiss.
- **Clock in / out** like you already do (or have started doing). The
  presence signal uses both your clock state AND the laptop's
  activity. The two cross-check each other — if you clock in but
  walk away from the laptop, the score reflects that.
- **Submit your standups.** They're 13% of your score. A short
  honest standup is far better than no standup.
- **Use the right tools.** The classifier categorises ~150 apps as
  PRODUCTIVE (VS Code, Cursor, JetBrains, Postman, Figma, Notion,
  Linear, GitHub, all major cloud consoles, Stack Overflow, Claude /
  ChatGPT / Perplexity, etc.). If you spend an hour in something not
  on the list it shows up as UNKNOWN — which is **neutral**, not
  punished, but also not credited. If your favourite tool is in
  UNKNOWN, **tell your admin** so they can add it.
- **Keep your laptop reasonably maintained.** Defender on, Firewall
  on, BitLocker on (if your machine supports it), patches reasonably
  current. Device hygiene is only 5% of the composite score but a
  cluster of red signals here triggers an IT alert.

### ❌ Don't

- **Don't run mouse-jigglers or keep-awake tools** (Caffeine,
  MouseJiggler, AutoHotKey scripts that simulate input). The agent
  enumerates running processes once per snapshot and flags any that
  match a curated list of these tools. Detection triggers a TAMPER
  alert and zeroes the deep-work signal for that window. AutoHotkey
  has legitimate uses (key remapping) — if you use it that way, talk
  to your admin and they can whitelist your device.
- **Don't try to fool the categorizer.** Renaming `netflix.exe` to
  `code.exe` doesn't fool it — the agent reads the binary's
  `FileDescription` from its PE version block. (Also, this would
  show up as obviously weird in the breakdown drawer.)
- **Don't tamper with the agent's config or scheduled tasks.** The
  config is ACL-locked to SYSTEM + Administrators, and the watchdog
  scheduled task auto-restarts the service if it goes down. Tamper
  attempts surface as "agent silent for X minutes" alerts.
- **Don't share the laptop login with anyone.** Sessions are
  per-Windows-account. If a family member logs into your account,
  that activity is attributed to you.

---

## "Why is my score what it is?"

You can't see the breakdown yourself — that's locked to the SUPER_ADMIN
per founder directive. But the SUPER_ADMIN can see the full audit
trail any time, and is happy to walk through it with you.

Ask your manager for a 1:1 with the SUPER_ADMIN to look at your
breakdown. You'll see:

- Your composite score for the cadence (daily / weekly / monthly)
- The seven sub-scores with the weight each contributes
- The raw counts that fed each sub-score (e.g. "you closed 4 tasks
  this week, target is 6")
- Every productivity event that fed the calculation (up to 500 rows)

If something looks wrong, that's the place to flag it. Bad categories,
events that shouldn't have counted, an app classifier miss — all of
that can be corrected.

---

## FAQ

### How often does it actually phone home?

- **Heartbeat:** every 5 minutes (tiny payload, ~1 KB)
- **Snapshot:** every 60 minutes (~10–50 KB depending on installed
  software count)

Total egress is well under 5 MB per day on a typical machine.

### What about CPU + battery impact?

- CPU: averages ~0.3% of one core. Spikes briefly during the snapshot
  collector (~1 second of ~10% CPU once per hour).
- Memory: ~70 MB resident.
- Battery: negligible — the heaviest cost is the hourly Windows
  Update Agent COM query during the snapshot.

If you see the agent using significantly more than that, tell your
admin. The Wave 9 self-health telemetry lets them spot a leak or
runaway from the dashboard.

### What if my laptop clock is wrong?

The agent compares the laptop's clock to the server's clock on every
heartbeat. When the two are more than 5 minutes apart — usually
because your CMOS battery died, or you manually misconfigured the
timezone — the agent records the skew and surfaces it in the
worker-health dashboard so IT can reach out. The agent still works,
but every timestamp it sends is wrong by that offset, which can make
your productivity data look strange. Fix is usually a quick "sync
with internet time" in Windows Settings, then restart the service.

### What happens when I restart my laptop?

A clean Windows shutdown / restart / log-off sends the agent a
`SIGTERM`. The agent stops the three internal timers, flushes any
pending log lines, and exits with status 0 — the Windows Event Log
records a normal stop. On the next boot, the Windows Service
Controller starts the agent automatically (Startup Type = Automatic)
and it picks up exactly where it left off. The 5-min heartbeat
cadence means the dashboard shows you "online again" within ~5
minutes of login.

### What happens when I'm on a plane / offline / on hotel WiFi behind a captive portal?

The agent keeps collecting state-time + foreground-app data locally.
Heartbeats and snapshots that fail (network unreachable) are
**dropped on the floor in v1** — they don't buffer to disk and replay
later. So a 4-hour offline window means up to 4 hours of state-time
data is lost. (Offline buffering is on the roadmap; flag this if it
matters for your role.)

Your SUPER_ADMIN sees the gap on the worker-health dashboard, with
the network type at last known state (e.g. `WIFI` or `UNKNOWN`).

### What if my laptop is shared with my family after hours?

Sessions are per Windows account. The agent attributes activity only
to the currently-logged-in user. If your family uses their own
Windows account, none of their activity counts toward you. If they
log into yours, it does — so use separate accounts.

### Can I see my own score?

Not in v1. The founder's call is that this is an admin-only tool
during the calibration period. If that policy changes (i.e. a "see
your own band" widget for employees), you'll be told.

In the meantime, the breakdown is available on request — the
SUPER_ADMIN can pull it up in two clicks during a 1:1.

### What happens to my data if I leave?

When your user account is deactivated and your device is revoked:

1. The next heartbeat (within 5 min) tells the agent "you're
   revoked." It stops scheduling work and exits.
2. Telemetry already in the database is retained for **13 months**
   per the audit-trail policy, then the raw payload column is nulled
   automatically.
3. If you formally request deletion under our privacy policy, the
   admin can hard-delete your row from `productivity_events` and
   `employee_productivity_scores` via the (forthcoming) GDPR
   right-to-be-forgotten endpoint.

You can also **uninstall the agent yourself** before that — see below.

---

## Uninstall

If you need to remove the agent (e.g. you're leaving the company,
swapping laptops, or returning a loaner):

1. Open **Settings** → **Apps** → **Installed apps**.
2. Find **Exargen Pulse Agent v0.x.x**. Click → **Uninstall**.
3. Approve the UAC prompt.

The uninstaller reverses everything the installer did:

- Stops + removes the `ExargenPulseAgent` Windows Service
- Removes both scheduled tasks (`ExargenPulseUserProbe`,
  `ExargenPulseWatchdog`)
- Deletes `%ProgramData%\ExargenPulse\` (config, logs, probe data)
- Removes Program Files\ExargenPulse\

That's a clean removal — no leftover files, no leftover registry
keys, no orphaned scheduled tasks.

If you want to verify after uninstall: `services.msc` should no
longer list ExargenPulseAgent, and `%ProgramData%\ExargenPulse\`
should not exist.

---

## Where to look if something's off

- **A black / PowerShell window flashes every 5 minutes:** you're on
  an older build with the legacy watchdog. The current agent uses a
  flash-free Go binary. Tell your admin "I'm getting the 5-minute
  flash" — they have a one-command repair
  (`repair-watchdog-flash.ps1`) that fixes it without a reinstall.
  Nothing is wrong with your data; it's purely cosmetic.
- **Service not running:** `services.msc` → `ExargenPulseAgent` →
  right-click → Start. Or run the watchdog manually: in an admin
  terminal, `schtasks /Run /TN ExargenPulseWatchdog`.
- **No per-app data showing up:** the user-probe scheduled task isn't
  running. `schtasks /Run /TN ExargenPulseUserProbe` to fire it
  once; check `%ProgramData%\ExargenPulse\probe\foreground.json` was
  updated.
- **Score keeps showing 0 / UNKNOWN for an app you use heavily:**
  the classifier doesn't recognise that app. Tell your admin the
  app's exe name (e.g. `code.exe`) or the browser tab URL pattern,
  and they can add it.
- **Agent is using a lot of CPU or memory:** check the worker-health
  tab with your admin. The agent self-reports its CPU and memory on
  every heartbeat. A leak shows up there immediately.
- **You think a score is wrong:** ask for a 1:1 with the SUPER_ADMIN
  and look at the breakdown drawer together. Every score is fully
  auditable — every event that contributed is there.

---

## Final notes

- Pulse is gated behind a feature flag (`FEATURE_PULSE_COMPOSITE_SCORE_BETA`)
  for the calibration period. While the flag is off, the agent still
  collects + sends data but no scores are produced from it. The flag
  flips on when calibration is complete.
- This guide is a living document. If something here is wrong, out of
  date, or unclear, flag it — the docs are in
  `docs/pulse/06-employee-onboarding-guide.md` and accept PRs.
- The system overview lives at `docs/pulse/00-OVERVIEW.md` and the
  full technical design at `docs/pulse/04-productivity-scoring.md`.
  Both are SUPER_ADMIN reading but you're welcome to skim them if
  you're curious.
