import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { RunStatus, RunStepType } from '@prisma/client';
import { LoopController, type RunRecorder } from './loopController';
import { ContextEngine } from '../context/contextEngine';
import { buildSystemPrompt } from '../context/systemPrompt';
import { ToolRunner } from '../tools/toolRunner';
import { defaultTools } from '../tools/builtins';
import { createRunTestsTool, createGitCommitTool, createOpenPrTool } from '../tools/finalize';
import { referenceGitProvider } from '../git/referenceProvider';
import { WorktreeSandbox } from '../sandbox/worktreeSandbox';
import type { ModelClient, ModelResponse, CompletionRequest, ModelToolCall } from '../model/types';
import type { RunContext } from '../../runtimeAdapter';
import type { Sandbox } from '../sandbox/sandbox';

// ── test doubles ────────────────────────────────────────────────────────────

const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 10 };

function say(content: string): ModelResponse {
  return { content, toolCalls: [], finishReason: 'stop', usage, model: 'mock' };
}
function callTool(id: string, name: string, args: string, totalTokens = 10): ModelResponse {
  const calls: ModelToolCall[] = [{ id, name, arguments: args }];
  return { content: '', toolCalls: calls, finishReason: 'tool_calls', usage: { ...usage, totalTokens }, model: 'mock' };
}

/** A model that plays a fixed script of responses (repeating the last). */
class ScriptedModel implements ModelClient {
  readonly model = 'mock';
  private i = 0;
  constructor(private readonly script: ModelResponse[]) {}
  async complete(_req: CompletionRequest): Promise<ModelResponse> {
    return this.script[Math.min(this.i++, this.script.length - 1)];
  }
  // eslint-disable-next-line require-yield
  async *stream(): AsyncIterable<never> {
    throw new Error('not used');
  }
}

class ThrowingModel implements ModelClient {
  readonly model = 'mock';
  async complete(): Promise<ModelResponse> {
    throw new Error('model exploded');
  }
  async *stream(): AsyncIterable<never> {
    throw new Error('not used');
  }
}

class FakeRecorder implements RunRecorder {
  readonly steps: { type: RunStepType; title: string; detail?: string }[] = [];
  readonly transitions: { to: RunStatus; summary?: string; error?: string }[] = [];
  async step(input: { type: RunStepType; title: string; detail?: string }) {
    this.steps.push(input);
  }
  async transition(to: RunStatus, opts?: { summary?: string; error?: string }) {
    this.transitions.push({ to, ...opts });
  }
}

const CTX: RunContext = {
  runId: 'r1',
  taskId: 't1',
  agentId: 'a1',
  task: { title: 'Add an output file', description: null, acceptanceCriteria: [] },
};

// ── fixtures ─────────────────────────────────────────────────────────────────

let dir: string;
let sandbox: Sandbox;
let tools: ToolRunner;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumey-loop-'));
  sandbox = WorktreeSandbox.forDir(dir, { owned: true });
  tools = new ToolRunner(defaultTools());
});
afterEach(async () => {
  await sandbox.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

function engine(over = {}) {
  return new ContextEngine(buildSystemPrompt(CTX, tools.list()), over);
}

// ── the end-to-end test ──────────────────────────────────────────────────────

describe('LoopController (end-to-end over real sandbox + tools + context)', () => {
  it('drives a real coding session: read → write → review, mutating the workspace', async () => {
    await sandbox.writeFile('README.md', 'hello world');
    const model = new ScriptedModel([
      callTool('c1', 'read_file', '{"path":"README.md"}'),
      callTool('c2', 'write_file', '{"path":"out.txt","content":"done"}'),
      say('Implemented the output file; please review.'),
    ]);
    const recorder = new FakeRecorder();
    const loop = new LoopController({ model, tools, context: engine(), sandbox, recorder });

    const outcome = await loop.run();

    // the agent actually changed the workspace
    expect(await sandbox.readFile('out.txt')).toBe('done');

    // landed in the right lifecycle state, with the model's words as the summary
    expect(outcome.status).toBe(RunStatus.AWAITING_REVIEW);
    expect(outcome.summary).toContain('Implemented');
    expect(recorder.transitions.map((t) => t.to)).toEqual([RunStatus.RUNNING, RunStatus.AWAITING_REVIEW]);

    // the trace describes what happened
    const stepTypes = recorder.steps.map((s) => s.type);
    expect(stepTypes).toContain(RunStepType.TOOL_CALL); // read_file
    expect(stepTypes).toContain(RunStepType.EDIT); // write_file
    expect(stepTypes).toContain(RunStepType.REVIEW_REQUEST); // finalize
  });

  it('records a failing tool as an ok:false step but keeps going', async () => {
    const model = new ScriptedModel([
      callTool('c1', 'read_file', '{"path":"missing.txt"}'),
      say('Could not read the file; stopping.'),
    ]);
    const recorder = new FakeRecorder();
    const outcome = await new LoopController({ model, tools, context: engine(), sandbox, recorder }).run();

    expect(outcome.status).toBe(RunStatus.AWAITING_REVIEW);
    expect(recorder.steps.some((s) => s.title.includes('(failed)'))).toBe(true);
  });

  it('classifies a test command as a TEST step', async () => {
    const model = new ScriptedModel([
      callTool('c1', 'bash', '{"command":"npm test"}'),
      say('done'),
    ]);
    const recorder = new FakeRecorder();
    await new LoopController({
      model,
      tools: new ToolRunner(defaultTools({ bashPolicy: { allowedBinaries: ['npm'] } })),
      context: engine(),
      sandbox,
      recorder,
    }).run();
    expect(recorder.steps.some((s) => s.type === RunStepType.TEST)).toBe(true);
  });
});

describe('LoopController safety rails', () => {
  it('turns a terminal model error into a FAILED run, not a crash', async () => {
    const recorder = new FakeRecorder();
    const outcome = await new LoopController({ model: new ThrowingModel(), tools, context: engine(), sandbox, recorder }).run();
    expect(outcome.status).toBe(RunStatus.FAILED);
    expect(recorder.transitions.at(-1)).toMatchObject({ to: RunStatus.FAILED, error: 'model exploded' });
  });

  it('stops at the step ceiling and hands off to review', async () => {
    // a model that never stops calling tools
    const model = new ScriptedModel([callTool('c', 'list_dir', '{}')]);
    const recorder = new FakeRecorder();
    const outcome = await new LoopController({ model, tools, context: engine(), sandbox, recorder, budget: { maxSteps: 3 } }).run();
    expect(outcome.status).toBe(RunStatus.AWAITING_REVIEW);
    expect(outcome.turns).toBe(3);
    expect(outcome.summary).toMatch(/step ceiling/);
  });

  it('hands off when the token budget is exhausted', async () => {
    const model = new ScriptedModel([callTool('c', 'list_dir', '{}', 5000)]);
    const recorder = new FakeRecorder();
    const outcome = await new LoopController({ model, tools, context: engine(), sandbox, recorder, budget: { maxTokens: 100 } }).run();
    expect(outcome.status).toBe(RunStatus.AWAITING_REVIEW);
    expect(outcome.summary).toMatch(/token budget/);
  });

  it('cancels cooperatively when the signal is aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const model = new ScriptedModel([callTool('c', 'list_dir', '{}')]);
    const recorder = new FakeRecorder();
    const outcome = await new LoopController({ model, tools, context: engine(), sandbox, recorder, signal: ac.signal }).run();
    expect(outcome.status).toBe(RunStatus.CANCELLED);
    expect(recorder.transitions.map((t) => t.to)).toEqual([RunStatus.RUNNING, RunStatus.CANCELLED]);
  });
});

// ── the full agent flow over a real git repo ─────────────────────────────────

function git(cwd: string, args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const c = spawn('git', args, { cwd });
    let out = '';
    c.stdout?.on('data', (d) => (out += d.toString()));
    c.on('error', reject);
    c.on('close', (code) => resolve({ code, out }));
  });
}

