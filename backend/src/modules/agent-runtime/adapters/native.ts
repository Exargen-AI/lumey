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
import { LoopController, type LoopBudget, type RunRecorder, type Grader, type ApprovalDecision } from '../runtime/loop/loopController';
import { PauseController } from '../runtime/loop/pauseController';
import { ClarificationController } from '../runtime/loop/clarificationController';
import { Rendezvous } from '../runtime/loop/rendezvous';
import { askHumanTool } from '../runtime/tools/askHuman';
import { createClarification, cancelOpenClarificationsForRun } from '../../../services/runClarification.service';
import { createApproval, cancelOpenApprovalsForRun } from '../../../services/runApproval.service';
import { ContextEngine } from '../runtime/context/contextEngine';
import { buildSystemPrompt } from '../runtime/context/systemPrompt';
import { ToolRunner } from '../runtime/tools/toolRunner';
import { defaultTools } from '../runtime/tools/builtins';
import { createRunTestsTool, createGitCommitTool, createOpenPrTool } from '../runtime/tools/finalize';
import { createDelegateTool } from '../runtime/tools/delegate';
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
import { embeddingClientFromEnv, type EmbeddingClient } from '../runtime/model/embeddingClient';
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

/**
 * The lead agent's toolset: coding tools, run-scoped finalize tools, and
 * `delegate` (multi-agent — hub-and-spoke). Workers get only the coding tools
 * (no finalize, no `delegate`), so they can't open PRs or recurse.
 */
async function defaultRunTools(ctx: RunContext, sandbox: Sandbox, model: ModelClient): Promise<ToolRunner> {
  const branch = `lumey/run-${ctx.runId}`;
  const { provider, base } = await resolveGitProviderAndBase(ctx, sandbox);
  return new ToolRunner([
    ...defaultTools(),
    askHumanTool, // HITL: the lead may ask a human and park (loop-intercepted)
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
    createDelegateTool({ model, makeSubTools: () => new ToolRunner(defaultTools()) }),
  ]);
}

/** Lazily build the local embedding client from env (once); null if unconfigured. */
let embedder: EmbeddingClient | null | undefined;
function getEmbedder(): EmbeddingClient | null {
  if (embedder !== undefined) return embedder;
  embedder = embeddingClientFromEnv();
  return embedder;
}

/** Embed text with the local model, degrading to undefined on any failure. */
async function embedText(text: string): Promise<number[] | undefined> {
  const client = getEmbedder();
  if (!client) return undefined;
  try {
    return await client.embed(text);
  } catch (err) {
    logger.warn({ err }, '[agent-runtime] embedding failed; falling back to recency recall');
    return undefined;
  }
}

/**
 * Recalled cross-run memories as a stable context preamble (RAG). Semantic when
 * an embedding model is configured (rank by similarity to the task), else recency.
 */
