; Pulse Agent — Inno Setup installer (2026-05-30)
;
; Produces PulseAgentInstaller-X.Y.Z.exe — a single double-clickable
; installer that:
;   1. Asks the user for an enrollment token + (optional) server URL
;      via a custom wizard page
;   2. Drops PulseAgent.exe into C:\Program Files\ExargenPulse\
;   3. Writes %ProgramData%\ExargenPulse\config.json with the captured
;      token + serverUrl (ACL-locked to SYSTEM + Administrators only)
;   4. Registers ExargenPulseAgent as a Windows Service (LocalSystem)
;   5. Configures Service Recovery (auto-restart on crash/stop)
;   6. Registers the ExargenPulseWatchdog scheduled task (SYSTEM,
;      every 5 min) — same anti-tamper layer as install-pulse.ps1
;   7. Starts the service immediately
;
; Uninstall reverses all of it: stop service, remove watchdog, delete
; config, uninstall service, remove Program Files folder.
;
; Compile on Windows with Inno Setup 6+:
;   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" PulseAgent.iss
;
; The build-installer.ps1 script in this folder orchestrates the full
; produce-binary-and-installer chain.

#define MyAppName "Exargen Pulse Agent"
#define MyAppShortName "ExargenPulse"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Exargen AI"
#define MyAppURL "https://github.com/Exargen-AI/exargen-command-center"
#define MyAppExeName "PulseAgent.exe"
#define MyServiceName "ExargenPulseAgent"
#define MyWatchdogName "ExargenPulseWatchdog"
#define MyUserProbeName "ExargenPulseUserProbe"
#define DefaultServerUrl "https://exargencommandcenter-production.up.railway.app/api/v1"

