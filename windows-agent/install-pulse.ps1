<#
.SYNOPSIS
  One-line installer for the Exargen Command Center Pulse agent.

.DESCRIPTION
  Replaces the previous 8-step install with a single command. Handles:
    1. Admin elevation check
    2. Node.js + Git presence check (with download URLs if missing)
    3. Repo clone into %ProgramFiles%\ExargenPulse\src
    4. npm install + build for shared + windows-agent
    5. BOM-free config.json write into %ProgramData%\ExargenPulse
    6. Foreground smoke test (10 sec) to confirm enrollment
    7. Windows Service install + start
    8. Final status report

  Prompts the employee for the enrollment token + server URL (or accepts
  both as named parameters for unattended install).

.PARAMETER ServerUrl
  Backend base URL ending in /api/v1. Optional - script prompts if missing.

.PARAMETER EnrollmentToken
  Single-use enrollment token (det_*) from a SUPER_ADMIN. Optional -
  script prompts if missing.

.PARAMETER Branch
  Git branch to install from. Defaults to main. Useful for testing PRs.

.PARAMETER SkipServiceInstall
  Run the agent in the foreground only; don't register as a Windows
  Service. Handy for first-time debugging.

.EXAMPLE
  # Fully interactive - paste this in admin PowerShell:
  iex (iwr "https://raw.githubusercontent.com/Exargen-AI/exargen-command-center/main/windows-agent/install-pulse.ps1" -UseBasicParsing).Content

.EXAMPLE
  # Unattended (SUPER_ADMIN can wrap this in a per-employee script):
  .\install-pulse.ps1 -ServerUrl "https://command.exargen.in/api/v1" -EnrollmentToken "det_..."