async function memoryPreamble(projectId: string, queryText: string): Promise<ChatMessage[]> {
  const queryEmbedding = await embedText(queryText);
  const memories = await recallMemories(projectId, { limit: 8, queryEmbedding });
  if (!memories.length) return [];
  const body = memories.map((m) => `- ${m.content}`).join('\n');
  return [{ role: 'system', content: `Learnings from prior runs on this project (most relevant first):\n${body}` }];
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

/**
 * Which tool calls require human approval before they run, from
 * `LUMEY_APPROVAL_TOOLS` (comma-separated). Defaults to `open_pr` — a PR is an
 * outward action, so "human stays in control" is the safe default. Set the env
 * to a different list, or to an empty string to disable the gate entirely.
 */
function approvalRequiredTools(): ReadonlySet<string> {
  const raw = process.env.LUMEY_APPROVAL_TOOLS;
  if (raw === undefined) return new Set(['open_pr']);
  return new Set(raw.split(',').map((t) => t.trim()).filter(Boolean));
}

export function createNativeAdapter(deps: NativeAdapterDeps): RuntimeAdapter {
  const inflight = new Map<string, AbortController>();
  // One pause handle per in-flight run, parallel to its AbortController. pause()
  // and resume() reach the *live* loop through this; the orchestrator owns the
  // matching DB transition.
  const pauses = new Map<string, PauseController>();
  // One clarification rendezvous per in-flight run — the channel a human's
  // answer travels to reach the parked loop.
  const clarifyGates = new Map<string, ClarificationController>();
  // One approval rendezvous per in-flight run — the channel a human's decision
  // travels to reach a loop parked on a gated action.
  const approvalGates = new Map<string, Rendezvous<ApprovalDecision>>();
  const approvalTools = approvalRequiredTools();

  return {
    id: 'native',

    capabilities: () => ({
      selfHosted: true, // runs anywhere this process runs, including air-gapped
      memory: true, // recalls + records cross-run project memory
      outcomes: true, // grades the result vs acceptance criteria and revises
      multiAgent: true, // the lead can delegate focused subtasks to sub-agents
    }),

    async execute(ctx) {
      const controller = new AbortController();
      inflight.set(ctx.runId, controller);
      const pause = new PauseController();
      pauses.set(ctx.runId, pause);
      const clarifyGate = new ClarificationController();
      clarifyGates.set(ctx.runId, clarifyGate);
      const approvalGate = new Rendezvous<ApprovalDecision>();
      approvalGates.set(ctx.runId, approvalGate);
      let sandbox: Sandbox | undefined;
      try {
        const model = deps.modelFactory(); // throws if no model configured
        const projectId = await projectIdForTask(ctx.taskId);
        sandbox = await (deps.sandboxFactory ?? repoAwareSandbox)(ctx);
        const tools = deps.toolsFactory ? deps.toolsFactory() : await defaultRunTools(ctx, sandbox, model);
        const queryText = [ctx.task.title, ctx.task.description ?? ''].join('\n').trim();
        const preamble = projectId ? await memoryPreamble(projectId, queryText) : [];
        const context = new ContextEngine(buildSystemPrompt(ctx, tools.list()), { summarize: modelSummarizer(model), preamble });
        const loop = new LoopController({
          model,
          tools,
          context,
          sandbox,
          recorder: serviceRecorder(ctx.runId),
          budget: deps.budget,
          signal: controller.signal,
          pause, // honour human suspend/resume at turn boundaries
          // HITL: persist the question, then park on the in-memory gate until a
          // human answers (or the run is cancelled, which resolves null).
          clarify: async (question, signal) => {
            await createClarification({ runId: ctx.runId, taskId: ctx.taskId, question });
            return clarifyGate.wait(signal);
          },
          // HITL approval gate: hold any high-risk tool call for a human OK.
          requiresApproval: (tool) => approvalTools.has(tool),
          approve: async (request, signal) => {
            await createApproval({ runId: ctx.runId, taskId: ctx.taskId, action: request.action, summary: request.summary, detail: request.detail });
            return approvalGate.wait(signal);
          },

          // Outcomes: grade the result vs acceptance criteria and revise on fail.
          grader: hasAcceptanceCriteria(ctx.task.acceptanceCriteria) ? modelGrader(model, ctx) : undefined,
        });
        const outcome = await loop.run();
        // Persist what this run learned (with its embedding) so future runs recall it.
        if (projectId && outcome.summary) {
          const embedding = await embedText(outcome.summary);
          await recordMemory({ projectId, kind: 'run-summary', content: outcome.summary, sourceRunId: ctx.runId, embedding }).catch(() => undefined);
        }
      } catch (e) {
        await failRun(ctx.runId, e); // a setup error before the loop transitioned RUNNING
      } finally {
        inflight.delete(ctx.runId);
        pauses.delete(ctx.runId);
        clarifyGates.delete(ctx.runId);
        approvalGates.delete(ctx.runId);
        // Close any question/approval still open when the run stops (e.g.
        // cancelled while waiting) so the trace/inbox never shows a live
        // checkpoint on a dead run.
        await cancelOpenClarificationsForRun(ctx.runId).catch(() => undefined);
        await cancelOpenApprovalsForRun(ctx.runId).catch(() => undefined);
        if (sandbox) await sandbox.dispose();
      }
    },

    async cancel(runId) {
      const controller = inflight.get(runId);
      if (controller) {
        // Resume first so a *paused* loop unparks and can observe the abort —
        // otherwise it would sit waiting forever and never reach CANCELLED.
        pauses.get(runId)?.resume();
        controller.abort(); // in-flight: the loop transitions CANCELLED at its next checkpoint
        return;
      }
      const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { status: true } });
      if (run && !isTerminal(run.status)) {
        await transitionRun(runId, RunStatus.CANCELLED);
      }
    },

    // Reach the live loop's PauseController. The orchestrator has already checked
    // the run is genuinely in-flight here and owns the DB transition; these just
    // flip the in-memory flag the loop parks on.
    async pause(runId) {
      pauses.get(runId)?.pause();
    },

    async resume(runId) {
      pauses.get(runId)?.resume();
    },

    // Deliver a human's answer to the parked loop. Returns false if no loop is
    // actually waiting (so the orchestrator can report that honestly).
    async answerClarification(runId, answer) {
      return clarifyGates.get(runId)?.answer(answer) ?? false;
    },

    // Deliver a human's approval decision to the parked loop.
    async resolveApproval(runId, decision) {
      return approvalGates.get(runId)?.settle(decision) ?? false;
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
