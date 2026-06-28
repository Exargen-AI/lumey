/**
 * LoopController — the agentic loop, the piece that turns four components into a
 * working agent. Each iteration is one model turn:
 *
 *   assemble context → model.complete → record the turn → run any tool calls →
 *   append results → repeat, until the model stops, the budget runs out, the
 *   run is cancelled, or the model errors terminally.
 *
 * It owns the **safety rails** — a step ceiling and a token budget (the circuit
 * breaker against a runaway loop), cooperative cancellation, and turning a
 * terminal model error into a FAILED run rather than a crash. Every turn and
 * every tool result maps to a RunStep through the injected `RunRecorder`, so the
 * loop is observable, costed, and lands the run in the right lifecycle state by
 * construction.
 *
 * The recorder is a seam: in production it writes through the run service; in
 * tests it collects calls, so the loop is verified end-to-end with a mock model
 * over a *real* sandbox + tools + context engine.
 */
import { RunStatus, RunStepType } from '@prisma/client';
import type { ModelClient, ChatMessage, ModelToolCall } from '../model/types';
import type { ToolRunner } from '../tools/toolRunner';
import type { ToolResult } from '../tools/types';
import type { ContextEngine } from '../context/contextEngine';
import type { Sandbox } from '../sandbox/sandbox';
import type { PauseController } from './pauseController';
import { ASK_HUMAN_TOOL } from '../tools/askHuman';

export interface RunUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface RunRecorder {
  step(input: { type: RunStepType; title: string; detail?: string }): Promise<void>;
  transition(to: RunStatus, opts?: { summary?: string; error?: string }): Promise<void>;
  usage(usage: RunUsage): Promise<void>;
}

export interface LoopBudget {
  /** Max model turns before the loop hands off to a human. Default 20. */
  readonly maxSteps?: number;
  /** Cumulative token ceiling (prompt + completion) before hand-off. Default 200_000. */
  readonly maxTokens?: number;
}

export interface OutcomeGrade {
  readonly passed: boolean;
  readonly feedback: string;
}

/** A human's verdict on a gated action (an approval request). */
export interface ApprovalDecision {
  readonly approved: boolean;
  /** Approver's note — especially the reason for a rejection (fed back to the agent). */
  readonly reason?: string;
}

/**
 * Grades the agent's final result against the task's done-criteria (Outcomes).
 * Injected by the adapter (which holds the acceptance criteria); the loop stays
 * criteria-agnostic.
 */
export type Grader = (finalAnswer: string, transcript: readonly ChatMessage[]) => Promise<OutcomeGrade>;

export interface LoopDeps {
  readonly model: ModelClient;
  readonly tools: ToolRunner;
  readonly context: ContextEngine;
  readonly sandbox: Sandbox;
  readonly recorder: RunRecorder;
  readonly budget?: LoopBudget;
  readonly signal?: AbortSignal;
  /**
   * When set, the loop parks at each turn boundary while the controller is
   * paused — a human suspend/resume that keeps the transcript + sandbox alive.
   */
  readonly pause?: PauseController;
  /**
   * When set, the agent may call `ask_human`: the loop opens a clarification,
   * parks the run on AWAITING_INPUT, and resumes with the returned answer
   * injected as the tool result. Resolves `null` if cancelled while waiting.
   */
  readonly clarify?: (question: string, signal?: AbortSignal) => Promise<string | null>;
  /**
   * Predicate: does a call to this tool need human approval before it runs?
   * Paired with {@link approve}; if either is missing, no action is gated.
   */
  readonly requiresApproval?: (toolName: string) => boolean;
  /**
   * Request human approval for a gated action: opens an approval, parks the run
   * on AWAITING_INPUT, and resolves the human's decision (or `null` if cancelled
   * while waiting). On approve the loop runs the action; on reject it refuses and
   * feeds the reason back to the agent.
   */
  readonly approve?: (request: { action: string; summary: string; detail?: string }, signal?: AbortSignal) => Promise<ApprovalDecision | null>;
  /**
   * Per-agent policy gate: return false for a tool the agent is not allowed to
   * use. A denied call is refused with an `ok:false` result the agent reads (it
   * never reaches the sandbox). Defence-in-depth — the adapter also filters the
   * advertised toolset, so a well-behaved model won't call a denied tool.
   */
  readonly isToolAllowed?: (toolName: string) => boolean;
  /** When set, grade the final result and revise on failure (Outcomes). */
  readonly grader?: Grader;
  /** Max grade→revise cycles before handing off to a human. Default 2. */
  readonly maxRevisions?: number;
}

