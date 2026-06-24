/**
 * The built-in coding toolset. Each tool is small, typed, and acts only through
 * the sandbox — so path containment, exec bounds, and guardrails apply by
 * construction. Tool *errors are data*: a handler throws on a bad request (file
 * missing, ambiguous edit, blocked command) and the ToolRunner turns that into
 * an `ok:false` result the model reads and reacts to — it never crashes the run.
 *
 * A non-zero exit from `bash` is NOT a tool failure: a failing test is a result
 * the agent should see and act on, so `bash` reports the exit code in its output
 * and still succeeds as a tool.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import {
  type CommandGuardrailPolicy,
  DEFAULT_ALLOWED_BINARIES,
  checkCommand,
} from './guardrails';
import type { ToolContext, ToolDefinition, ToolOutput } from './types';

const MAX_READ_CHARS = 100_000;
const GREP_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'coverage', 'build']);
const GREP_MAX_MATCHES = 200;
const GREP_MAX_FILE_BYTES = 1_000_000;

export const readFileTool: ToolDefinition<{ path: string }> = {
  name: 'read_file',
  description: 'Read a UTF-8 text file from the workspace.',
  mutates: false,
  schema: z.object({ path: z.string().describe('Workspace-relative file path.') }),
  async handler({ path: p }, { sandbox }: ToolContext): Promise<ToolOutput> {
    const text = await sandbox.readFile(p);
    if (text.length > MAX_READ_CHARS) {
      return { content: `${text.slice(0, MAX_READ_CHARS)}\n…[truncated at ${MAX_READ_CHARS} chars]`, data: { truncated: true } };
    }
    return { content: text };
  },
};

export const writeFileTool: ToolDefinition<{ path: string; content: string }> = {
  name: 'write_file',
  description: 'Create or overwrite a UTF-8 text file (parent dirs are created).',
  mutates: true,
  schema: z.object({
    path: z.string().describe('Workspace-relative file path.'),
    content: z.string().describe('Full file content to write.'),
  }),
  async handler({ path: p, content }, { sandbox }: ToolContext): Promise<ToolOutput> {
    await sandbox.writeFile(p, content);
    return { content: `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${p}`, data: { path: p } };
  },
};

export const editFileTool: ToolDefinition<{ path: string; find: string; replace: string; replaceAll?: boolean }> = {
  name: 'edit_file',
  description: 'Replace an exact substring in a file. Fails if the substring is missing, or appears more than once unless replaceAll is set.',
  mutates: true,
  schema: z.object({
    path: z.string().describe('Workspace-relative file path.'),
    find: z.string().describe('Exact substring to replace.'),
    replace: z.string().describe('Replacement text.'),
    replaceAll: z.boolean().describe('Replace every occurrence instead of requiring a unique match.').optional(),
  }),
  async handler({ path: p, find, replace, replaceAll }, { sandbox }: ToolContext): Promise<ToolOutput> {
    const original = await sandbox.readFile(p);
    const count = original.split(find).length - 1;
    if (count === 0) throw new Error(`substring not found in ${p}`);
    if (count > 1 && !replaceAll) throw new Error(`substring is not unique in ${p} (${count} matches); set replaceAll to replace all`);
    const updated = replaceAll ? original.split(find).join(replace) : original.replace(find, replace);
    await sandbox.writeFile(p, updated);
    return { content: `Replaced ${replaceAll ? count : 1} occurrence(s) in ${p}`, data: { path: p, replaced: replaceAll ? count : 1 } };
  },
};

export const listDirTool: ToolDefinition<{ path?: string }> = {
  name: 'list_dir',
  description: 'List the entries of a workspace directory (non-recursive).',
  mutates: false,
  schema: z.object({ path: z.string().describe('Workspace-relative directory. Defaults to root.').optional() }),
  async handler({ path: p }, { sandbox }: ToolContext): Promise<ToolOutput> {
    const entries = await sandbox.list(p ?? '.');
    return { content: entries.join('\n') || '(empty)', data: { entries } };
  },
};

export const grepTool: ToolDefinition<{ pattern: string; path?: string; flags?: string }> = {
  name: 'grep',
  description: 'Search workspace files for a regular expression, returning matching lines as path:line:text.',
  mutates: false,
  schema: z.object({
    pattern: z.string().describe('Regular expression to search for.'),
    path: z.string().describe('Workspace-relative directory to search. Defaults to root.').optional(),
    flags: z.string().describe('Regex flags, e.g. "i". "g" is always applied.').optional(),
  }),
  async handler({ pattern, path: p, flags }, { sandbox }: ToolContext): Promise<ToolOutput> {
    let re: RegExp;
    try {
      re = new RegExp(pattern, flags?.includes('i') ? 'i' : '');
    } catch (e) {
      throw new Error(`invalid regex: ${e instanceof Error ? e.message : String(e)}`);
    }
    const root = sandbox.resolve(p ?? '.');
    const matches: string[] = [];
    await walk(root, async (file) => {
      if (matches.length >= GREP_MAX_MATCHES) return;
      const stat = await fs.stat(file);
      if (stat.size > GREP_MAX_FILE_BYTES) return;
      let text: string;
      try {
        text = await fs.readFile(file, 'utf8');
      } catch {
        return; // unreadable / binary
      }
      const rel = path.relative(sandbox.root, file);
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && matches.length < GREP_MAX_MATCHES; i++) {
        if (re.test(lines[i])) matches.push(`${rel}:${i + 1}:${lines[i].trim()}`);
      }
    });
    const capped = matches.length >= GREP_MAX_MATCHES;
    return {
      content: matches.length ? matches.join('\n') + (capped ? `\n…[capped at ${GREP_MAX_MATCHES} matches]` : '') : '(no matches)',
      data: { count: matches.length, capped },
    };
  },
};

/** `bash` needs a guardrail policy, so it's a factory rather than a constant. */
export function createBashTool(policy: CommandGuardrailPolicy = { allowedBinaries: DEFAULT_ALLOWED_BINARIES }): ToolDefinition<{
  command: string;
  timeoutMs?: number;
}> {
  return {
    name: 'bash',
    description: 'Run a shell command in the workspace. Restricted by guardrails; a non-zero exit is reported, not an error.',
    mutates: true,
    schema: z.object({
      command: z.string().describe('The shell command line to run.'),
      timeoutMs: z.number().describe('Kill the command after this many ms.').optional(),
    }),
    async handler({ command, timeoutMs }, { sandbox, signal }: ToolContext): Promise<ToolOutput> {
      const decision = checkCommand(command, policy);
      if (!decision.allowed) throw new Error(decision.reason ?? 'command blocked by guardrail');
      const res = await sandbox.exec('bash', ['-c', command], { timeoutMs, signal });
      const parts = [`exit ${res.timedOut ? 'TIMEOUT' : res.exitCode}`];
      if (res.stdout) parts.push(`--- stdout ---\n${res.stdout}`);
      if (res.stderr) parts.push(`--- stderr ---\n${res.stderr}`);
      if (res.truncated) parts.push('…[output truncated]');
      return { content: parts.join('\n'), data: res };
    },
  };
}

/** The default coding toolset. */
export function defaultTools(opts: { bashPolicy?: CommandGuardrailPolicy } = {}): ToolDefinition[] {
  return [
    readFileTool,
    writeFileTool,
    editFileTool,
    listDirTool,
    grepTool,
    createBashTool(opts.bashPolicy),
  ] as ToolDefinition[];
}

/** Depth-first walk over files, skipping noisy/large directories. */
async function walk(dir: string, onFile: (file: string) => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (GREP_SKIP_DIRS.has(entry.name)) continue;
      await walk(full, onFile);
    } else if (entry.isFile()) {
      await onFile(full);
    }
  }
}
