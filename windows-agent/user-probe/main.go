//go:build windows

// Pulse Agent — user-session foreground-window probe.
//
// Replaces user-probe.ps1 (PR #169). Why:
//
//   * PowerShell.exe is a CONSOLE-subsystem binary. Every invocation
//     spawns conhost.exe, which briefly paints a black window before
//     -WindowStyle Hidden can suppress the script's own window. On
//     a 60-second cadence that visible flash is the most-complained-
//     about UX issue with the agent.
//
//   * PowerShell has a JIT warmup cost (~150 ms for Add-Type) which
//     dominates the actual sampling work. Multiplied by 1440 ticks/day
//     that's measurable CPU on shared boxes.
//
//   * .ps1 is interpreted at runtime — code-signing it isn't really
//     a thing. A compiled .exe is signtool-friendly, which matters
//     when AV/EDR products are profiling the agent.
//
// This binary fixes all three:
//
//   * Compiled with `-H windowsgui` (GUI subsystem) so Windows never
//     allocates a console host. Truly invisible — same approach used
//     by Defender, Sysmon, CrowdStrike Falcon, Slack helper, Teams
//     update agent, etc.
//   * AOT-compiled; cold start is ~3 ms vs. PowerShell's ~250 ms.
//   * Standalone .exe (~2 MB), no runtime dependencies, signtool-
//     friendly.
//
// Behaviour is identical to the PowerShell version: read the
// foreground window of the current session via three user32.dll
// calls, resolve the owning process name + FileDescription, and
// write a small JSON document atomically to
// %ProgramData%\ExargenPulse\probe\foreground.json. The Pulse agent
// (running as LocalSystem) reads that JSON on its 30-second tick.
//
// Build:
//   GOOS=windows GOARCH=amd64 \
//     go build -trimpath -buildvcs=false \
//       -ldflags="-s -w -H=windowsgui" \
//       -o ../build/user-probe.exe .
//
// (`-s -w` strips debug/symbol tables, `-trimpath` strips local
// paths, `-H=windowsgui` selects the GUI subsystem so no console
// window allocates.)

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

// payload is the on-disk JSON contract with the agent. Field names
// match collectors.ts:ProbeFileShape exactly — do not rename without
// updating the agent.
type payload struct {
	CapturedAt     string  `json:"capturedAt"`
	SessionID      uint32  `json:"sessionId"`
	UserName       string  `json:"userName"`
	HasForeground  bool    `json:"hasForeground"`
	AppName        string  `json:"appName"`
	AppDisplayName *string `json:"appDisplayName"`
	WindowTitle    string  `json:"windowTitle"`
}

// outputPath is hard-coded to match the install contract. Changing
// this without also updating PulseAgent.iss / install-pulse.ps1 /
// collectors.ts will silently break per-app foreground tracking, so
// don't.
const outputPath = `C:\ProgramData\ExargenPulse\probe\foreground.json`

// ─── Win32 surface ────────────────────────────────────────────────

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	psapi    = syscall.NewLazyDLL("psapi.dll")
	version  = syscall.NewLazyDLL("version.dll")
	advapi32 = syscall.NewLazyDLL("advapi32.dll")

	procGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	procGetWindowTextLengthW     = user32.NewProc("GetWindowTextLengthW")
	procGetWindowTextW           = user32.NewProc("GetWindowTextW")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")

	procOpenProcess               = kernel32.NewProc("OpenProcess")
	procCloseHandle               = kernel32.NewProc("CloseHandle")
	procQueryFullProcessImageName = kernel32.NewProc("QueryFullProcessImageNameW")
	procProcessIdToSessionId      = kernel32.NewProc("ProcessIdToSessionId")
	procGetCurrentProcessId       = kernel32.NewProc("GetCurrentProcessId")

	procGetFileVersionInfoSize = version.NewProc("GetFileVersionInfoSizeW")
	procGetFileVersionInfo     = version.NewProc("GetFileVersionInfoW")
	procVerQueryValue          = version.NewProc("VerQueryValueW")

	procGetUserNameEx = advapi32.NewProc("GetUserNameExW")
)

// Access rights for OpenProcess. We use the LIMITED variant so we
// can read paths from protected processes (Defender, services) too —
// the full PROCESS_QUERY_INFORMATION would fail on them.
const (
	processQueryLimitedInformation = 0x1000
)

// NameSamCompatible (= 2) — corresponds to "DOMAIN\user". We strip
// the domain prefix in userName().
const nameSamCompatible = 2

// ─── Capture ──────────────────────────────────────────────────────

func main() {
	p := payload{
		CapturedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000000000Z"),
		SessionID:  currentSessionID(),
		UserName:   currentUserName(),
	}

	hwnd, _, _ := procGetForegroundWindow.Call()
	if hwnd != 0 {
		p.HasForeground = true
		p.WindowTitle = windowText(syscall.Handle(hwnd))

		pid := windowProcessID(syscall.Handle(hwnd))
		if pid != 0 {
			imgPath := processImagePath(pid)
			if imgPath != "" {
				p.AppName = strings.ToLower(filepath.Base(imgPath))
				if desc := fileDescription(imgPath); desc != "" {
					p.AppDisplayName = &desc
				}
			}
		}
	}

	writeAtomic(p)
}

// writeAtomic stages JSON to <output>.tmp then renames in place so a
// concurrent reader (the agent) never sees a half-written document.
// Errors are swallowed; the agent treats a stale or missing
// foreground.json as "no foreground" — we never want this probe to
// pop a dialog or block.
func writeAtomic(p payload) {
	_ = os.MkdirAll(filepath.Dir(outputPath), 0o755)

	body, err := json.Marshal(p)
	if err != nil {
		return
	}

	tmp := outputPath + ".tmp"
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		return
	}
	// os.Rename on Windows is implemented via MoveFileEx with
	// MOVEFILE_REPLACE_EXISTING — atomic on the same volume.
	_ = os.Rename(tmp, outputPath)
}

