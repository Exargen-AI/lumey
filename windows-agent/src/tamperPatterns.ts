/**
 * Pulse Agent — tamper-tool patterns (pure module, no Node deps).
 *
 * Split out from `collectors.ts` (which is rich in PowerShell/IPC code
 * that breaks in test runners) so the classifier + classifier tests can
 * import the patterns + helper without dragging in OS-specific bindings.
 *
 * A "tamper tool" is software whose only purpose is to defeat idle
 * detection — mouse jigglers, keep-awake utilities, scripted input
 * loops. Detection is conservative (the patterns list is hand-curated)
 * because the consequence — a TAMPER alert that nukes someone's
 * DEEP_WORK + PRESENCE sub-scores for the window — is heavy.
 *
 * AutoHotkey is included with the understanding that backend logs
 * it as INFO rather than CRITICAL — many devs use AHK for legitimate
 * remapping and we don't want a TAMPER alert every time they reload a
 * script. The agent still tags the foreground bucket as TAMPER so the
 * scorer can subtract those seconds; the SUPER_ADMIN reviewing the
 * breakdown sees the reason ("Mouse-jiggler / keep-awake tool
 * detected") and can make a judgment call.
 *
 * Adding a new pattern: append below + drop a test case into
 * `classifier.test.ts`. Order doesn't matter (we OR-test all of them).
 */

export const TAMPER_TOOL_PATTERNS: RegExp[] = [
  /^caffeine\.exe$/i,
  /^mousejiggler\.exe$/i,
  /^moveit\.exe$/i,
  /^keepalive\.exe$/i,
  /^awakemate\.exe$/i,
  /^kshutdown\.exe$/i,
  /^autohotkey\.exe$/i, // Sometimes used legitimately — backend logs as INFO not CRITICAL.
  // 2026-05-29 — additions from the Wave 8 sweep. The patterns below
  // catch common variants we've seen in the wild on dev forums + the
  // agent breakdown drawer.
  /^(jiggler|wigglemouse|wigglemymouse)\.exe$/i,
  /^(amphetamine|insomniaapp|sleepless)\.exe$/i,
  /^(automousemover|stayawake|nosleep)\.exe$/i,
];

export function isTamperTool(appName: string): boolean {
  const lower = (appName ?? '').toLowerCase();
  return TAMPER_TOOL_PATTERNS.some((p) => p.test(lower));
}