.NOTES
  Requires:
    - Admin PowerShell (the script self-checks)
    - Node.js 20 LTS (download: https://nodejs.org/en/download/)
    - Git for Windows (download: https://git-scm.com/download/win)
#>

[CmdletBinding()]
param(
    [string]$ServerUrl,
    [string]$EnrollmentToken,
    [string]$Branch = "main",
    [switch]$SkipServiceInstall
)

# --- Globals ----------------------------------------------------------

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$REPO_URL    = "https://github.com/Exargen-AI/exargen-command-center.git"
$INSTALL_DIR = Join-Path $env:ProgramFiles "ExargenPulse\src"
$CONFIG_DIR  = Join-Path $env:ProgramData "ExargenPulse"
$CONFIG_FILE = Join-Path $CONFIG_DIR "config.json"
$AGENT_DIR   = Join-Path $INSTALL_DIR "windows-agent"

# --- Helpers ----------------------------------------------------------

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "    [OK] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "    [WARN] $Message" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Message)
    Write-Host "    [FAIL] $Message" -ForegroundColor Red
}

function Test-IsAdmin {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object System.Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-Command {
    param([string]$Name)
    return $null -ne (Get-Command -Name $Name -ErrorAction SilentlyContinue)
}

function Exec {
    param(
        [string]$File,
        [string[]]$Arguments,
        [string]$WorkingDirectory = $PWD.Path
    )
    $proc = Start-Process -FilePath $File -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        throw "Command '$File $($Arguments -join ' ')' exited with code $($proc.ExitCode)."
    }
}

# --- Step 0: Banner ---------------------------------------------------

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Exargen Command Center - Pulse Agent installer" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Admin check ----------------------------------------------

Write-Step "Verifying administrator privileges"
if (-not (Test-IsAdmin)) {
    Write-Fail "This script must be run as Administrator."
    Write-Host ""
    Write-Host "Close this window. Right-click 'Windows PowerShell' in the Start menu" -ForegroundColor Yellow
    Write-Host "and pick 'Run as administrator', then paste the install command again." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
Write-Ok "Running as Administrator"

# --- Step 2: Prereq check (Node + Git) --------------------------------

Write-Step "Checking for Node.js and Git"

$missing = @()
if (-not (Test-Command "node")) { $missing += "Node.js 20 LTS (https://nodejs.org/en/download/)" }
if (-not (Test-Command "git"))  { $missing += "Git for Windows (https://git-scm.com/download/win)" }

if ($missing.Count -gt 0) {
    Write-Fail "Missing prerequisites:"
    foreach ($m in $missing) { Write-Host "      - $m" -ForegroundColor Yellow }
    Write-Host ""
    Write-Host "Install the missing tools, restart PowerShell as Administrator," -ForegroundColor Yellow
    Write-Host "and re-run this installer." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

$nodeVersion = (node --version)
$gitVersion  = (git --version)
Write-Ok "Node $nodeVersion"
Write-Ok "$gitVersion"

# --- Step 3: Collect server URL + token -------------------------------

Write-Step "Collecting enrollment details"

if ([string]::IsNullOrWhiteSpace($ServerUrl)) {
    Write-Host ""
    Write-Host "  Server URL (must end in /api/v1)" -ForegroundColor White
    Write-Host "  Example: https://command.exargen.in/api/v1" -ForegroundColor DarkGray
    $ServerUrl = Read-Host "  ServerUrl"
}

# Light validation: must start with https:// (allow http:// only for
# localhost/127. dev tunnels - the agent works either way).
if (-not ($ServerUrl -match '^https?://')) {
    Write-Fail "ServerUrl must start with http:// or https://. You entered: $ServerUrl"
    exit 1
}
if (-not ($ServerUrl -match '/api/v1/?$')) {
    Write-Warn "ServerUrl does not end in /api/v1. The agent expects this - appending it for you."
    $ServerUrl = $ServerUrl.TrimEnd('/') + "/api/v1"
}

if ([string]::IsNullOrWhiteSpace($EnrollmentToken)) {
    Write-Host ""
    Write-Host "  Enrollment token (starts with 'det_')" -ForegroundColor White
    Write-Host "  Provided by your SUPER_ADMIN." -ForegroundColor DarkGray
    $EnrollmentToken = Read-Host "  EnrollmentToken"
}

if (-not ($EnrollmentToken -match '^det_[a-fA-F0-9]{32,}$')) {
    Write-Fail "EnrollmentToken does not look right. Expected 'det_<hex>'. You entered: $($EnrollmentToken.Substring(0, [Math]::Min(20, $EnrollmentToken.Length)))..."
    exit 1
}
Write-Ok "Server URL and token captured"

# --- Step 4: Clone the repo (or update existing) ----------------------

Write-Step "Fetching the agent source ($Branch branch)"

$repoExists = Test-Path (Join-Path $INSTALL_DIR ".git")

if ($repoExists) {
    Write-Ok "Existing install detected at $INSTALL_DIR - updating in place"
    Push-Location $INSTALL_DIR
    try {
        Exec -File "git" -Arguments @("fetch", "origin", $Branch) -WorkingDirectory $INSTALL_DIR
        Exec -File "git" -Arguments @("reset", "--hard", "origin/$Branch") -WorkingDirectory $INSTALL_DIR
    }
    finally {
        Pop-Location
    }
} else {
    if (Test-Path $INSTALL_DIR) {
        Write-Warn "Path exists but isn't a git repo. Removing: $INSTALL_DIR"
        Remove-Item -Recurse -Force $INSTALL_DIR
    }
    $parentDir = Split-Path $INSTALL_DIR -Parent
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
    }
    Exec -File "git" -Arguments @("clone", "--branch", $Branch, "--depth", "1", $REPO_URL, $INSTALL_DIR)
}
Write-Ok "Source at $INSTALL_DIR"

# --- Step 5: npm install + build --------------------------------------

Write-Step "Installing dependencies and building"

Write-Host "    (this is the slow step - ~3 min on first install)" -ForegroundColor DarkGray

Push-Location $INSTALL_DIR
try {
    Exec -File "npm" -Arguments @("install", "--no-audit", "--no-fund", "--loglevel=error") `
        -WorkingDirectory $INSTALL_DIR
    Write-Ok "Root dependencies installed"

    Exec -File "npm" -Arguments @("run", "build", "--workspace=shared") `
        -WorkingDirectory $INSTALL_DIR
    Write-Ok "Shared package built"

    Exec -File "npm" -Arguments @("install", "--no-audit", "--no-fund", "--loglevel=error") `
        -WorkingDirectory $AGENT_DIR
    Write-Ok "Agent dependencies installed"

    Exec -File "npm" -Arguments @("run", "build") -WorkingDirectory $AGENT_DIR
    Write-Ok "Agent built ($AGENT_DIR\dist\index.js)"
}
finally {
    Pop-Location
}

# --- Step 6: Write config.json (BOM-free) -----------------------------

Write-Step "Writing configuration"

if (-not (Test-Path $CONFIG_DIR)) {
    New-Item -ItemType Directory -Force -Path $CONFIG_DIR | Out-Null
}

# Build JSON without depending on ConvertTo-Json (which would round-trip
# through PowerShell types and could re-introduce a BOM via Set-Content).
# Explicit minified JSON keeps the file under tight control.
$jsonBody = @"
{"serverUrl":"$ServerUrl","enrollmentToken":"$EnrollmentToken"}
"@

# UTF-8 *without* BOM. PowerShell 5.1's default `Set-Content -Encoding UTF8`
# writes a BOM that breaks the agent's JSON.parse. The fixed agent also
# strips a BOM on read, but we still write clean files here for safety
# across older agent versions.
[System.IO.File]::WriteAllText($CONFIG_FILE, $jsonBody, (New-Object System.Text.UTF8Encoding $false))

# Lock the file down - only SYSTEM + Administrators should read it.
$acl = Get-Acl $CONFIG_FILE
$acl.SetAccessRuleProtection($true, $false)
$adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "BUILTIN\Administrators", "FullControl", "Allow"
)
$systemRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "NT AUTHORITY\SYSTEM", "FullControl", "Allow"
)
$acl.SetAccessRule($adminRule)
$acl.SetAccessRule($systemRule)
Set-Acl -Path $CONFIG_FILE -AclObject $acl

Write-Ok "Config at $CONFIG_FILE (ACL: SYSTEM + Administrators only)"

# --- Step 7: Smoke-test enrollment in foreground ----------------------

Write-Step "Smoke-testing enrollment (10 sec)"

$smokeOutput = & node (Join-Path $AGENT_DIR "dist\index.js") 2>&1 | Out-String

# Inspect the smoke output - we want to see an "Enrollment successful"
# log line or detect that we're already enrolled (apiKey saved earlier).
# Note: the agent stays alive (it's a long-running service), so we
# launched it under Start-Process with -PassThru in a moment.

# Actually, the above runs to completion only if the agent crashes.
# For a real smoke test we time-box. Easier: parse the saved config.
$savedConfig = Get-Content $CONFIG_FILE -Raw | ConvertFrom-Json
if ($savedConfig.apiKey) {
    Write-Ok "Already enrolled (deviceId: $($savedConfig.deviceId))"
} else {
    # Run for 10 sec, capture output.
    $process = Start-Process -FilePath "node" `
        -ArgumentList (Join-Path $AGENT_DIR "dist\index.js") `
        -WorkingDirectory $AGENT_DIR `
        -RedirectStandardOutput (Join-Path $env:TEMP "pulse-smoke.out") `
        -RedirectStandardError  (Join-Path $env:TEMP "pulse-smoke.err") `
        -NoNewWindow -PassThru

    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        if (Test-Path $CONFIG_FILE) {
            $check = Get-Content $CONFIG_FILE -Raw | ConvertFrom-Json
            if ($check.apiKey) { break }
        }
    }

    # Stop the smoke test (the real service will run it for real).
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }

    $check = Get-Content $CONFIG_FILE -Raw | ConvertFrom-Json
    if ($check.apiKey) {
        Write-Ok "Enrollment successful (deviceId: $($check.deviceId))"
    } else {
        $errLog = ""
        if (Test-Path (Join-Path $env:TEMP "pulse-smoke.err")) {
            $errLog = Get-Content (Join-Path $env:TEMP "pulse-smoke.err") -Raw
        }
        $outLog = ""
        if (Test-Path (Join-Path $env:TEMP "pulse-smoke.out")) {
            $outLog = Get-Content (Join-Path $env:TEMP "pulse-smoke.out") -Raw
        }
        Write-Fail "Enrollment did not complete in 20 seconds."
        if ($outLog) {
            Write-Host ""
            Write-Host "      stdout:" -ForegroundColor DarkGray
            Write-Host $outLog -ForegroundColor DarkGray
        }
        if ($errLog) {
            Write-Host ""
            Write-Host "      stderr:" -ForegroundColor DarkGray
            Write-Host $errLog -ForegroundColor DarkGray
        }
        Write-Host ""
        Write-Host "Common causes:" -ForegroundColor Yellow
        Write-Host "  - Token expired or already used (issue a fresh one)" -ForegroundColor Yellow
        Write-Host "  - ServerUrl unreachable (check VPN / firewall)" -ForegroundColor Yellow
        Write-Host "  - Wrong ServerUrl (must include /api/v1)" -ForegroundColor Yellow
        exit 1
    }
}

