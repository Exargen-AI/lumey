<#
.SYNOPSIS
  Apply anti-tamper hardening to an already-installed Pulse agent.

.DESCRIPTION
  Idempotent helper that configures Windows Service Recovery on the
  ExargenPulseAgent service and registers (or refreshes) a SYSTEM-level
  Scheduled Task watchdog that re-starts the service if it goes down.

  Run this on existing installs that pre-date the hardening (PR23).
  For new installs, the same logic runs as Step 9 of install-pulse.ps1
  automatically - no need to invoke this separately.

.EXAMPLE
  # In admin PowerShell:
  iex (iwr "https://raw.githubusercontent.com/Exargen-AI/exargen-command-center/main/windows-agent/harden-pulse.ps1" -UseBasicParsing).Content

.NOTES
  Requires admin elevation. Acceptable failure modes:
    - Service recovery fails silently if `sc.exe` is not on PATH (it
      always is on Windows)
    - Watchdog task registration prints a warning if schtasks denies
      the SYSTEM principal (very unusual; happens on locked-down
      domains)
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Test-IsAdmin {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object System.Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
    Write-Host "[FAIL] Must be run as Administrator." -ForegroundColor Red
    exit 1
}

$svc = Get-Service -Name "ExargenPulseAgent" -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "[FAIL] ExargenPulseAgent service is not installed. Run install-pulse.ps1 first." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "==> Configuring service recovery" -ForegroundColor Cyan
& sc.exe failure "ExargenPulseAgent" reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
Write-Host "    [OK] restart-on-failure x3 (5s delays), reset daily" -ForegroundColor Green

Write-Host ""
Write-Host "==> Registering watchdog scheduled task (Wave 11 - Go binary, no flash)" -ForegroundColor Cyan

$watchdogName = "ExargenPulseWatchdog"

$configDir = Join-Path $env:ProgramData "ExargenPulse"
if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null
}

# Wave 11 — replace the PowerShell watchdog script with the Go binary
# from windows-agent/installer/watchdog.exe. The PowerShell variant
# fired conhost.exe every 5 minutes (brief black flash on the user's
# desktop) because -WindowStyle Hidden is processed by PowerShell
# AFTER conhost has already started allocating. Go binary compiled
# with -H=windowsgui has no console subsystem at all.
$watchdogExePath = Join-Path $configDir "watchdog.exe"

# Clean up the legacy watchdog.ps1 from a pre-Wave-11 install if it
# exists. Only the scheduled task triggers execution; the orphaned
# file is harmless but tidier this way.
$legacyWatchdogScriptPath = Join-Path $configDir "watchdog.ps1"
if (Test-Path $legacyWatchdogScriptPath) {
    Remove-Item $legacyWatchdogScriptPath -Force -ErrorAction SilentlyContinue
}

# Locate watchdog.exe, preferring in priority order (mirror of the
# user-probe staging logic below — keep the two in lock-step):
#   1. Committed binary at windows-agent/installer/watchdog.exe
#      (no toolchain required — same pattern as nssm.exe).
#   2. build/ output from build-installer.ps1.
#   3. Already-staged copy under %ProgramData%.
#   4. Local Go toolchain build from source (developer fallback).
#   5. Download the committed binary from main on github.com.
#
# 2026-05-30 — the PowerShell fallback that used to live here is GONE.
# It registered a `powershell.exe … -WindowStyle Hidden` scheduled
# task that flashed a conhost window on the user's desktop every 5
# minutes (the -WindowStyle Hidden flag is applied AFTER conhost has
# already started painting). That flash was a real, recurring UX
# regression. If we can't stage the Go binary, we now SKIP the
# scheduled-task watchdog entirely and rely on the SCM recovery
# (`sc.exe failure … restart`) configured above, which already
# restarts the service on crash. A weaker-but-silent watchdog beats
# a flashing one.
$watchdogCandidates = @(
    (Join-Path $env:ProgramFiles "ExargenPulse\src\windows-agent\installer\watchdog.exe"),
    (Join-Path $env:ProgramFiles "ExargenPulse\src\windows-agent\build\watchdog.exe"),
    $watchdogExePath
)
$watchdogSource = $watchdogCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

