/**
 * GuardrailEnforcer (command tier) — the server-side check at the `bash` tool
 * boundary. Path containment is the sandbox's job; this is the *command* gate:
 * a runaway-or-malicious shell line is refused before it ever spawns.
 *
 * Two layers, deny wins:
 *   - **Denylist** — patterns that are never acceptable inside a run (privilege
 *     escalation, host-destructive ops, exfiltration, fork bombs, writes to
 *     device files). These block regardless of the allowlist.
 *   - **Allowlist** — the leading binary of the command must be one we permit.
 *     An empty allowlist means "deny by default", which is the safe posture for
 *     anything but trusted local dev.
 *
 * This is enforced where the agent can't reach around it (in-process, before
 * spawn). Hardening the *runtime* (container, dropped caps, no egress) is the
 * sandbox's job and stacks on top — guardrails and isolation are complementary.
 */

export interface GuardrailDecision {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface CommandGuardrailPolicy {
  /** Permitted leading binaries. Empty ⇒ deny-by-default. */
  readonly allowedBinaries?: readonly string[];
  /** Extra deny patterns layered on top of the built-in ones. */
  readonly extraDenyPatterns?: readonly RegExp[];
}

/** Never-acceptable shell patterns, independent of any allowlist. */
const DENY_PATTERNS: readonly RegExp[] = [
  /\bsudo\b/, // privilege escalation
  /\bsu\b\s/, // switch user
  /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf]/i, // rm -rf and friends
  /\bmkfs\b/, // format a filesystem
  /\bdd\b[^|]*\bof=\/dev\//, // raw write to a device
  /[>]\s*\/dev\/(sd|nvme|disk)/, // redirect into a block device
  /\bchmod\s+(-[a-z]*\s+)*777\b/, // world-writable
  /\bcurl\b[^|]*\|\s*(sh|bash)\b/, // curl | sh
  /\bwget\b[^|]*\|\s*(sh|bash)\b/, // wget | sh
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/, // fork bomb :(){ :|:& };:
  /\bshutdown\b|\breboot\b|\bhalt\b/, // host control
];

/** Reasonable default allowlist for local-dev coding work. */
export const DEFAULT_ALLOWED_BINARIES: readonly string[] = [
  'ls', 'cat', 'head', 'tail', 'wc', 'pwd', 'echo', 'printf',
  'grep', 'rg', 'find', 'sort', 'uniq', 'cut', 'tr', 'sed', 'awk', 'diff',
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'tsc', 'vitest', 'jest', 'eslint', 'prettier',
  'git', 'true', 'false', 'test', 'env',
];

/** Extract the leading binary token from a shell command line. */
export function leadingBinary(command: string): string {
  const trimmed = command.trim().replace(/^(\w+=\S+\s+)+/, ''); // skip leading VAR=val assignments
  const token = trimmed.split(/\s|;|&|\|/)[0] ?? '';
  return token.replace(/^.*\//, ''); // basename of e.g. /usr/bin/node
}

export function checkCommand(command: string, policy: CommandGuardrailPolicy = {}): GuardrailDecision {
  const cmd = command.trim();
  if (!cmd) return { allowed: false, reason: 'empty command' };

  const denyList = [...DENY_PATTERNS, ...(policy.extraDenyPatterns ?? [])];
  for (const re of denyList) {
    if (re.test(cmd)) return { allowed: false, reason: `blocked by guardrail: matches ${re}` };
  }

  const allow = policy.allowedBinaries ?? [];
  if (allow.length === 0) {
    return { allowed: false, reason: 'no command allowlist configured (deny by default)' };
  }
  const bin = leadingBinary(cmd);
  if (!allow.includes(bin)) {
    return { allowed: false, reason: `binary not on allowlist: ${bin}` };
  }
  return { allowed: true };
}