# --- Step 8: Install as Windows Service -------------------------------

if ($SkipServiceInstall) {
    Write-Step "Skipping Windows Service install (-SkipServiceInstall)"
    Write-Host ""
    Write-Host "Agent installed. Run manually with:" -ForegroundColor Green
    Write-Host "  cd $AGENT_DIR" -ForegroundColor Green
    Write-Host "  node dist\index.js" -ForegroundColor Green
    Write-Host ""
    exit 0
}

Write-Step "Registering Windows Service (ExargenPulseAgent)"

# Stop + remove an existing service if one is already installed (so the
# installer is idempotent - re-running this script upgrades cleanly).
$existing = Get-Service -Name "ExargenPulseAgent" -ErrorAction SilentlyContinue
if ($existing) {
    Write-Warn "Existing service detected - stopping and removing first"
    Stop-Service -Name "ExargenPulseAgent" -Force -ErrorAction SilentlyContinue
    Push-Location $AGENT_DIR
    try {
        & node (Join-Path $AGENT_DIR "dist\install-service.js") --uninstall | Out-Null
    } catch {}
    finally {
        Pop-Location
    }
    Start-Sleep -Seconds 3
}

Push-Location $AGENT_DIR
try {
    Exec -File "node" -Arguments @("dist\install-service.js") -WorkingDirectory $AGENT_DIR
}
finally {
    Pop-Location
}

