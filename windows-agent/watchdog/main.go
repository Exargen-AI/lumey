//go:build windows

// Pulse Agent — service watchdog.
//
// Replaces the PowerShell watchdog (`watchdog.ps1`) registered by the
// installer as a SYSTEM-scheduled task that fires every 5 minutes.
//
// Why:
//
//   * The PowerShell watchdog runs `powershell.exe`, which is a
//     CONSOLE-subsystem binary. Every 5 minutes Windows briefly
//     allocates conhost.exe → black-window flash on the user's screen.
//     Same UX bug we already fixed for user-probe in PR #32.
//
//   * PowerShell has a ~250ms JIT warmup vs. the Go binary's ~3ms.
//
//   * .ps1 isn't signtool-friendly; the Go .exe is.
//
// Behaviour is identical to the PowerShell version: check the status
// of `ExargenPulseAgent` via the Windows Service Control Manager;
// start it if not running. Exit silently on success or failure —
// schtasks won't display the result either way, and stderr is
// swallowed.
//
// Build:
//   GOOS=windows GOARCH=amd64 \
//     go build -trimpath -buildvcs=false \
//       -ldflags="-s -w -H=windowsgui" \
//       -o ../installer/watchdog.exe .
//
// (-s -w strips symbols, -trimpath strips local paths,
// -H=windowsgui selects the GUI subsystem so no console window
// allocates.)

package main

import (
	"syscall"
	"unsafe"
)

// SC_HANDLE — opaque pointer the SCM returns. We marshal as uintptr
// because syscall.NewLazyDLL doesn't track types.
type schandle = uintptr

// SCM access rights + service access rights (from winsvc.h).
const (
	scManagerConnect      = 0x0001
	serviceQueryStatus    = 0x0004
	serviceStart          = 0x0010
)

// SERVICE_STATUS struct layout per winsvc.h. Field order matters —
// CGo / syscall reads it as a packed C struct.
type serviceStatus struct {
	ServiceType             uint32
	CurrentState            uint32
	ControlsAccepted        uint32
	Win32ExitCode           uint32
	ServiceSpecificExitCode uint32
	CheckPoint              uint32
	WaitHint                uint32
}

const (
	// Service current states.
	serviceStopped         = 0x00000001
	serviceStartPending    = 0x00000002
	serviceStopPending     = 0x00000003
	serviceRunning         = 0x00000004
	serviceContinuePending = 0x00000005
	servicePausePending    = 0x00000006
	servicePaused          = 0x00000007
)

const serviceName = "ExargenPulseAgent"

var (
	advapi32 = syscall.NewLazyDLL("advapi32.dll")

	procOpenSCManager     = advapi32.NewProc("OpenSCManagerW")
	procOpenService       = advapi32.NewProc("OpenServiceW")
	procCloseServiceHandle = advapi32.NewProc("CloseServiceHandle")
	procQueryServiceStatus = advapi32.NewProc("QueryServiceStatus")
	procStartService       = advapi32.NewProc("StartServiceW")
)

func openSCManager(access uint32) (schandle, error) {
	// First two args (machineName, databaseName) are nil = local
	// machine, ServicesActive DB.
	ret, _, err := procOpenSCManager.Call(0, 0, uintptr(access))
	if ret == 0 {
		return 0, err
	}
	return schandle(ret), nil
}

func openService(scm schandle, name string, access uint32) (schandle, error) {
	nameW, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return 0, err
	}
	ret, _, err := procOpenService.Call(
		uintptr(scm),
		uintptr(unsafe.Pointer(nameW)),
		uintptr(access),
	)
	if ret == 0 {
		return 0, err
	}
	return schandle(ret), nil
}

func closeHandle(h schandle) {
	if h == 0 {
		return
	}
	procCloseServiceHandle.Call(uintptr(h))
}

func queryStatus(svc schandle) (uint32, bool) {
	var s serviceStatus
	ret, _, _ := procQueryServiceStatus.Call(
		uintptr(svc),
		uintptr(unsafe.Pointer(&s)),
	)
	if ret == 0 {
		return 0, false
	}
	return s.CurrentState, true
}

func startService(svc schandle) bool {
	// numServiceArgs=0, serviceArgVectors=nil.
	ret, _, _ := procStartService.Call(uintptr(svc), 0, 0)
	return ret != 0
}

func main() {
	// 1. Connect to the SCM with the minimum rights we need.
	scm, err := openSCManager(scManagerConnect)
	if err != nil || scm == 0 {
		return // SCM unreachable — nothing to do, can't even log
	}
	defer closeHandle(scm)

	// 2. Open the service with query + start rights.
	svc, err := openService(scm, serviceName, serviceQueryStatus|serviceStart)
	if err != nil || svc == 0 {
		return // service doesn't exist (uninstalled mid-watchdog-tick)
	}
	defer closeHandle(svc)

	// 3. Read current state. If already running / about to run, exit.
	state, ok := queryStatus(svc)
	if !ok {
		return
	}
	if state == serviceRunning ||
		state == serviceStartPending ||
		state == serviceContinuePending {
		return
	}

	// 4. Try to start it. Swallow the result — schtasks doesn't
	//    display anything either way, and on a transient failure the
	//    next tick (5 min later) will retry.
	_ = startService(svc)
}
