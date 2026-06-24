/**
 * The `native` runtime adapter — Lumey's own agent runtime behind the seam.
 * It composes the four in-house components into a real run:
 *
 *   ModelClient  (M2.4)  — inference, any OpenAI-compatible backend
 *   ToolRunner + Sandbox (M2.5) — the agent's guarded, isolated hands
 *   ContextEngine (M2.6) — token-efficient prompt assembly
 *   LoopController (M2.7) — the agentic loop + safety rails
 *
 * Nothing above the seam changes: the same start-run API and trace UI that the
 * `referenceAdapter` drives now run on a real loop when a model is configured.
 * The `referenceAdapter` stays the default so demos work with no model at all.
 *
 * Construction is dependency-injected so the whole adapter is testable with a
 * mock model over a real sandbox + tools + context engine. The default factories
 * resolve the model from env and give each run a fresh temp-dir workspace.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { RunStatus } from '@prisma/client';
import prisma from '../../../config/database';
import { appendStep, transitionRun, recordUsage } from '../../../services/agentRun.service';
import { isTerminal } from '../../../lib/runLifecycle';
import type { RuntimeAdapter, RunContext } from '../runtimeAdapter';
import { LoopController, type LoopBudget, type RunRecorder } from '../runtime/loop/loopController';
import { ContextEngine } from '../runtime/context/contextEngine';
import { buildSystemPrompt } from '../runtime/context/systemPrompt';
import { ToolRunner } from '../runtime/tools/toolRunner';
import { defaultTools } from '../runtime/tools/builtins';
import { createRunTestsTool, createGitCommitTool, createOpenPrTool } from '../runtime/tools/finalize';
import { referenceGitProvider } from '../runtime/git/referenceProvider';
import { createGitHubProvider } from '../runtime/git/githubProvider';
import type { GitProvider } from '../runtime/git/gitProvider';
import { linkPullRequestToTask } from '../../../services/taskPullRequestLink.service';
import { modelClientFromEnv } from '../runtime/model/factory';
import type { ModelClient, ChatMessage } from '../runtime/model/types';
import type { Sandbox } from '../runtime/sandbox/sandbox';
import { WorktreeSandbox } from '../runtime/sandbox/worktreeSandbox';

export interface NativeAdapterDeps {
  /** Resolve the model for a run. Throws if no model is configured. */
  readonly modelFactory: () => ModelClient;
  /** Provide the workspace for a run. Default: a fresh owned temp dir. */
  readonly sandboxFactory?: (ctx: RunContext) => Promise<Sandbox>;
  /** Provide the toolset. Default: the six built-in coding tools. */
  readonly toolsFactory?: () => ToolRunner;
  readonly budget?: LoopBudget;
}

/** Bind the run service to a runId as a LoopController recorder. */
function serviceRecorder(runId: string): RunRecorder {
  return {
    async step(input) {
      await appendStep(runId, input);
    },
    async transition(to, opts) {
      if (opts) await transitionRun(runId, to, opts);
      else await transitionRun(runId, to);
    },
    async usage(usage) {
      await recordUsage(runId, usage);
    },
  };
}

async function tempDirSandbox(): Promise<Sandbox> {
  const base = path.join(os.tmpdir(), 'lumey-native');
  await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, 'run-'));
  return WorktreeSandbox.forDir(dir, { owned: true });
}

/**
 * The default workspace: a git **worktree** of a configured repo when
 * `LUMEY_RUN_REPO_PATH` is set (so the agent runs on real code, runs its tests,
 * and commits to a run branch), else a fresh temp dir. A proper per-project repo
 * config replaces the env bridge when project git settings land.
 */
async function repoAwareSandbox(): Promise<Sandbox> {
  const repoPath = process.env.LUMEY_RUN_REPO_PATH;
  if (repoPath) return WorktreeSandbox.create({ repoPath, ref: process.env.LUMEY_RUN_REF });
  return tempDirSandbox();
}

/**
 * Pick the GitProvider: the real `github` one when a token + repo are configured
 * (`LUMEY_GITHUB_TOKEN` + `LUMEY_GITHUB_REPO=owner/repo`), else the reference
 * simulator — so the flow works with no GitHub auth at all.
 */