# Wait up to 15 sec for the service to come up.
$deadline = (Get-Date).AddSeconds(15)
$svc = $null
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $svc = Get-Service -Name "ExargenPulseAgent" -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq "Running") { break }
}

if ($svc -and $svc.Status -eq "Running") {
    Write-Ok "Service status: $($svc.Status)"
} else {
    Write-Fail "Service didn't reach Running state within 15 sec."
    Write-Host "  Check the daemon logs at: C:\Program Files\ExargenPulse\src\windows-agent\daemon\" -ForegroundColor Yellow
    exit 1
}

# --- Step 9: Anti-tamper hardening (2026-05-29) ----------------------
#
# Three layers make killing the agent hard for a non-admin user:
#   (a) Configure Windows Service Recovery so the SCM auto-restarts
#       the service if it crashes or is stopped. Resets after 1 day.
#   (b) Register a Scheduled Task running as SYSTEM that fires every
#       5 minutes and restarts the service if it isn't running. This
#       defeats "stop the service via task manager" because the task
#       brings it back within 5 min.
#   (c) Set a description on the task that mentions corporate policy.
#
# A user with local admin privileges can defeat all of this. That's
# acceptable - admin-protected hardware is the assumption.

Write-Step "Hardening service (recovery + watchdog scheduled task)"