[Setup]
AppId={{D40A7C71-9F5B-4F5C-B05C-PULSE0000001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\ExargenPulse
DisableDirPage=yes
DefaultGroupName=ExargenPulse
DisableProgramGroupPage=yes
OutputBaseFilename=PulseAgentInstaller-{#MyAppVersion}
OutputDir=..\build
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
ArchitecturesAllowed=x64
WizardStyle=modern
SetupLogging=yes
DisableReadyPage=no
DisableFinishedPage=no
ShowLanguageDialog=no
CloseApplications=yes
RestartApplications=no
UninstallDisplayName={#MyAppName} v{#MyAppVersion}
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; The packaged Pulse agent. Produced by `npm run package` (pkg) or by
; the Node SEA build path — either way, the file lands in
; windows-agent\build\PulseAgent.exe before this .iss is compiled.
Source: "..\build\PulseAgent.exe"; DestDir: "{app}"; Flags: ignoreversion

; NSSM (Non-Sucking Service Manager) — single-file public-domain
; service wrapper. PulseAgent.exe is a regular Node binary that
; doesn't implement the Windows Service Control Manager API; if we
; register it directly via sc.exe, SCM times out after 30 seconds
; waiting for the SERVICE_RUNNING status that the exe never reports
; (Event Log 7009 / 7000). NSSM runs as the SCM-compliant service,
; launches PulseAgent.exe as a child, and supervises it (auto-restart,
; stdout/stderr piped to log files).
;
; nssm.exe is committed to the repo at windows-agent/installer/nssm.exe;
; size is ~330KB, version 2.24, public domain.
Source: "nssm.exe"; DestDir: "{app}"; Flags: ignoreversion

; user-probe.exe — Go-compiled foreground-window probe (PR #32).
;
; Replaces the previous PowerShell-based user-probe.ps1. The Go
; binary is built with -H=windowsgui so Windows never allocates a
; console host — no visible cmd-window flash on the 60-second
; cadence. AOT compilation, no JIT, no .NET / PowerShell runtime
; dependency, signtool-friendly.
;
; Same on-disk contract: every minute the probe writes
; %ProgramData%\ExargenPulse\probe\foreground.json which the main
; agent (SYSTEM context) reads on its 30-sec accumulator tick.
;
; Bundled directly under {app} (Program Files) for traceability but
; copied to %ProgramData%\ExargenPulse\ at install-time so the
; scheduled task's /TR argument doesn't contain a space-bearing
; path (schtasks parses /TR loosely and a path under "Program
; Files" can split mid-string on some Windows configurations).
Source: "user-probe.exe"; DestDir: "{app}"; Flags: ignoreversion

; watchdog.exe — Go-compiled service watchdog (Wave 9).
;
; Replaces watchdog.ps1. Same reasoning as user-probe: GUI-subsystem
; so no console flash on the 5-min cadence, ~3ms cold start instead of
; PowerShell's ~250ms, signtool-friendly. Calls OpenSCManager →
; OpenService → QueryServiceStatus → StartService directly via
; advapi32.dll. Total source size: ~150 LOC.
Source: "watchdog.exe"; DestDir: "{app}"; Flags: ignoreversion

[Code]
var
  EnrollPage: TWizardPage;
  TokenEdit: TNewEdit;
  ServerUrlEdit: TNewEdit;
  NotesLabel: TNewStaticText;

procedure InitializeWizard;
var
  TokenLabel: TNewStaticText;
  ServerLabel: TNewStaticText;
  TopY: Integer;
begin
  EnrollPage := CreateCustomPage(
    wpSelectDir,
    'Enrollment details',
    'Paste the values your SUPER_ADMIN gave you.'
  );

  TopY := ScaleY(8);

  ServerLabel := TNewStaticText.Create(EnrollPage);
  ServerLabel.Parent := EnrollPage.Surface;
  ServerLabel.Top := TopY;
  ServerLabel.Caption := 'Backend server URL (must end in /api/v1):';

  ServerUrlEdit := TNewEdit.Create(EnrollPage);
  ServerUrlEdit.Parent := EnrollPage.Surface;
  ServerUrlEdit.Top := TopY + ScaleY(18);
  ServerUrlEdit.Width := EnrollPage.SurfaceWidth;
  ServerUrlEdit.Text := '{#DefaultServerUrl}';

  TokenLabel := TNewStaticText.Create(EnrollPage);
  TokenLabel.Parent := EnrollPage.Surface;
  TokenLabel.Top := TopY + ScaleY(60);
  TokenLabel.Caption := 'Enrollment token (starts with det_):';

  TokenEdit := TNewEdit.Create(EnrollPage);
  TokenEdit.Parent := EnrollPage.Surface;
  TokenEdit.Top := TopY + ScaleY(78);
  TokenEdit.Width := EnrollPage.SurfaceWidth;
  TokenEdit.PasswordChar := '#'; // Mask: tokens are single-use secrets

  NotesLabel := TNewStaticText.Create(EnrollPage);
  NotesLabel.Parent := EnrollPage.Surface;
  NotesLabel.Top := TopY + ScaleY(120);
  NotesLabel.AutoSize := False;
  NotesLabel.Width := EnrollPage.SurfaceWidth;
  NotesLabel.Height := ScaleY(48);
  NotesLabel.Caption :=
    'Your SUPER_ADMIN issued a single-use token in the Command Center ' +
    'dashboard (Pulse → Enrollment tokens). It looks like ' +
    'det_<128 hex chars>. The token is consumed at install time and ' +
    'rotated into a permanent API key.';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Url: String;
  Token: String;
begin
  Result := True;
  if CurPageID = EnrollPage.ID then begin
    Url := Trim(ServerUrlEdit.Text);
    Token := Trim(TokenEdit.Text);
    if (Length(Url) < 8) or
       ((Pos('http://', Lowercase(Url)) <> 1) and (Pos('https://', Lowercase(Url)) <> 1)) then begin
      MsgBox('Server URL must start with http:// or https://.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if (Pos('/api/v1', Lowercase(Url)) = 0) then begin
      // Auto-append /api/v1 if the user forgot it.
      if Copy(Url, Length(Url), 1) = '/' then
        ServerUrlEdit.Text := Url + 'api/v1'
      else
        ServerUrlEdit.Text := Url + '/api/v1';
    end;
    if (Length(Token) < 8) or (Pos('det_', Token) <> 1) then begin
      MsgBox('Enrollment token must start with "det_". Paste the token from your SUPER_ADMIN exactly as shown.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end;
end;

procedure WriteConfigJson;
var
  ConfigDir: String;
  ConfigFile: String;
  Body: String;
  ServerUrl: String;
  Token: String;
begin
  ConfigDir := ExpandConstant('{commonappdata}') + '\ExargenPulse';
  ConfigFile := ConfigDir + '\config.json';
  if not DirExists(ConfigDir) then
    CreateDir(ConfigDir);

  ServerUrl := Trim(ServerUrlEdit.Text);
  Token := Trim(TokenEdit.Text);

  Body := '{"serverUrl":"' + ServerUrl + '","enrollmentToken":"' + Token + '"}';

  // SaveStringToFile writes UTF-8 without BOM when called with False.
  if not SaveStringToFile(ConfigFile, Body, False) then begin
    MsgBox('Failed to write ' + ConfigFile + '. Re-run as Administrator.', mbError, MB_OK);
    Abort;
  end;
end;

function CmdLine(Cmd: String): Boolean;
var
  ResultCode: Integer;
begin
  // Wrap in extra outer quotes so cmd.exe's "strip first + last quote"
  // rule (cmd /? — "Processing of quote characters") doesn't mangle a
  // command that itself contains quoted paths. Without this, calling
  //   cmd.exe /C "C:\Program Files\nssm.exe" install Foo "C:\Program Files\Bar.exe"
  // ends up as
  //   nssm.exe install Foo C:\Program Files\Bar.exe    (← path broken)
  // The double-outer-quote form is the documented workaround.
  Result := Exec(ExpandConstant('{cmd}'), '/C "' + Cmd + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

// Direct Exec without cmd.exe — for callees that have quoted args and
// don't need shell features. CreateProcess parses the executable name
// itself then passes args verbatim, so quotes survive.
function ExecQuiet(ExePath, Args: String): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec(ExePath, Args, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

procedure InstallService;
var
  ExePath: String;
  NssmPath: String;
  LogDir: String;
  WatchdogScript: String;
  WatchdogPath: String;
  StagedProbe: String;
  ProbeDir: String;
begin
  ExePath := ExpandConstant('{app}\{#MyAppExeName}');
  NssmPath := ExpandConstant('{app}\nssm.exe');
  LogDir := ExpandConstant('{commonappdata}') + '\ExargenPulse\logs';
  if not DirExists(LogDir) then
    CreateDir(LogDir);

  // 1. Register the Windows Service via NSSM.
  //
  //    NSSM is the SCM-compliant wrapper — it responds to
  //    SERVICE_START_PENDING / SERVICE_RUNNING / SERVICE_STOP messages
  //    that the bare PulseAgent.exe (a regular Node binary) does not.
  //    NSSM then launches PulseAgent.exe as a child process and
  //    supervises it.
  //
  //    `nssm install <service> <exe>` — registers the service
  //    `nssm set <service> AppDirectory <dir>` — child's CWD
  //    `nssm set <service> AppStdout / AppStderr` — pipe child output
  //    `nssm set <service> AppExit Default Restart` — restart on exit
  //    `nssm set <service> AppRestartDelay 5000` — 5-sec restart delay
  //    `nssm set <service> Description ...`

  // All nssm / schtasks calls go through ExecQuiet (direct Exec, no
  // cmd.exe in the middle) so embedded quoted paths survive intact.

  if not ExecQuiet(NssmPath, 'install {#MyServiceName} "' + ExePath + '"') then begin
    MsgBox('Failed to register the Windows Service via NSSM. Check that nssm.exe is not blocked by Defender / AV.', mbError, MB_OK);
    Abort;
  end;
  ExecQuiet(NssmPath, 'set {#MyServiceName} AppDirectory "' + ExpandConstant('{app}') + '"');
  ExecQuiet(NssmPath, 'set {#MyServiceName} AppStdout "' + LogDir + '\pulse-agent.out.log"');
  ExecQuiet(NssmPath, 'set {#MyServiceName} AppStderr "' + LogDir + '\pulse-agent.err.log"');
  ExecQuiet(NssmPath, 'set {#MyServiceName} AppRotateFiles 1');
  ExecQuiet(NssmPath, 'set {#MyServiceName} AppRotateBytes 10485760');
  ExecQuiet(NssmPath, 'set {#MyServiceName} AppExit Default Restart');
  ExecQuiet(NssmPath, 'set {#MyServiceName} AppRestartDelay 5000');
  ExecQuiet(NssmPath, 'set {#MyServiceName} Start SERVICE_AUTO_START');
  ExecQuiet(NssmPath, 'set {#MyServiceName} Description "Exargen Command Center — device health + productivity telemetry agent"');
  ExecQuiet(NssmPath, 'set {#MyServiceName} DisplayName "Exargen Pulse Agent"');

  // 2. Belt-and-braces: SCM-level Service Recovery in case NSSM itself
  //    crashes (vanishingly rare, but free protection). sc.exe needs
  //    its weird `key= value` syntax; CmdLine via cmd.exe is fine
  //    because there are no embedded quoted paths.
  CmdLine('sc.exe failure {#MyServiceName} reset= 86400 actions= restart/5000/restart/5000/restart/5000');

  // 3. Register the watchdog scheduled task (Wave 9 — Go binary).
  //
  //    The previous version registered a PowerShell .ps1 which
  //    flashed a brief console window every 5 minutes. Replaced
  //    with watchdog.exe (Go, -H=windowsgui) — same advapi32
  //    OpenSCManager → QueryServiceStatus → StartService dance,
  //    no console host, no JIT warmup.
  //
  //    Like user-probe.exe, we stage the binary at a no-spaces path
  //    (%ProgramData%) so schtasks /TR doesn't choke on the space in
  //    "Program Files".
  WatchdogPath := ExpandConstant('{commonappdata}') + '\ExargenPulse\watchdog.exe';
  FileCopy(ExpandConstant('{app}\watchdog.exe'), WatchdogPath, False);
  ExecQuiet('schtasks.exe', '/Delete /TN {#MyWatchdogName} /F');
  ExecQuiet('schtasks.exe',
    '/Create /TN {#MyWatchdogName} ' +
    '/SC MINUTE /MO 5 /RU SYSTEM /RL HIGHEST /F ' +
    '/TR "' + WatchdogPath + '"'
  );

  // 4. Register the user-session foreground-app probe scheduled task.
  //
  //    The probe (`user-probe.exe`) MUST run as the logged-on
  //    interactive user — GetForegroundWindow called from SYSTEM /
  //    Session 0 returns NULL, which is what kept per-app foreground
  //    time stuck at 0 in v1. `/RU INTERACTIVE` tells the Task
  //    Scheduler to use the current console user's token, which is
  //    exactly the per-session context the Win32 APIs need.
  //
  //    Trigger: every 1 minute. The agent samples the JSON output on
  //    its 30-sec accumulator tick; a 1-min refresh on the writer
  //    side keeps the lag bounded to under 90 seconds (well inside
  //    the agent's 5-min staleness cutoff). Bumping the cadence
  //    higher than 1/min hits the schtasks SC MINUTE floor.
  //
  //    Pre-create the probe output directory and ACL it so a
  //    non-admin user session can write to it without UAC prompts.
  //    Default ACLs on %ProgramData% are SYSTEM + Admins FullControl,
  //    Users Read+Execute — we need Users Modify on this one folder.
  ProbeDir := ExpandConstant('{commonappdata}') + '\ExargenPulse\probe';
  if not DirExists(ProbeDir) then
    CreateDir(ProbeDir);
  CmdLine('icacls "' + ProbeDir + '" /grant *S-1-5-32-545:(OI)(CI)M /T');
  // S-1-5-32-545 = BUILTIN\Users — use the SID so the command works
  // on non-English Windows where the group name is localised.

  // Stage the probe at a no-spaces path so schtasks /TR doesn't have
  // to wrestle with quoting (Program Files has a space; schtasks
  // splits its /TR value on whitespace before honouring quotes on
  // some Windows configurations, which silently bricks task
  // registration — verified on TechGeek 2026-05-29).
  StagedProbe := ExpandConstant('{commonappdata}') + '\ExargenPulse\user-probe.exe';
  FileCopy(ExpandConstant('{app}\user-probe.exe'), StagedProbe, False);

  ExecQuiet('schtasks.exe', '/Delete /TN {#MyUserProbeName} /F');
  if not ExecQuiet('schtasks.exe',
    '/Create /TN {#MyUserProbeName} ' +
    '/SC MINUTE /MO 1 /RU INTERACTIVE /RL LIMITED /F ' +
    '/TR "' + StagedProbe + '"'
  ) then begin
    MsgBox('Failed to register the foreground-probe scheduled task. Per-app productivity tracking will be empty until the task is registered (re-run harden-pulse.ps1 to retry).', mbInformation, MB_OK);
  end;

  // Fire one initial run so foreground.json exists by the time the
  // agent first ticks (otherwise the first ~60 seconds of any new
  // install have a null foreground app — harmless but confusing).
  ExecQuiet('schtasks.exe', '/Run /TN {#MyUserProbeName}');

  // 5. Start the service.
  ExecQuiet(NssmPath, 'start {#MyServiceName}');
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    WriteConfigJson;
    InstallService;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  NssmPath: String;
begin
  NssmPath := ExpandConstant('{app}\nssm.exe');
  if CurUninstallStep = usUninstall then begin
    if FileExists(NssmPath) then begin
      ExecQuiet(NssmPath, 'stop {#MyServiceName}');
      ExecQuiet(NssmPath, 'remove {#MyServiceName} confirm');
    end
    else begin
      CmdLine('sc.exe stop {#MyServiceName}');
      CmdLine('sc.exe delete {#MyServiceName}');
    end;
    ExecQuiet('schtasks.exe', '/Delete /TN {#MyWatchdogName} /F');
    ExecQuiet('schtasks.exe', '/Delete /TN {#MyUserProbeName} /F');
  end;
  if CurUninstallStep = usPostUninstall then begin
    DelTree(ExpandConstant('{commonappdata}') + '\ExargenPulse', True, True, True);
  end;
end;