function resolveGitProvider(sandbox: Sandbox): GitProvider {
  const token = process.env.LUMEY_GITHUB_TOKEN;
  const repo = process.env.LUMEY_GITHUB_REPO;
  if (token && repo && repo.includes('/')) {
    const [owner, name] = repo.split('/');
    return createGitHubProvider({ exec: (command, args) => sandbox.exec(command, args), token, owner, repo: name });
  }
  return referenceGitProvider;
}

/** The default toolset for a run: the coding tools plus run-scoped finalize tools. */
function defaultRunTools(ctx: RunContext, sandbox: Sandbox): ToolRunner {
  const branch = `lumey/run-${ctx.runId}`;
  return new ToolRunner([
    ...defaultTools(),
    createRunTestsTool({ command: process.env.LUMEY_TEST_CMD }),
    createGitCommitTool({ branch }),
    createOpenPrTool({
      provider: resolveGitProvider(sandbox),
      branch,
      base: process.env.LUMEY_PR_BASE,
      onOpened: async (ref, input) => {
        await linkPullRequestToTask(ctx.taskId, { externalId: ref.externalId, url: ref.url, title: input.title });
      },
    }),
  ]);
}

/** A model-backed compaction summarizer for the ContextEngine. */
function modelSummarizer(model: ModelClient): (older: ChatMessage[]) => Promise<string> {
  return async (older) => {
    const res = await model.complete({
      messages: [
        { role: 'system', content: 'Summarize the agent progress below in 3-4 sentences: what was tried, what changed, what remains. Be concrete.' },
        { role: 'user', content: older.map((m) => `${m.role}: ${m.content}`).join('\n').slice(0, 12_000) },
      ],
    });
    return res.content || '(summary unavailable)';
  };
}

export function createNativeAdapter(deps: NativeAdapterDeps): RuntimeAdapter {
  const inflight = new Map<string, AbortController>();

  return {
    id: 'native',

    capabilities: () => ({
      selfHosted: true, // runs anywhere this process runs, including air-gapped
      memory: false, // cross-run memory is a later milestone
      outcomes: false, // rubric-graded iterate→grade loop is a later milestone
      multiAgent: false, // single-agent loop for now
    }),

    async execute(ctx) {
      const controller = new AbortController();
      inflight.set(ctx.runId, controller);
      let sandbox: Sandbox | undefined;
      try {
        const model = deps.modelFactory(); // throws if no model configured
        sandbox = await (deps.sandboxFactory ?? repoAwareSandbox)(ctx);
        const tools = deps.toolsFactory ? deps.toolsFactory() : defaultRunTools(ctx, sandbox);
        const context = new ContextEngine(buildSystemPrompt(ctx, tools.list()), { summarize: modelSummarizer(model) });
        const loop = new LoopController({
          model,
          tools,
          context,
          sandbox,
          recorder: serviceRecorder(ctx.runId),
          budget: deps.budget,
          signal: controller.signal,
        });
        await loop.run();
      } catch (e) {
        await failRun(ctx.runId, e); // a setup error before the loop transitioned RUNNING
      } finally {
        inflight.delete(ctx.runId);
        if (sandbox) await sandbox.dispose();
      }
    },

    async cancel(runId) {
      const controller = inflight.get(runId);
      if (controller) {
        controller.abort(); // in-flight: the loop transitions CANCELLED at its next checkpoint
        return;
      }
      const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { status: true } });
      if (run && !isTerminal(run.status)) {
        await transitionRun(runId, RunStatus.CANCELLED);
      }
    },
  };
}

/** Best-effort transition of a non-terminal run to FAILED after a setup error. */
async function failRun(runId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { status: true } });
  if (run && !isTerminal(run.status)) {
    await transitionRun(runId, RunStatus.FAILED, { error: message }).catch(() => undefined);
  }
}

/** The default native adapter: model from env, fresh temp-dir workspace per run. */
export const nativeAdapter: RuntimeAdapter = createNativeAdapter({ modelFactory: modelClientFromEnv });