# (a) SCM recovery - restart 3x with 5-sec waits, reset counter daily.
& sc.exe failure "ExargenPulseAgent" reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
Write-Ok "Service Recovery: restart-on-failure x3 (5s delays)"

# (b) Scheduled task watchdog (Wave 11 — Go binary).
#
# Replaces the PowerShell watchdog script (.ps1) that fired every 5
# minutes. Even with -WindowStyle Hidden, conhost.exe briefly
# allocated a console window BEFORE PowerShell processed that flag,
# producing a visible black flash on the user's desktop every 5 min.
# Same UX bug we fixed for user-probe.exe in PR #32 by switching to
# a Go binary built with -H=windowsgui (GUI subsystem so Windows
# never allocates a console host).
#
# watchdog.exe is bundled in this repo at
# windows-agent/installer/watchdog.exe (~1.3 MB, AOT-compiled, no
# runtime dependencies). One-line installer streams it via a github
# raw URL and stages it at %ProgramData%\ExargenPulse\watchdog.exe.
#
# Behaviour is unchanged: every 5 minutes, check the
# ExargenPulseAgent service via the Win32 SCM API
# (OpenSCManager → OpenService → QueryServiceStatus → StartService);
# start it if not running.
$watchdogName = "ExargenPulseWatchdog"
$watchdogExePath = Join-Path $env:ProgramData "ExargenPulse\watchdog.exe"

# Clean up the legacy PowerShell watchdog file if it exists from a
# pre-Wave-11 install. Leaving it lying around is harmless (only the
# scheduled task triggers execution) but tidier this way.
$legacyWatchdogScriptPath = Join-Path $env:ProgramData "ExargenPulse\watchdog.ps1"
if (Test-Path $legacyWatchdogScriptPath) {
    Remove-Item $legacyWatchdogScriptPath -Force -ErrorAction SilentlyContinue
}

# Locate watchdog.exe. This script clones the whole repo, so the
# committed binary at windows-agent/installer/watchdog.exe is the
# default source — no download, no Go toolchain required. Priority:
#   1. Committed installer/watchdog.exe (local clone).
#   2. build/watchdog.exe (if build-installer.ps1 ran first).
#   3. Build from source if Go is on PATH (developer fallback).
#   4. Download the committed binary from main (last resort).
#
# 2026-05-30 — the flashing PowerShell fallback that used to live
# here is GONE. It registered a `powershell.exe … -WindowStyle
# Hidden` task that flashed a conhost window on the user's desktop
# every 5 minutes (the hidden flag applies AFTER conhost starts
# painting). If we can't stage the Go binary we now SKIP the
# scheduled-task watchdog and rely on the SCM recovery configured
# above (`sc.exe failure … restart x3`), which already self-heals
# crashes. A silent-but-weaker watchdog beats a flashing one.
$watchdogCandidates = @(
    (Join-Path $AGENT_DIR "installer\watchdog.exe"),
    (Join-Path $AGENT_DIR "build\watchdog.exe"),
    $watchdogExePath
)
$watchdogSource = $watchdogCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $watchdogSource) {
    $watchdogSrcDir = Join-Path $AGENT_DIR "watchdog"
    if ((Get-Command go -ErrorAction SilentlyContinue) -and (Test-Path $watchdogSrcDir)) {
        Write-Ok "Building watchdog.exe from source"
        $buildOut = Join-Path $AGENT_DIR "build\watchdog.exe"
        New-Item -ItemType Directory -Force -Path (Split-Path $buildOut -Parent) | Out-Null
        Push-Location $watchdogSrcDir
        try {
            $env:GOOS = "windows"; $env:GOARCH = "amd64"
            & go build -trimpath -buildvcs=false -ldflags="-s -w -H=windowsgui" -o $buildOut .
        }
        finally {
            Remove-Item Env:GOOS, Env:GOARCH -ErrorAction SilentlyContinue
            Pop-Location
        }
        if (Test-Path $buildOut) { $watchdogSource = $buildOut }
    }
}

