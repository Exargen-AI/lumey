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

export interface RunRecorder {
  step(input: { type: RunStepType; title: string; detail?: string }): Promise<void>;
  transition(to: RunStatus, opts?: { summary?: string; error?: string }): Promise<void>;
}

export interface LoopBudget {
  /** Max model turns before the loop hands off to a human. Default 20. */
  readonly maxSteps?: number;
  /** Cumulative token ceiling (prompt + completion) before hand-off. Default 200_000. */
  readonly maxTokens?: number;
}

export interface LoopDeps {
  readonly model: ModelClient;
  readonly tools: ToolRunner;
  readonly context: ContextEngine;
  readonly sandbox: Sandbox;
  readonly recorder: RunRecorder;
  readonly budget?: LoopBudget;
  readonly signal?: AbortSignal;
}

export interface LoopOutcome {
  readonly status: RunStatus;
  readonly turns: number;
  readonly tokensUsed: number;
  readonly summary?: string;
}

const DEFAULT_BUDGET = { maxSteps: 20, maxTokens: 200_000 } as const;

/** Map a tool name to the run-step type that best describes it on the trace. */
function stepTypeForTool(name: string, args: string): RunStepType {
  if (name === 'write_file' || name === 'edit_file') return RunStepType.EDIT;
  if (name === 'bash') return /\b(test|vitest|jest|spec)\b/.test(args) ? RunStepType.TEST : RunStepType.COMMAND;
  return RunStepType.TOOL_CALL;
}

function firstLine(text: string, max = 80): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export class LoopController {
  private readonly d: LoopDeps;
  private readonly maxSteps: number;
  private readonly maxTokens: number;

  constructor(deps: LoopDeps) {
    this.d = deps;
    this.maxSteps = deps.budget?.maxSteps ?? DEFAULT_BUDGET.maxSteps;
    this.maxTokens = deps.budget?.maxTokens ?? DEFAULT_BUDGET.maxTokens;
  }

  async run(): Promise<LoopOutcome> {
    await this.d.recorder.transition(RunStatus.RUNNING);
    const transcript: ChatMessage[] = [];
    let tokensUsed = 0;
    let turns = 0;

    while (turns < this.maxSteps) {
      if (this.aborted()) return this.finishCancelled(turns, tokensUsed);
      turns++;

      const messages = await this.d.context.assemble(transcript);
      let response;
      try {
        response = await this.d.model.complete({ messages, tools: this.d.tools.list(), signal: this.d.signal });
      } catch (e) {
        if (this.aborted()) return this.finishCancelled(turns, tokensUsed);
        return this.finishFailed(turns, tokensUsed, e);
      }
      tokensUsed += response.usage.totalTokens;

      transcript.push({
        role: 'assistant',
        content: response.content,
        ...(response.toolCalls.length ? { toolCalls: response.toolCalls } : {}),
      });

      // No tool calls ⇒ the model has produced its final answer / review request.
      if (response.toolCalls.length === 0) {
        return this.finishAwaitingReview(turns, tokensUsed, response.content || 'Run complete; awaiting human review.');
      }

      if (response.content.trim()) {
        await this.d.recorder.step({ type: RunStepType.PLAN, title: firstLine(response.content), detail: response.content });
      }

      const results = await this.d.tools.runAll([...response.toolCalls], { sandbox: this.d.sandbox, signal: this.d.signal });
      await this.recordToolResults(response.toolCalls, results);
      results.forEach((r, i) => {
        transcript.push({ role: 'tool', content: r.content, toolCallId: response.toolCalls[i].id, name: r.name });
      });

      if (tokensUsed >= this.maxTokens) {
        return this.finishAwaitingReview(turns, tokensUsed, `Reached the token budget (${this.maxTokens}) after ${turns} turn(s); handing to human for review.`);
      }
    }

    return this.finishAwaitingReview(turns, tokensUsed, `Reached the ${this.maxSteps}-step ceiling; handing to human for review.`);
  }

  private async recordToolResults(calls: readonly ModelToolCall[], results: ToolResult[]): Promise<void> {
    for (let i = 0; i < results.length; i++) {
      const call = calls[i];
      const r = results[i];
      await this.d.recorder.step({
        type: stepTypeForTool(call.name, call.arguments),
        title: `${call.name}${r.ok ? '' : ' (failed)'}`,
        detail: firstLine(r.content, 200),
      });
    }
  }

  private aborted(): boolean {
    return this.d.signal?.aborted ?? false;
  }

  private async finishAwaitingReview(turns: number, tokensUsed: number, summary: string): Promise<LoopOutcome> {
    await this.d.recorder.step({ type: RunStepType.REVIEW_REQUEST, title: 'Request review', detail: firstLine(summary, 200) });
    await this.d.recorder.transition(RunStatus.AWAITING_REVIEW, { summary });
    return { status: RunStatus.AWAITING_REVIEW, turns, tokensUsed, summary };
  }

  private async finishFailed(turns: number, tokensUsed: number, error: unknown): Promise<LoopOutcome> {
    const message = error instanceof Error ? error.message : String(error);
    await this.d.recorder.transition(RunStatus.FAILED, { error: message });
    return { status: RunStatus.FAILED, turns, tokensUsed, summary: message };
  }

  private async finishCancelled(turns: number, tokensUsed: number): Promise<LoopOutcome> {
    await this.d.recorder.transition(RunStatus.CANCELLED, { summary: 'Run cancelled.' });
    return { status: RunStatus.CANCELLED, turns, tokensUsed };
  }
}
