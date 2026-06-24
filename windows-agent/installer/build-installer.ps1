<#
.SYNOPSIS
  Build PulseAgentInstaller-X.Y.Z.exe end-to-end on a Windows host.

.DESCRIPTION
  One-command pipeline that produces the signed (or unsigned) installer
  artifact. Steps:

    1. npm install + build (shared + windows-agent)
    2. Bundle the agent into PulseAgent.exe using one of:
         - Node SEA (Single Executable Application) - official, Node 20+
         - pkg                                       - legacy fallback
    3. Run Inno Setup Compiler against installer/PulseAgent.iss
    4. (Optional) Code-sign the binaries with signtool.exe

  Run from windows-agent/installer/ as Administrator.

.PARAMETER UsePkg
  Use the deprecated `pkg` tool instead of Node SEA. Slower to set up
  but pre-builds binaries are cached. Default is SEA.

.PARAMETER SignWithThumbprint
  Code-signing certificate thumbprint. If omitted, the installer is
  produced UNSIGNED - Windows SmartScreen will warn end users on
  first run. Strongly recommend signing for production.

.PARAMETER InnoSetupPath
  Override the default Inno Setup compiler location.

.EXAMPLE
  # Default (Node SEA, unsigned)
  .\build-installer.ps1

.EXAMPLE
  # Signed with your code-signing cert
  .\build-installer.ps1 -SignWithThumbprint "1234ABCD..."