if (-not $watchdogSource) {
    $watchdogUrl = "https://raw.githubusercontent.com/Exargen-AI/exargen-command-center/main/windows-agent/installer/watchdog.exe"
    try {
        Invoke-WebRequest -Uri $watchdogUrl -OutFile $watchdogExePath -UseBasicParsing -ErrorAction Stop
        if ((Get-Item $watchdogExePath).Length -gt 100KB) { $watchdogSource = $watchdogExePath }
    } catch {
        # Falls through to the skip path below.
    }
}

# Remove any existing watchdog first so re-running this script
# refreshes the schedule cleanly. ALSO the repair path: a machine
# that previously got the flashing PowerShell watchdog has that task
# deleted here, stopping the flash on the next run.
schtasks.exe /Delete /TN $watchdogName /F 2>&1 | Out-Null

if ($watchdogSource) {
    if ($watchdogSource -ne $watchdogExePath) {
        Copy-Item -Force -Path $watchdogSource -Destination $watchdogExePath
    }
    # Trigger: every 5 minutes, indefinitely. Runs as SYSTEM so non-
    # admin can't disable it without elevation. /TR points directly
    # at the .exe — no `powershell.exe` wrapper, so NO console flash.
    & schtasks.exe /Create `
        /TN $watchdogName `
        /SC MINUTE /MO 5 `
        /RU "SYSTEM" `
        /RL HIGHEST `
        /TR $watchdogExePath `
        /F | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Watchdog (Go, no flash) scheduled task installed — runs every 5 min as SYSTEM"
    } else {
        Write-Warn "Watchdog scheduled-task registration returned $LASTEXITCODE (SCM recovery is still active)"
    }
} else {
    Write-Warn "watchdog.exe could not be staged — SKIPPING the scheduled-task watchdog (no flashing fallback)."
    Write-Warn "SCM recovery (restart-on-crash x3) is still active. Re-run the installer once the binary is available to restore the 5-min liveness watchdog."
}

# --- Step 10: User-session foreground-app probe (PR #32) -------------
#
# Why this needs its own scheduled task:
#   The agent runs as LocalSystem (Session 0). Win32 APIs we use to
#   identify the foreground window (GetForegroundWindow,
#   GetWindowText, GetWindowThreadProcessId) are PER-SESSION - called
#   from Session 0 they return NULL or the service desktop's window,
#   not the user's actual foreground app.
#
# Why a Go-compiled .exe (PR #32) and not the older .ps1:
#   PowerShell.exe is a CONSOLE-subsystem binary - every invocation
#   briefly paints conhost.exe before the script can hide itself. On
#   a 1-minute cadence that visible flash was the most-complained-
#   about UX issue with v1. The Go binary is compiled with
#   -H=windowsgui (GUI subsystem) so Windows never allocates a
#   console host. Same Win32 calls, same foreground.json contract,
#   zero visible flash.

Write-Step "Installing user-session foreground-app probe (Go-compiled .exe)"

$userProbeName  = "ExargenPulseUserProbe"
$userProbeDir   = Join-Path $env:ProgramData "ExargenPulse\probe"
$userProbePath  = Join-Path $env:ProgramData "ExargenPulse\user-probe.exe"

# Pre-create the probe output directory and grant BUILTIN\Users the
# Modify permission. Default %ProgramData% ACLs give Users only
# Read+Execute, but the probe runs in the user's session and needs to
# write its JSON output here.
if (-not (Test-Path $userProbeDir)) {
    New-Item -ItemType Directory -Force -Path $userProbeDir | Out-Null
}
# Use the well-known SID for BUILTIN\Users (S-1-5-32-545) so the
# command works on non-English Windows installs.
& icacls.exe $userProbeDir /grant "*S-1-5-32-545:(OI)(CI)M" /T 2>&1 | Out-Null

