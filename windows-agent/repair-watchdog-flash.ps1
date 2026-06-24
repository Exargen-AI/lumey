<#
.SYNOPSIS
  Diagnose + repair the "PowerShell window flashes every 5 minutes"
  symptom on a machine running the Pulse agent.

.DESCRIPTION
  Root cause: an older install (or a network-flaky install that hit
  the legacy fallback) registered the `ExargenPulseWatchdog` scheduled
  task with a `powershell.exe -WindowStyle Hidden -File watchdog.ps1`
  action. The -WindowStyle Hidden flag is applied by PowerShell AFTER
  conhost.exe has already begun allocating a console window, so the
  user sees a brief black flash on their desktop every 5 minutes.

  The current agent uses a Go-compiled watchdog.exe (GUI subsystem,
  -H=windowsgui) that never allocates a console — no flash. This
  script swaps a flashing PowerShell watchdog task for the Go one if
  the binary is available, or removes the flashing task and relies on
  the SCM service-recovery (restart-on-crash) that the installer also
  configures.

  Safe to run repeatedly. Does nothing if the watchdog is already the
  non-flashing Go binary.

.NOTES
  Run from an elevated PowerShell:
    powershell -ExecutionPolicy Bypass -File repair-watchdog-flash.ps1

  Requires administrator (scheduled-task edits + service query).
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$taskName = 'ExargenPulseWatchdog'
$configDir = Join-Path $env:ProgramData 'ExargenPulse'
$watchdogExePath = Join-Path $configDir 'watchdog.exe'
$legacyScript = Join-Path $configDir 'watchdog.ps1'

function Write-Ok   ($m) { Write-Host "    [OK]   $m" -ForegroundColor Green }
function Write-Warn ($m) { Write-Host "    [WARN] $m" -ForegroundColor Yellow }
function Write-Info ($m) { Write-Host "    [..]   $m" -ForegroundColor Gray }

# Admin check — scheduled-task edits need elevation.
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warn 'This script must run as Administrator. Right-click PowerShell -> Run as administrator, then re-run.'
    exit 1
}

Write-Host ''
Write-Host '==> Pulse watchdog flash diagnostic' -ForegroundColor Cyan
Write-Host ''

# ── 1. Read the current task action ────────────────────────────────
$action = $null
try {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $action = ($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' ; '
} catch {
    Write-Info "No '$taskName' scheduled task found."
}

if (-not $action) {
    Write-Ok "Nothing to repair — no watchdog task is registered. (SCM recovery still protects the service.)"
    Write-Host ''
    exit 0
}

Write-Info "Current watchdog action: $action"

# ── 2. Decide: flashing (powershell) vs. clean (Go exe) ────────────
$isFlashing = $action -match 'powershell'

if (-not $isFlashing) {
    Write-Ok "Watchdog is already the non-flashing Go binary. No flash should occur. Nothing to do."
    Write-Host ''
    exit 0
}

Write-Warn "Found the FLASHING PowerShell watchdog — this is the every-5-minute conhost flash. Repairing…"

# ── 3. Remove the flashing task + its script ───────────────────────
schtasks.exe /Delete /TN $taskName /F 2>&1 | Out-Null
Write-Ok "Removed the flashing '$taskName' task."
if (Test-Path $legacyScript) {
    Remove-Item $legacyScript -Force -ErrorAction SilentlyContinue
    Write-Ok "Removed legacy watchdog.ps1."
}

# ── 4. Re-stage the Go watchdog.exe if we can find it ──────────────
$candidates = @(
    (Join-Path $env:ProgramFiles 'ExargenPulse\src\windows-agent\installer\watchdog.exe'),
    (Join-Path $env:ProgramFiles 'ExargenPulse\src\windows-agent\build\watchdog.exe'),
    $watchdogExePath
)
$src = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $src) {
    # Last resort — pull the committed binary from main.
    $url = 'https://raw.githubusercontent.com/Exargen-AI/exargen-command-center/main/windows-agent/installer/watchdog.exe'
    try {
        Invoke-WebRequest -Uri $url -OutFile $watchdogExePath -UseBasicParsing -ErrorAction Stop
        if ((Get-Item $watchdogExePath).Length -gt 100KB) { $src = $watchdogExePath }
    } catch {
        # fall through
    }
}

if ($src) {
    if ($src -ne $watchdogExePath) { Copy-Item -Force -Path $src -Destination $watchdogExePath }
    & schtasks.exe /Create `
        /TN $taskName `
        /SC MINUTE /MO 5 `
        /RU 'SYSTEM' `
        /RL HIGHEST `
        /TR $watchdogExePath `
        /F | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Re-registered the watchdog with the Go binary (no console flash). The 5-minute flash is gone."
    } else {
        Write-Warn "Could not re-register the Go watchdog (schtasks returned $LASTEXITCODE). The flashing task is still removed; SCM recovery protects the service."
    }
} else {
    Write-Warn "Could not find watchdog.exe to re-stage. The flashing task is REMOVED (flash stops now)."
    Write-Warn "SCM service recovery still restarts the agent on crash. Re-run the installer to restore the 5-min liveness watchdog."
}

Write-Host ''
Write-Ok 'Done. If you still see a flash, it is NOT this watchdog — check Task Scheduler for other tasks, or run this with -Verbose and send the output to your admin.'
Write-Host ''