export interface LoopOutcome {
  readonly status: RunStatus;
  readonly turns: number;
  readonly tokensUsed: number;
  readonly summary?: string;
}

const DEFAULT_BUDGET = { maxSteps: 20, maxTokens: 200_000 } as const;
const DEFAULT_MAX_REVISIONS = 2;
/** Sentinel prefix on a policy-denied tool result, so the trace can label it clearly. */
const POLICY_BLOCK_PREFIX = 'Blocked by agent policy:';

/** Map a tool name to the run-step type that best describes it on the trace. */
function stepTypeForTool(name: string, args: string): RunStepType {
  if (name === 'write_file' || name === 'edit_file') return RunStepType.EDIT;
  if (name === 'run_tests') return RunStepType.TEST;
  if (name === 'open_pr') return RunStepType.REVIEW_REQUEST;
  if (name === 'git_commit') return RunStepType.COMMAND;
  if (name === 'bash') return /\b(test|vitest|jest|spec)\b/.test(args) ? RunStepType.TEST : RunStepType.COMMAND;
  return RunStepType.TOOL_CALL;
}

function firstLine(text: string, max = 80): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/** Pull the `question` out of an `ask_human` call's raw JSON args, defensively. */
function parseAskQuestion(rawArgs: string): string {
  try {
    const parsed = JSON.parse(rawArgs || '{}') as { question?: unknown };
    const q = typeof parsed.question === 'string' ? parsed.question.trim() : '';
    return q || 'The agent requested human input but provided no question.';
  } catch {
    return 'The agent requested human input but its question could not be parsed.';
  }
}

/** A human-readable one-liner of what a gated tool call wants to do (for the approval card). */
function approvalSummary(call: ModelToolCall): string {
  try {
    const args = JSON.parse(call.arguments || '{}') as Record<string, unknown>;
    if (typeof args.title === 'string' && args.title.trim()) return `${call.name}: ${args.title.trim()}`;
  } catch {
    /* fall through to the raw-args form */
  }
  return `${call.name} ${firstLine(call.arguments || '', 120)}`.trim();
}

export class LoopController {
  private readonly d: LoopDeps;
  private readonly maxSteps: number;
  private readonly maxTokens: number;
  private readonly maxRevisions: number;

  constructor(deps: LoopDeps) {
    this.d = deps;
    this.maxSteps = deps.budget?.maxSteps ?? DEFAULT_BUDGET.maxSteps;
    this.maxTokens = deps.budget?.maxTokens ?? DEFAULT_BUDGET.maxTokens;
    this.maxRevisions = deps.maxRevisions ?? DEFAULT_MAX_REVISIONS;
  }