// ─── Helpers ──────────────────────────────────────────────────────

// currentSessionID returns the Terminal Services session ID of the
// process — non-zero means we're running in a real user session
// (which is the whole point of this probe). When the agent reads
// foreground.json it sanity-checks that sessionId != 0; anything else
// would be a misconfigured scheduled task.
func currentSessionID() uint32 {
	pid, _, _ := procGetCurrentProcessId.Call()
	var sid uint32
	procProcessIdToSessionId.Call(pid, uintptr(unsafe.Pointer(&sid)))
	return sid
}

// currentUserName returns the bare Windows account name (no domain
// prefix). We use NameSamCompatible because it works for both
// domain-joined and local accounts; alternatives like
// NameUserPrincipal need AD which not every TechGeek box has.
func currentUserName() string {
	var size uint32 = 256
	buf := make([]uint16, size)
	ret, _, _ := procGetUserNameEx.Call(
		uintptr(nameSamCompatible),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&size)),
	)
	if ret == 0 {
		return ""
	}
	full := syscall.UTF16ToString(buf[:size])
	if idx := strings.LastIndex(full, `\`); idx >= 0 {
		return full[idx+1:]
	}
	return full
}

func windowText(hwnd syscall.Handle) string {
	length, _, _ := procGetWindowTextLengthW.Call(uintptr(hwnd))
	if length == 0 {
		return ""
	}
	buf := make([]uint16, length+1)
	procGetWindowTextW.Call(
		uintptr(hwnd),
		uintptr(unsafe.Pointer(&buf[0])),
		length+1,
	)
	return syscall.UTF16ToString(buf)
}

func windowProcessID(hwnd syscall.Handle) uint32 {
	var pid uint32
	procGetWindowThreadProcessId.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&pid)))
	return pid
}

// processImagePath opens the target PID with limited rights and asks
// the kernel for the on-disk image path. Limited rights are required
// because the foreground process may be a high-integrity / protected
// process (rare for user-facing apps but possible — e.g. login
// dialogs from Credential Manager).
func processImagePath(pid uint32) string {
	handle, _, _ := procOpenProcess.Call(
		uintptr(processQueryLimitedInformation),
		0,
		uintptr(pid),
	)
	if handle == 0 {
		return ""
	}
	defer procCloseHandle.Call(handle)

	var size uint32 = 1024
	buf := make([]uint16, size)
	ret, _, _ := procQueryFullProcessImageName.Call(
		handle,
		0,
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&size)),
	)
	if ret == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf[:size])
}

// fileDescription pulls the FileDescription field out of the
// VS_FIXEDFILEINFO / StringFileInfo block of a PE binary. The
// version.dll dance is uglier than the PowerShell equivalent but
// gets us the same friendly name ("Google Chrome" vs "chrome.exe").
//
// Returns empty string if the binary has no version resource (which
// is uncommon — even portable .exes ship one).
func fileDescription(imagePath string) string {
	pathW, err := syscall.UTF16PtrFromString(imagePath)
	if err != nil {
		return ""
	}
	var dummy uint32
	size, _, _ := procGetFileVersionInfoSize.Call(
		uintptr(unsafe.Pointer(pathW)),
		uintptr(unsafe.Pointer(&dummy)),
	)
	if size == 0 {
		return ""
	}

	data := make([]byte, size)
	ret, _, _ := procGetFileVersionInfo.Call(
		uintptr(unsafe.Pointer(pathW)),
		0,
		size,
		uintptr(unsafe.Pointer(&data[0])),
	)
	if ret == 0 {
		return ""
	}

	// Probe the \VarFileInfo\Translation block first to find the
	// language/codepage pair used by this binary. Trying a hard-coded
	// 040904B0 works for ~95% of US English binaries but fails on
	// localised Office, Slack, etc. — better to read it.
	type translation struct {
		Language uint16
		CodePage uint16
	}
	var transPtr unsafe.Pointer
	var transLen uint32
	transKey, _ := syscall.UTF16PtrFromString(`\VarFileInfo\Translation`)
	ret, _, _ = procVerQueryValue.Call(
		uintptr(unsafe.Pointer(&data[0])),
		uintptr(unsafe.Pointer(transKey)),
		uintptr(unsafe.Pointer(&transPtr)),
		uintptr(unsafe.Pointer(&transLen)),
	)
	if ret == 0 || transLen < uint32(unsafe.Sizeof(translation{})) {
		return ""
	}
	t := *(*translation)(transPtr)

	subKey := fmt.Sprintf(`\StringFileInfo\%04x%04x\FileDescription`, t.Language, t.CodePage)
	subKeyW, _ := syscall.UTF16PtrFromString(subKey)

	var valPtr unsafe.Pointer
	var valLen uint32
	ret, _, _ = procVerQueryValue.Call(
		uintptr(unsafe.Pointer(&data[0])),
		uintptr(unsafe.Pointer(subKeyW)),
		uintptr(unsafe.Pointer(&valPtr)),
		uintptr(unsafe.Pointer(&valLen)),
	)
	if ret == 0 || valLen == 0 {
		return ""
	}

	// valPtr is a UTF-16 C string of length valLen *characters*.
	// Slice the raw memory and convert.
	chars := (*[1 << 16]uint16)(valPtr)[:valLen:valLen]
	return strings.TrimSpace(syscall.UTF16ToString(chars))
}