# Developer fallback — build from source if Go toolchain is on PATH.
if (-not $watchdogSource) {
    $watchdogSrc = Join-Path $env:ProgramFiles "ExargenPulse\src\windows-agent\watchdog"
    if ((Get-Command go -ErrorAction SilentlyContinue) -and (Test-Path $watchdogSrc)) {
        $buildOut = Join-Path $env:ProgramFiles "ExargenPulse\src\windows-agent\build\watchdog.exe"
        New-Item -ItemType Directory -Force -Path (Split-Path $buildOut -Parent) | Out-Null
        Push-Location $watchdogSrc
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

# Last resort — pull the committed binary from main on github.com.
if (-not $watchdogSource) {
    $watchdogUrl = "https://raw.githubusercontent.com/Exargen-AI/exargen-command-center/main/windows-agent/installer/watchdog.exe"
    try {
        Invoke-WebRequest -Uri $watchdogUrl -OutFile $watchdogExePath -UseBasicParsing -ErrorAction Stop
        if ((Get-Item $watchdogExePath).Length -gt 100KB) { $watchdogSource = $watchdogExePath }
    } catch {
        # Falls through to the skip path below.
    }
}

# Drop any existing task first so this script can be re-run to refresh.
# This is ALSO the repair path: a machine that previously got the
# flashing PowerShell watchdog has its task deleted here, and is
# either replaced with the .exe-based one below or left to SCM
# recovery — either way the flash stops on the next run.
schtasks.exe /Delete /TN $watchdogName /F 2>&1 | Out-Null

if ($watchdogSource) {
    if ($watchdogSource -ne $watchdogExePath) {
        Copy-Item -Force -Path $watchdogSource -Destination $watchdogExePath
    }
    & schtasks.exe /Create `
        /TN $watchdogName `
        /SC MINUTE /MO 5 `
        /RU "SYSTEM" `
        /RL HIGHEST `
        /TR $watchdogExePath `
        /F | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "    [OK] $watchdogName installed (Go binary, runs every 5 min as SYSTEM - no console flash)" -ForegroundColor Green
    } else {
        Write-Host "    [WARN] schtasks returned $LASTEXITCODE - SCM service recovery is still active" -ForegroundColor Yellow
    }
} else {
    Write-Host "    [WARN] watchdog.exe could not be staged — SKIPPING the scheduled-task watchdog." -ForegroundColor Yellow
    Write-Host "           SCM recovery (restart-on-crash x3) is still active, so the agent self-heals on crashes." -ForegroundColor DarkGray
    Write-Host "           Re-run this script once the binary is available to restore the 5-min liveness watchdog." -ForegroundColor DarkGray
}

# --- Foreground-app user-session probe (PR #32) ----------------------
#
# Needed on every install where the agent reports as SYSTEM (which is
# all of them). GetForegroundWindow from Session 0 returns NULL, so
# without this scheduled task per-app foreground time stays at 0
# forever.
#
# The probe is a Go-compiled .exe (GUI subsystem - no visible
# console flash). It runs as the logged-on user and writes
# foreground.json that the SYSTEM-context agent reads.
#
# Cleanup: if a previous install registered the legacy .ps1 probe,
# remove the old file + the now-stale task definition; we re-register
# below pointing at the .exe.

Write-Host ""
Write-Host "==> Registering foreground-app user-session probe (Go .exe)" -ForegroundColor Cyan

$userProbeName    = "ExargenPulseUserProbe"
$userProbeDir     = Join-Path $env:ProgramData "ExargenPulse\probe"
$userProbePath    = Join-Path $env:ProgramData "ExargenPulse\user-probe.exe"
$legacyProbePath  = Join-Path $env:ProgramData "ExargenPulse\user-probe.ps1"

if (-not (Test-Path $userProbeDir)) {
    New-Item -ItemType Directory -Force -Path $userProbeDir | Out-Null
}
# BUILTIN\Users Modify on the output folder - the probe runs as a
# non-admin user and needs to write foreground.json there.
& icacls.exe $userProbeDir /grant "*S-1-5-32-545:(OI)(CI)M" /T 2>&1 | Out-Null

# Locate user-probe.exe, preferring in priority order:
#   1. The committed binary at windows-agent/installer/user-probe.exe
#      (this is the "no toolchain required" path - same pattern we
#      use for nssm.exe)
#   2. The build output from build-installer.ps1
#   3. Local Go toolchain build from source (developer fallback)
#   4. Download the committed binary from main on github.com
#
# If all four fail, leave the task unregistered with a clear warning.
$candidates = @(
    (Join-Path $env:ProgramFiles "ExargenPulse\src\windows-agent\installer\user-probe.exe"),
    (Join-Path $env:ProgramFiles "ExargenPulse\src\windows-agent\build\user-probe.exe"),
    (Join-Path $env:ProgramFiles "ExargenPulse\user-probe.exe")
)
$probeSource = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

# Developer fallback - build from source if Go toolchain is on PATH.
if (-not $probeSource) {
    $repoSrc = Join-Path $env:ProgramFiles "ExargenPulse\src\windows-agent\user-probe"
    if ((Get-Command go -ErrorAction SilentlyContinue) -and (Test-Path $repoSrc)) {
        $buildOut = Join-Path $env:ProgramFiles "ExargenPulse\src\windows-agent\build\user-probe.exe"
        New-Item -ItemType Directory -Force -Path (Split-Path $buildOut -Parent) | Out-Null
        Push-Location $repoSrc
        try {
            $env:GOOS = "windows"; $env:GOARCH = "amd64"
            & go build -trimpath -buildvcs=false -ldflags="-s -w -H=windowsgui" -o $buildOut .
        }
        finally {
            Remove-Item Env:GOOS, Env:GOARCH -ErrorAction SilentlyContinue
            Pop-Location
        }
        if (Test-Path $buildOut) { $probeSource = $buildOut }
    }
}

# Last resort - pull the committed binary from main on github.com.
# This is how legacy installs (pre-PR-#32) upgrade themselves.
if (-not $probeSource) {
    $probeUrl = "https://raw.githubusercontent.com/Exargen-AI/exargen-command-center/main/windows-agent/installer/user-probe.exe"
    $downloadOut = Join-Path $env:TEMP "user-probe-download.exe"
    try {
        Invoke-WebRequest -Uri $probeUrl -UseBasicParsing -OutFile $downloadOut -ErrorAction Stop
        if ((Get-Item $downloadOut).Length -gt 100KB) {
            $probeSource = $downloadOut
            Write-Host "    [OK] Downloaded user-probe.exe from main" -ForegroundColor Green
        }
    } catch {
        # Will fall through to the warning below.
    }
}

if ($probeSource) {
    Copy-Item -Force -Path $probeSource -Destination $userProbePath
    Write-Host "    [OK] User probe staged from $probeSource" -ForegroundColor Green
} else {
    Write-Host "    [WARN] user-probe.exe not found. Per-app foreground time will stay at 0 until the probe is staged." -ForegroundColor Yellow
    $userProbePath = $null
}

# Remove any legacy .ps1 probe - we're moving to the .exe.
if (Test-Path $legacyProbePath) {
    Remove-Item -Force -Path $legacyProbePath -ErrorAction SilentlyContinue
    Write-Host "    [OK] Removed legacy user-probe.ps1" -ForegroundColor Green
}

if ($userProbePath -and (Test-Path $userProbePath)) {
    schtasks.exe /Delete /TN $userProbeName /F 2>&1 | Out-Null

    # /TR points directly at the .exe - no powershell.exe wrapper.
    # The Go binary is GUI-subsystem so it never paints a window.
    & schtasks.exe /Create `
        /TN $userProbeName `
        /SC MINUTE /MO 1 `
        /RU "INTERACTIVE" `
        /RL LIMITED `
        /TR $userProbePath `
        /F | Out-Null

    if ($LASTEXITCODE -eq 0) {
        Write-Host "    [OK] $userProbeName installed (runs every 1 min as logged-on user, no console flash)" -ForegroundColor Green
        & schtasks.exe /Run /TN $userProbeName 2>&1 | Out-Null
    } else {
        Write-Host "    [WARN] schtasks returned $LASTEXITCODE - foreground probe not registered" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Hardening applied. To remove:" -ForegroundColor White
Write-Host "  schtasks.exe /Delete /TN $watchdogName /F" -ForegroundColor DarkGray
Write-Host "  schtasks.exe /Delete /TN $userProbeName /F" -ForegroundColor DarkGray
Write-Host "  sc.exe failure `"ExargenPulseAgent`" reset= 0 actions= """ -ForegroundColor DarkGray
Write-Host ""
