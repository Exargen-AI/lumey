/**
 * The Sandbox is the execution environment for a run: a scoped workspace with
 * filesystem + process access, and a hard boundary around both. Every tool the
 * agent uses goes through it, so this is where blast radius is contained.
 *
 * Two invariants this layer guarantees, regardless of what a tool asks for:
 *   1. **Path containment** — every file path resolves *inside* `root`. A tool
 *      cannot read `/etc/passwd` or write outside the workspace, full stop.
 *   2. **Bounded exec** — every process runs with a timeout, an output cap, and
 *      no implicit shell; a runaway or a flood can't hang or OOM the host.
 *
 * Implementations escalate isolation without changing this contract:
 * `WorktreeSandbox` (git worktree, local dev) → a container sandbox (dropped
 * caps, controlled egress) → a self-hosted/air-gapped sandbox. The runtime
 * above never knows which it got.
 */

/** Result of a process run inside the sandbox. Never throws on a non-zero exit. */
export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  /** True when the process was killed for exceeding `timeoutMs`. */
  readonly timedOut: boolean;
  /** True when stdout/stderr was clipped at `maxOutputBytes`. */
  readonly truncated: boolean;
}

export interface ExecOptions {
  /** Working dir relative to the sandbox root. Defaults to root. Path-guarded. */
  readonly cwd?: string;
  /** Kill the process after this many ms. Default 30_000. */
  readonly timeoutMs?: number;
  /** Cap on captured stdout/stderr bytes (each). Default 1_000_000. */
  readonly maxOutputBytes?: number;
  /** Cooperative cancellation — aborting kills the process. */
  readonly signal?: AbortSignal;
}

export interface Sandbox {
  /** Absolute path of the workspace root. */
  readonly root: string;
  /** Resolve a workspace-relative path to an absolute one, or throw if it escapes root. */
  resolve(relPath: string): string;
  readFile(relPath: string): Promise<string>;
  writeFile(relPath: string, content: string): Promise<void>;
  /** Directory entry names (not recursive). */
  list(relDir: string): Promise<string[]>;
  /** Run a binary with an explicit argv (no shell). Returns the outcome; does not throw on exit code. */
  exec(command: string, args: string[], opts?: ExecOptions): Promise<ExecResult>;
  /** Tear down the workspace (remove the worktree / temp dir we created). Idempotent. */
  dispose(): Promise<void>;
}

/** A tool tried to touch a path outside the sandbox root. */
export class SandboxPathError extends Error {
  constructor(relPath: string) {
    super(`path escapes the sandbox root: ${relPath}`);
    this.name = 'SandboxPathError';
  }
}
