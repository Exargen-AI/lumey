# Pulse Agent — service watchdog (Go)

Replaces the PowerShell watchdog (`watchdog.ps1`) the installer used to
register as a SYSTEM-scheduled task firing every 5 minutes.

## Why a separate binary?

Identical reasoning to `user-probe/`:

- **No console flash.** PowerShell is console-subsystem; every 5 min the
  user saw a brief black cmd-window pop. `watchdog.exe` is GUI-subsystem
  (`-H=windowsgui`), so Windows never allocates a console host.
- **~3ms cold start** vs. PowerShell's ~250ms (no JIT, no Add-Type).
- **signtool-friendly** — a compiled .exe accepts an Authenticode
  signature; a .ps1 doesn't really.

## What it does

1. Connects to the local SCM with `SC_MANAGER_CONNECT`.
2. Opens the `ExargenPulseAgent` service with
   `SERVICE_QUERY_STATUS | SERVICE_START`.
3. Reads current state via `QueryServiceStatus`.
4. If state is **stopped / stop-pending / paused**, calls
   `StartService`. Otherwise exits silently.

No console output, no exit-code semantics — schtasks doesn't display
results either way, and a transient failure is retried by the next
scheduled tick.

## Build

```bash
GOOS=windows GOARCH=amd64 \
  go build -trimpath -buildvcs=false \
    -ldflags="-s -w -H=windowsgui" \
    -o ../installer/watchdog.exe .
```

The flags:

- `-s -w` — strip debug/symbol tables (~30% smaller binary)
- `-trimpath` — strip local filesystem paths from the binary
- `-H=windowsgui` — GUI subsystem so no console host allocates

Wave 9 installer (`PulseAgent.iss`) registers this binary as the
`ExargenPulseWatchdog` scheduled task in place of the PowerShell script.
