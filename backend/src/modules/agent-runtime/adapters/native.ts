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
import { LoopController, type LoopBudget, type RunRecorder, type Grader } from '../runtime/loop/loopController';
import { ContextEngine } from '../runtime/context/contextEngine';
import { buildSystemPrompt } from '../runtime/context/systemPrompt';
import { ToolRunner } from '../runtime/tools/toolRunner';
import { defaultTools } from '../runtime/tools/builtins';
import { createRunTestsTool, createGitCommitTool, createOpenPrTool } from '../runtime/tools/finalize';
import { referenceGitProvider } from '../runtime/git/referenceProvider';
import { createGitHubProvider } from '../runtime/git/githubProvider';
import { createInstallationTokenSource, type InstallationTokenSource } from '../runtime/git/githubAppAuth';
import type { GitProvider } from '../runtime/git/gitProvider';
import { logger } from '../../../lib/logger';
import { linkPullRequestToTask } from '../../../services/taskPullRequestLink.service';
import { resolveRunRepoConfig } from '../../../services/runRepoConfig.service';
import { recallMemories, recordMemory, projectIdForTask } from '../../../services/agentMemory.service';
import { ensureRepoClone } from '../runtime/workspace/repoWorkspace';
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
 * The run workspace, in priority order:
 *   1. the task's **project repo** — cloned once into a per-project cache, then
 *      worktreed from `origin/<defaultBranch>` (needs `LUMEY_GITHUB_TOKEN`);
 *   2. a `LUMEY_RUN_REPO_PATH` local repo (single-repo override);
 *   3. a fresh temp dir (no repo configured — the simulator path).
 */
async function repoAwareSandbox(ctx: RunContext): Promise<Sandbox> {
  const cfg = await resolveRunRepoConfig(ctx.taskId);
  if (cfg) {
    const token = await resolveGitHubToken(cfg.owner, cfg.repo);
    if (token) {
      const repoPath = await ensureRepoClone({
        remoteUrl: `https://github.com/${cfg.owner}/${cfg.repo}.git`,
        cacheKey: `${cfg.owner}/${cfg.repo}`,
        authHeader: `Authorization: Bearer ${token}`,
      });
      return WorktreeSandbox.create({ repoPath, ref: `origin/${cfg.baseBranch}` });
    }
  }
  const repoPath = process.env.LUMEY_RUN_REPO_PATH;
  if (repoPath) return WorktreeSandbox.create({ repoPath, ref: process.env.LUMEY_RUN_REF });
  return tempDirSandbox();
}

/** Lazily build the GitHub App token source from env (once). */
let appTokenSource: InstallationTokenSource | null | undefined;
function getAppTokenSource(): InstallationTokenSource | null {
  if (appTokenSource !== undefined) return appTokenSource;
  const appId = process.env.LUMEY_GITHUB_APP_ID;
  const pem = process.env.LUMEY_GITHUB_APP_PRIVATE_KEY;
  appTokenSource = appId && pem ? createInstallationTokenSource({ appId, privateKey: pem.replace(/\\n/g, '\n') }) : null;
  return appTokenSource;
}

/** Prefer a short-lived GitHub App installation token; fall back to a PAT. */
async function resolveGitHubToken(owner: string, repo: string): Promise<string | null> {
  const source = getAppTokenSource();
  if (source) {
    try {
      return await source.getInstallationToken(owner, repo);
    } catch (err) {
      logger.warn({ err, owner, repo }, '[agent-runtime] GitHub App token failed; falling back to PAT');
    }
  }
  return process.env.LUMEY_GITHUB_TOKEN ?? null;
}

/**
 * Pick the GitProvider + PR base for a run. The real `github` one is used when
 * the task's project has a GitHub integration (repo identity) AND a token is
 * configured (`LUMEY_GITHUB_TOKEN`, a deployment secret); the base branch comes
 * from the project's `defaultBranch`. Otherwise the reference simulator — so the
 * flow works with no integration/auth at all. `LUMEY_GITHUB_REPO`/`LUMEY_PR_BASE`
 * remain a single-repo override for deployments without per-project config.
 */
async function resolveGitProviderAndBase(ctx: RunContext, sandbox: Sandbox): Promise<{ provider: GitProvider; base?: string }> {
  const exec = (command: string, args: string[]) => sandbox.exec(command, args);

  const cfg = await resolveRunRepoConfig(ctx.taskId);
  if (cfg) {
    const token = await resolveGitHubToken(cfg.owner, cfg.repo);
    if (token) {
      return { provider: createGitHubProvider({ exec, token, owner: cfg.owner, repo: cfg.repo }), base: cfg.baseBranch };
    }
  }
  const envRepo = process.env.LUMEY_GITHUB_REPO;
  const envToken = process.env.LUMEY_GITHUB_TOKEN;
  if (envRepo && envRepo.includes('/') && envToken) {
    const [owner, name] = envRepo.split('/');
    return { provider: createGitHubProvider({ exec, token: envToken, owner, repo: name }), base: process.env.LUMEY_PR_BASE };
  }
  return { provider: referenceGitProvider, base: process.env.LUMEY_PR_BASE };
}