describe('LoopController — full agent flow over a real git worktree', () => {
  it('writes code, runs tests, commits to a run branch, and requests review', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'lumey-e2e-repo-'));
    let sb: WorktreeSandbox | undefined;
    try {
      await git(repo, ['init', '-q']);
      await git(repo, ['config', 'user.email', 't@t.t']);
      await git(repo, ['config', 'user.name', 'T']);
      await fs.writeFile(path.join(repo, 'README.md'), '# proj\n');
      await git(repo, ['add', '.']);
      await git(repo, ['commit', '-qm', 'init']);

      sb = await WorktreeSandbox.create({ repoPath: repo });
      const linkedPrs: { externalId: string; title: string }[] = [];
      const runTools = new ToolRunner([
        ...defaultTools(),
        createRunTestsTool({ command: `${process.execPath} -e "process.exit(0)"` }),
        createGitCommitTool({ branch: 'lumey/run-e2e' }),
        createOpenPrTool({
          provider: referenceGitProvider,
          branch: 'lumey/run-e2e',
          onOpened: async (ref, input) => {
            linkedPrs.push({ externalId: ref.externalId, title: input.title });
          },
        }),
      ]);
      const model = new ScriptedModel([
        callTool('c1', 'write_file', '{"path":"feature.js","content":"module.exports = 1;"}'),
        callTool('c2', 'run_tests', '{}'),
        callTool('c3', 'git_commit', '{"message":"add feature"}'),
        callTool('c4', 'open_pr', '{"title":"Add feature","body":"done"}'),
        say('Implemented, committed, and opened a PR; please review.'),
      ]);
      const recorder = new FakeRecorder();
      const ctxEngine = new ContextEngine(buildSystemPrompt(CTX, runTools.list()));

      const outcome = await new LoopController({ model, tools: runTools, context: ctxEngine, sandbox: sb, recorder }).run();

      expect(outcome.status).toBe(RunStatus.AWAITING_REVIEW);
      // the commit landed on the run branch inside the worktree
      const log = await git(sb.root, ['log', '--oneline', '-1', 'lumey/run-e2e']);
      expect(log.out).toContain('add feature');
      // the PR was opened and linked to the task
      expect(linkedPrs).toHaveLength(1);
      expect(linkedPrs[0].title).toBe('Add feature');
      // the trace shows write → test → commit → PR/review
      const types = recorder.steps.map((s) => s.type);
      expect(types).toContain(RunStepType.EDIT);
      expect(types).toContain(RunStepType.TEST);
      expect(types).toContain(RunStepType.COMMAND); // git_commit
      expect(types).toContain(RunStepType.REVIEW_REQUEST); // open_pr + finalize
    } finally {
      if (sb) await sb.dispose();
      await fs.rm(repo, { recursive: true, force: true });
    }
  });
});