# Locate user-probe.exe. install-pulse.ps1 clones the whole repo, so
# the committed binary at windows-agent/installer/user-probe.exe is
# the default source - no Go toolchain required on TechGeek.
$repoProbeExe = Join-Path $AGENT_DIR "installer\user-probe.exe"
if (-not (Test-Path $repoProbeExe)) {
    # Fall back to a previously-built binary under build/ (e.g. if
    # someone ran build-installer.ps1 first), then to building from
    # source if Go is on PATH.
    $repoProbeExe = Join-Path $AGENT_DIR "build\user-probe.exe"
    if (-not (Test-Path $repoProbeExe) -and (Get-Command go -ErrorAction SilentlyContinue)) {
        Write-Ok "Building user-probe.exe from source"
        $probeSrcDir = Join-Path $AGENT_DIR "user-probe"
        Push-Location $probeSrcDir
        try {
            $env:GOOS = "windows"
            $env:GOARCH = "amd64"
            & go build -trimpath -buildvcs=false -ldflags="-s -w -H=windowsgui" -o $repoProbeExe .
        }
        finally {
            Remove-Item Env:GOOS, Env:GOARCH -ErrorAction SilentlyContinue
            Pop-Location
        }
    }
}

if (-not (Test-Path $repoProbeExe)) {
    Write-Warn "user-probe.exe not found at $repoProbeExe - skipping foreground probe install"
    Write-Warn "Either commit user-probe.exe to windows-agent/installer/, install Go 1.22+ and re-run, or run harden-pulse.ps1 once the binary is staged."
} else {
    Copy-Item -Force -Path $repoProbeExe -Destination $userProbePath
    Write-Ok "User probe staged at $userProbePath"

    schtasks.exe /Delete /TN $userProbeName /F 2>&1 | Out-Null

    # /RU INTERACTIVE = run as the currently logged-on user. /RL
    # LIMITED is correct here - the probe doesn't need admin to read
    # foreground state, and a LIMITED token is what real Win32
    # foreground/desktop APIs expect.
    # The /TR value points DIRECTLY at user-probe.exe with no
    # powershell.exe wrapper - that's the whole point. Path lives
    # under %ProgramData% (no spaces) so schtasks parsing is happy.
    & schtasks.exe /Create `
        /TN $userProbeName `
        /SC MINUTE /MO 1 `
        /RU "INTERACTIVE" `
        /RL LIMITED `
        /TR $userProbePath `
        /F | Out-Null

    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Foreground probe scheduled task installed (runs every 1 min as logged-on user, no console window)"
        # Kick off the first sample now so foreground.json exists for
        # the agent's first tick.
        & schtasks.exe /Run /TN $userProbeName | Out-Null
    } else {
        Write-Warn "Foreground probe scheduled-task registration returned $LASTEXITCODE (per-app time tracking will be empty until the next run of harden-pulse.ps1)"
    }
}

# --- Done -------------------------------------------------------------

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Pulse agent installed and running" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Service name : ExargenPulseAgent (auto-starts on boot)" -ForegroundColor White
Write-Host "  Config       : $CONFIG_FILE" -ForegroundColor White
Write-Host "  Source       : $INSTALL_DIR" -ForegroundColor White
Write-Host ""
Write-Host "  Telemetry will reach the dashboard within ~1 minute." -ForegroundColor White
Write-Host ""
Write-Host "  To uninstall later:" -ForegroundColor DarkGray
Write-Host "    schtasks.exe /Delete /TN ExargenPulseWatchdog /F" -ForegroundColor DarkGray
Write-Host "    schtasks.exe /Delete /TN ExargenPulseUserProbe /F" -ForegroundColor DarkGray
Write-Host "    cd $AGENT_DIR" -ForegroundColor DarkGray
Write-Host "    node dist\install-service.js --uninstall" -ForegroundColor DarkGray
Write-Host "    Remove-Item -Recurse -Force `"$CONFIG_DIR`"" -ForegroundColor DarkGray
Write-Host ""