/** The default toolset for a run: the coding tools plus run-scoped finalize tools. */
async function defaultRunTools(ctx: RunContext, sandbox: Sandbox): Promise<ToolRunner> {
  const branch = `lumey/run-${ctx.runId}`;
  const { provider, base } = await resolveGitProviderAndBase(ctx, sandbox);
  return new ToolRunner([
    ...defaultTools(),
    createRunTestsTool({ command: process.env.LUMEY_TEST_CMD }),
    createGitCommitTool({ branch }),
    createOpenPrTool({
      provider,
      branch,
      base,
      onOpened: async (ref, input) => {
        await linkPullRequestToTask(ctx.taskId, { externalId: ref.externalId, url: ref.url, title: input.title });
      },
    }),
  ]);
}

/** Recalled cross-run memories as a stable context preamble for the run. */
async function memoryPreamble(projectId: string): Promise<ChatMessage[]> {
  const memories = await recallMemories(projectId, { limit: 8 });
  if (!memories.length) return [];
  const body = memories.map((m) => `- ${m.content}`).join('\n');
  return [{ role: 'system', content: `Learnings from prior runs on this project (most recent first):\n${body}` }];
}

/** Render acceptance criteria as a checklist for the grader prompt. */
function renderCriteria(raw: RunContext['task']['acceptanceCriteria']): string {
  if (Array.isArray(raw)) {
    return raw
      .map((c) => (typeof c === 'string' ? c : typeof c === 'object' && c && 'text' in c ? String((c as { text: unknown }).text) : JSON.stringify(c)))
      .filter(Boolean)
      .map((c) => `- ${c}`)
      .join('\n');
  }
  return raw == null ? '' : `- ${typeof raw === 'string' ? raw : JSON.stringify(raw)}`;
}

function hasAcceptanceCriteria(raw: RunContext['task']['acceptanceCriteria']): boolean {
  return Array.isArray(raw) ? raw.length > 0 : raw != null;
}

/**
 * A model-backed Outcomes grader: judge the agent's final result against the
 * task's acceptance criteria. Replies `PASS`/`FAIL` + reason; the loop revises on
 * FAIL. A grader error degrades to "pass" so a flaky judge never blocks a run.
 */
function modelGrader(model: ModelClient, ctx: RunContext): Grader {
  const criteria = renderCriteria(ctx.task.acceptanceCriteria);
  return async (finalAnswer) => {
    try {
      const res = await model.complete({
        messages: [
          { role: 'system', content: 'You are a strict reviewer. Decide whether the agent\'s result satisfies EVERY acceptance criterion. Reply with a single line starting with PASS or FAIL, then a brief reason.' },
          { role: 'user', content: `Acceptance criteria:\n${criteria}\n\nAgent's final result:\n${finalAnswer}` },
        ],
      });
      const text = res.content.trim();
      return { passed: /^\s*pass\b/i.test(text), feedback: text || 'no grader feedback' };
    } catch {
      return { passed: true, feedback: 'grader unavailable — passed by default' };
    }
  };
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
      memory: true, // recalls + records cross-run project memory
      outcomes: true, // grades the result vs acceptance criteria and revises
      multiAgent: false, // single-agent loop for now
    }),

    async execute(ctx) {
      const controller = new AbortController();
      inflight.set(ctx.runId, controller);
      let sandbox: Sandbox | undefined;
      try {
        const model = deps.modelFactory(); // throws if no model configured
        const projectId = await projectIdForTask(ctx.taskId);
        sandbox = await (deps.sandboxFactory ?? repoAwareSandbox)(ctx);
        const tools = deps.toolsFactory ? deps.toolsFactory() : await defaultRunTools(ctx, sandbox);
        const preamble = projectId ? await memoryPreamble(projectId) : [];
        const context = new ContextEngine(buildSystemPrompt(ctx, tools.list()), { summarize: modelSummarizer(model), preamble });
        const loop = new LoopController({
          model,
          tools,
          context,
          sandbox,
          recorder: serviceRecorder(ctx.runId),
          budget: deps.budget,
          signal: controller.signal,
          // Outcomes: grade the result vs acceptance criteria and revise on fail.
          grader: hasAcceptanceCriteria(ctx.task.acceptanceCriteria) ? modelGrader(model, ctx) : undefined,
        });
        const outcome = await loop.run();
        // Persist what this run learned so future runs on the project recall it.
        if (projectId && outcome.summary) {
          await recordMemory({ projectId, kind: 'run-summary', content: outcome.summary, sourceRunId: ctx.runId }).catch(() => undefined);
        }
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