  async run(): Promise<LoopOutcome> {
    await this.d.recorder.transition(RunStatus.RUNNING);
    const transcript: ChatMessage[] = [];
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let turns = 0;
    let revisions = 0;

    while (turns < this.maxSteps) {
      if (this.aborted()) return this.finishCancelled(turns, usage);
      // Turn boundary: if a human has paused this run, park here (transcript and
      // sandbox stay live) until resumed — or until a cancel aborts the wait,
      // which the abort re-check below then turns into a clean CANCELLED.
      await this.d.pause?.waitWhilePaused(this.d.signal);
      if (this.aborted()) return this.finishCancelled(turns, usage);
      turns++;

      const messages = await this.d.context.assemble(transcript);
      let response;
      try {
        response = await this.d.model.complete({ messages, tools: this.d.tools.list(), signal: this.d.signal });
      } catch (e) {
        if (this.aborted()) return this.finishCancelled(turns, usage);
        return this.finishFailed(turns, usage, e);
      }
      usage.inputTokens += response.usage.promptTokens;
      usage.outputTokens += response.usage.completionTokens;
      usage.totalTokens += response.usage.totalTokens;

      transcript.push({
        role: 'assistant',
        content: response.content,
        ...(response.toolCalls.length ? { toolCalls: response.toolCalls } : {}),
      });

      // No tool calls ⇒ the model has produced its final answer / review request.
      if (response.toolCalls.length === 0) {
        if (this.d.grader) {
          const grade = await this.d.grader(response.content, transcript);
          await this.d.recorder.step({
            type: RunStepType.TEST,
            title: `Self-grade vs acceptance criteria: ${grade.passed ? 'pass' : 'revise'}`,
            detail: firstLine(grade.feedback, 200),
          });
          if (!grade.passed && revisions < this.maxRevisions) {
            revisions++;
            transcript.push({
              role: 'user',
              content: `Your result does not yet satisfy the acceptance criteria. ${grade.feedback}\nRevise the work and continue.`,
            });
            continue; // iterate → grade → revise
          }
          const summary = grade.passed
            ? response.content || 'Run complete; awaiting human review.'
            : `${response.content}\n\n[Outcome grading: handed to human after ${revisions} revision attempt(s) — ${firstLine(grade.feedback, 160)}]`;
          return this.finishAwaitingReview(turns, usage, summary);
        }
        return this.finishAwaitingReview(turns, usage, response.content || 'Run complete; awaiting human review.');
      }

      if (response.content.trim()) {
        await this.d.recorder.step({ type: RunStepType.PLAN, title: firstLine(response.content), detail: response.content });
      }

      // Human-in-the-loop: if the agent asked a question this turn, park on it
      // (record it, park AWAITING_INPUT, resume with the answer) instead of
      // dispatching tools to the sandbox.
      const askCall = this.d.clarify ? response.toolCalls.find((c) => c.name === ASK_HUMAN_TOOL) : undefined;
      if (askCall) {
        const cancelled = await this.handleClarification(response.toolCalls, askCall, transcript, turns, usage);
        if (cancelled) return cancelled;
        continue;
      }

      const gated = await this.runTools(response.toolCalls, turns, usage);
      if (!Array.isArray(gated)) return gated; // cancelled during an approval wait
      const results = gated;
      await this.recordToolResults(response.toolCalls, results);
      results.forEach((r, i) => {
        transcript.push({ role: 'tool', content: r.content, toolCallId: response.toolCalls[i].id, name: r.name });
      });

      if (usage.totalTokens >= this.maxTokens) {
        return this.finishAwaitingReview(turns, usage, `Reached the token budget (${this.maxTokens}) after ${turns} turn(s); handing to human for review.`);
      }
    }

    return this.finishAwaitingReview(turns, usage, `Reached the ${this.maxSteps}-step ceiling; handing to human for review.`);
  }

  /**
   * Park the run on an agent-raised question. Records the ask, transitions to
   * AWAITING_INPUT, and awaits the human answer (via the injected `clarify`
   * gate). On answer: transitions back to RUNNING and injects the answer as the
   * `ask_human` tool result so the model continues with it in context. On a
   * cancel while waiting (`null`): finishes the run CANCELLED.
   *
   * Every tool call this turn still needs a matching result or the transcript is
   * invalid, so any sibling calls made alongside `ask_human` are answered with a
   * deferral note (the model re-issues them next turn).
   */
  private async handleClarification(
    calls: readonly ModelToolCall[],
    askCall: ModelToolCall,
    transcript: ChatMessage[],
    turns: number,
    usage: RunUsage,
  ): Promise<LoopOutcome | null> {
    const question = parseAskQuestion(askCall.arguments);
    await this.d.recorder.step({ type: RunStepType.TOOL_CALL, title: 'ask_human', detail: firstLine(question, 200) });
    await this.d.recorder.transition(RunStatus.AWAITING_INPUT, { summary: firstLine(question, 200) });

    const answer = await this.d.clarify!(question, this.d.signal);
    if (answer === null) return this.finishCancelled(turns, usage); // cancelled while waiting

    await this.d.recorder.step({ type: RunStepType.PLAN, title: 'Human answered', detail: firstLine(answer, 200) });
    await this.d.recorder.transition(RunStatus.RUNNING);

    for (const call of calls) {
      transcript.push({
        role: 'tool',
        content: call === askCall ? answer : 'Deferred: a human clarification was pending. Re-issue this call now that it is answered.',
        toolCallId: call.id,
        name: call.name,
      });
    }
    return null;
  }