.NOTES
  Prerequisites (one-time on the Windows host):
    - Node.js 20 LTS (https://nodejs.org/)
    - Inno Setup 6 (https://jrsoftware.org/isinfo.php)
    - Optional: a code-signing cert installed in CurrentUser\My or
      LocalMachine\My, with thumbprint passed via -SignWithThumbprint
#>

[CmdletBinding()]
param(
    [switch]$UsePkg,
    [string]$SignWithThumbprint,
    [string]$InnoSetupPath = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
)

$ErrorActionPreference = "Stop"

function Step([string]$Msg) { Write-Host "`n==> $Msg" -ForegroundColor Cyan }
function Ok([string]$Msg)   { Write-Host "    [OK] $Msg" -ForegroundColor Green }
function Fail([string]$Msg) { Write-Host "    [FAIL] $Msg" -ForegroundColor Red; exit 1 }

# Resolve paths relative to the installer script's location.
$InstallerDir = $PSScriptRoot
$AgentRoot    = Split-Path $InstallerDir -Parent
$RepoRoot     = Split-Path $AgentRoot -Parent
$BuildDir     = Join-Path $AgentRoot "build"

if (-not (Test-Path $BuildDir)) { New-Item -ItemType Directory -Path $BuildDir | Out-Null }

# --- Step 1: npm install + build -------------------------------------

Step "Installing + building shared and windows-agent"
Push-Location $RepoRoot
try {
    & npm install --no-audit --no-fund --loglevel=error
    & npm run build --workspace=shared
}
finally {
    Pop-Location
}
Push-Location $AgentRoot
try {
    & npm install --no-audit --no-fund --loglevel=error
    & npm run build
}
finally {
    Pop-Location
}
Ok "dist\\index.js ready"

# --- Step 2: Bundle into PulseAgent.exe ------------------------------

$ExePath = Join-Path $BuildDir "PulseAgent.exe"

if ($UsePkg) {
    Step "Bundling via pkg (legacy)"
    Push-Location $AgentRoot
    try {
        & npx pkg . --targets node20-win-x64 --output $ExePath
    }
    finally { Pop-Location }
    if (-not (Test-Path $ExePath)) { Fail "pkg did not produce $ExePath" }
    Ok "$ExePath"
}
else {
    # --- Node SEA bundling -----------------------------------------
    # 1. Bundle dist + dependencies into a single CJS file with esbuild
    # 2. Generate sea-config.json + sea-prep.blob
    # 3. Copy node.exe + inject the blob with postject
    Step "Bundling via Node SEA"

    $bundlePath = Join-Path $BuildDir "agent-bundle.cjs"
    Push-Location $AgentRoot
    try {
        & npx --yes esbuild dist/index.js `
            --bundle `
            --platform=node `
            --target=node20 `
            --outfile=$bundlePath `
            --external:node-windows `
            --log-level=warning
    }
    finally { Pop-Location }
    if (-not (Test-Path $bundlePath)) { Fail "esbuild bundle missing" }
    Ok "esbuild bundle: $bundlePath"

    $seaConfig = @{
        main          = $bundlePath
        output        = (Join-Path $BuildDir "sea-prep.blob")
        disableExperimentalSEAWarning = $true
    } | ConvertTo-Json -Depth 3
    $seaConfigPath = Join-Path $BuildDir "sea-config.json"
    Set-Content -Path $seaConfigPath -Value $seaConfig -Encoding UTF8

    & node --experimental-sea-config $seaConfigPath
    if (-not (Test-Path (Join-Path $BuildDir "sea-prep.blob"))) {
        Fail "Node SEA blob generation failed"
    }

    # Copy node.exe - strip its embedded signature with signtool
    # (postject can't inject into signed binaries).
    $nodeExe = (Get-Command node).Source
    Copy-Item -Path $nodeExe -Destination $ExePath -Force

    & npx --yes postject $ExePath NODE_SEA_BLOB (Join-Path $BuildDir "sea-prep.blob") `
        --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

    if (-not (Test-Path $ExePath)) { Fail "Node SEA produced no exe" }
    Ok "$ExePath"
}

# --- Step 2b: Build user-probe.exe (Go, GUI subsystem) ---------------
#
# Replaces the previous PowerShell-based user-probe.ps1. The Go
# binary is compiled with -H=windowsgui so Windows never allocates a
# console host - no visible cmd-window flash on the 60-second
# scheduled-task cadence. AOT + no JIT means ~3 ms cold-start vs
# PowerShell's ~250 ms.
#
# Why a separate Go module: the agent is a Node project, so we can't
# share the build chain. We treat the probe as a tiny sibling binary
# the installer ships alongside PulseAgent.exe.

Step "Staging user-probe.exe + watchdog.exe (Go, GUI subsystem)"
$ProbeSrcDir    = Join-Path $AgentRoot "user-probe"
$ProbeExe       = Join-Path $InstallerDir "user-probe.exe"
$WatchdogSrcDir = Join-Path $AgentRoot "watchdog"
$WatchdogExe    = Join-Path $InstallerDir "watchdog.exe"

# Helper to build a Go GUI-subsystem binary with the same flag set we
# use for both the foreground probe (Wave 5) and the service watchdog
# (Wave 9).
function Build-GoGuiBinary([string]$SrcDir, [string]$OutExe, [string]$Label) {
    Push-Location $SrcDir
    try {
        $env:GOOS   = "windows"
        $env:GOARCH = "amd64"
        & go build -trimpath -buildvcs=false -ldflags="-s -w -H=windowsgui" -o $OutExe .
        if ($LASTEXITCODE -ne 0) { Fail "go build failed for $Label" }
    }
    finally {
        Remove-Item Env:GOOS, Env:GOARCH -ErrorAction SilentlyContinue
        Pop-Location
    }
}

if (Get-Command go -ErrorAction SilentlyContinue) {
    Build-GoGuiBinary $ProbeSrcDir $ProbeExe "user-probe"
    Ok "Built fresh user-probe.exe"
    Build-GoGuiBinary $WatchdogSrcDir $WatchdogExe "watchdog"
    Ok "Built fresh watchdog.exe"
}
elseif ((Test-Path $ProbeExe) -and (Test-Path $WatchdogExe)) {
    Ok "Using committed user-probe.exe + watchdog.exe (no Go toolchain on PATH - fine for unsigned local builds)"
}
else {
    Fail "user-probe.exe or watchdog.exe missing and Go toolchain not on PATH. Install Go 1.22+ (https://go.dev/dl)."
}

# --- Step 3: Inno Setup ----------------------------------------------

Step "Compiling installer with Inno Setup"
if (-not (Test-Path $InnoSetupPath)) {
    Fail "Inno Setup compiler not found at $InnoSetupPath. Install from https://jrsoftware.org/isinfo.php or pass -InnoSetupPath."
}
& $InnoSetupPath (Join-Path $InstallerDir "PulseAgent.iss")
if ($LASTEXITCODE -ne 0) { Fail "Inno Setup compile failed (exit $LASTEXITCODE)" }

$installerExe = Get-ChildItem -Path $BuildDir -Filter "PulseAgentInstaller-*.exe" | Select-Object -Last 1
if (-not $installerExe) { Fail "No PulseAgentInstaller-*.exe produced" }
Ok "Installer: $($installerExe.FullName)"

# --- Step 4 (optional): Code-sign ------------------------------------

if ($SignWithThumbprint) {
    Step "Signing binaries with thumbprint $SignWithThumbprint"
    $signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if (-not $signtool) {
        Fail "signtool.exe not found on PATH. Install the Windows 10 SDK or VS Build Tools."
    }
    foreach ($target in @($ExePath, $ProbeExe, $WatchdogExe, $installerExe.FullName)) {
        & signtool.exe sign /sha1 $SignWithThumbprint /tr "http://timestamp.digicert.com" /td sha256 /fd sha256 $target
        if ($LASTEXITCODE -ne 0) { Fail "signtool failed on $target" }
        Ok "Signed: $target"
    }
}
else {
    Write-Host "    [WARN] Skipping code signing (no -SignWithThumbprint). SmartScreen will warn end users." -ForegroundColor Yellow
}

# --- Done ------------------------------------------------------------

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Build complete" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Installer: $($installerExe.FullName)" -ForegroundColor White
Write-Host ""
Write-Host "  Distribute this single file to employees. The installer" -ForegroundColor White
Write-Host "  prompts for the enrollment token + server URL on launch." -ForegroundColor White
Write-Host ""