  /**
   * Run a turn's tool calls in order, gating any that need human approval. A
   * gated call parks the run on AWAITING_INPUT until a human decides: approve →
   * the call runs normally; reject → it is refused with an `ok:false` result the
   * agent reads and reacts to (no retry); cancel-while-waiting → the run ends
   * CANCELLED (returned as a LoopOutcome so the caller stops the loop). Ungated
   * calls run straight through.
   */
  private async runTools(calls: readonly ModelToolCall[], turns: number, usage: RunUsage): Promise<ToolResult[] | LoopOutcome> {
    const ctx = { sandbox: this.d.sandbox, signal: this.d.signal };
    const results: ToolResult[] = [];
    for (const call of calls) {
      // Policy gate first — a denied tool never runs and never needs approval.
      if (this.d.isToolAllowed && !this.d.isToolAllowed(call.name)) {
        results.push({
          callId: call.id,
          name: call.name,
          ok: false,
          content: `${POLICY_BLOCK_PREFIX} "${call.name}" is not in this agent's allowed tools. Use a permitted tool or stop and request review.`,
          durationMs: 0,
        });
        continue;
      }
      if (this.d.approve && this.d.requiresApproval?.(call.name)) {
        const decision = await this.handleApproval(call);
        if (decision === null) return this.finishCancelled(turns, usage); // cancelled while waiting
        if (!decision.approved) {
          results.push({
            callId: call.id,
            name: call.name,
            ok: false,
            content: `Human rejected this action${decision.reason ? `: ${decision.reason}` : ''}. Do not retry it; choose another approach or stop and request review.`,
            durationMs: 0,
          });
          continue;
        }
        // approved — fall through and run the action
      }
      results.push(await this.d.tools.run(call, ctx));
    }
    return results;
  }

  /**
   * Park the run on a human approval for a gated action. Records the request,
   * transitions AWAITING_INPUT, and awaits the decision via the injected
   * `approve` gate; on a decision, transitions back to RUNNING and returns it.
   * Returns `null` if the run was cancelled while waiting.
   */
  private async handleApproval(call: ModelToolCall): Promise<ApprovalDecision | null> {
    const summary = approvalSummary(call);
    await this.d.recorder.step({ type: RunStepType.REVIEW_REQUEST, title: `Approval requested: ${call.name}`, detail: firstLine(summary, 200) });
    await this.d.recorder.transition(RunStatus.AWAITING_INPUT, { summary: `Approval requested — ${firstLine(summary, 160)}` });

    const decision = await this.d.approve!({ action: call.name, summary, detail: call.arguments }, this.d.signal);
    if (decision === null) return null; // cancelled while waiting

    await this.d.recorder.step({
      type: RunStepType.PLAN,
      title: decision.approved ? 'Approved' : 'Rejected',
      ...(decision.reason ? { detail: firstLine(decision.reason, 200) } : {}),
    });
    await this.d.recorder.transition(RunStatus.RUNNING);
    return decision;
  }

  private async recordToolResults(calls: readonly ModelToolCall[], results: ToolResult[]): Promise<void> {
    for (let i = 0; i < results.length; i++) {
      const call = calls[i];
      const r = results[i];
      // A policy-denied call gets an unmistakable trace label, not "x (failed)".
      const blocked = !r.ok && r.content.startsWith(POLICY_BLOCK_PREFIX);
      await this.d.recorder.step({
        type: stepTypeForTool(call.name, call.arguments),
        title: blocked ? `Blocked by policy: ${call.name}` : `${call.name}${r.ok ? '' : ' (failed)'}`,
        detail: firstLine(r.content, 200),
      });
    }
  }

  private aborted(): boolean {
    return this.d.signal?.aborted ?? false;
  }

  private async finishAwaitingReview(turns: number, usage: RunUsage, summary: string): Promise<LoopOutcome> {
    await this.d.recorder.step({ type: RunStepType.REVIEW_REQUEST, title: 'Request review', detail: firstLine(summary, 200) });
    await this.d.recorder.usage(usage);
    await this.d.recorder.transition(RunStatus.AWAITING_REVIEW, { summary });
    return { status: RunStatus.AWAITING_REVIEW, turns, tokensUsed: usage.totalTokens, summary };
  }

  private async finishFailed(turns: number, usage: RunUsage, error: unknown): Promise<LoopOutcome> {
    const message = error instanceof Error ? error.message : String(error);
    await this.d.recorder.usage(usage);
    await this.d.recorder.transition(RunStatus.FAILED, { error: message });
    return { status: RunStatus.FAILED, turns, tokensUsed: usage.totalTokens, summary: message };
  }

  private async finishCancelled(turns: number, usage: RunUsage): Promise<LoopOutcome> {
    await this.d.recorder.usage(usage);
    await this.d.recorder.transition(RunStatus.CANCELLED, { summary: 'Run cancelled.' });
    return { status: RunStatus.CANCELLED, turns, tokensUsed: usage.totalTokens };
  }
}
