/**
 * ContextEngine — assembles the prompt for each model turn and keeps it within a
 * token budget. Token efficiency lives here; three levers, in order:
 *
 *   1. **Prefix-stable assembly** — the system prompt is byte-identical every
 *      turn and always message[0]; new material is *appended* to the transcript,
 *      never folded into the prefix. Stable leading bytes are what let prompt /
 *      KV caches hit instead of re-encoding the whole context each turn.
 *   2. **Context editing** — a single tool result can't dominate the window:
 *      oversized `tool` outputs are clipped to a cap with an elision marker.
 *   3. **Compaction** — when the assembled prompt would exceed the budget, the
 *      oldest turns are summarized into one note while the most recent turns are
 *      kept verbatim. The summarizer is pluggable (a model-backed one in the
 *      loop; a deterministic structural one by default, so this is testable
 *      without a model).
 *
 * Wire-safety: compaction never leaves an orphan `tool` message (one whose
 * `assistant` tool-call got summarized away) at the head of the kept window.
 */
import type { ChatMessage } from '../model/types';
import { estimateMessagesTokens } from './tokens';

export interface ContextEngineConfig {
  /** Token ceiling for the assembled prompt (leave headroom for the reply). Default 24_000. */
  readonly maxTokens?: number;
  /** Keep at least this many of the most recent transcript messages verbatim. Default 8. */
  readonly keepRecent?: number;
  /** Per-message char cap for `tool` results (context editing). Default 8_000. */
  readonly toolResultCap?: number;
  /** Optional model-backed summarizer for compaction; falls back to a structural summary. */
  readonly summarize?: (older: ChatMessage[]) => Promise<string>;
  /** Injectable token estimator (a real tokenizer can replace the heuristic). */
  readonly estimate?: (messages: readonly ChatMessage[]) => number;
  /**
   * Stable context inserted right after the system prompt and before the
   * transcript — e.g. recalled cross-run memories. Identical every turn within a
   * run (so still cache-friendly) and never compacted.
   */
  readonly preamble?: readonly ChatMessage[];
}

const DEFAULTS = { maxTokens: 24_000, keepRecent: 8, toolResultCap: 8_000 } as const;

export class ContextEngine {
  private readonly system: string;
  private readonly maxTokens: number;
  private readonly keepRecent: number;
  private readonly toolResultCap: number;
  private readonly summarize?: (older: ChatMessage[]) => Promise<string>;
  private readonly estimate: (messages: readonly ChatMessage[]) => number;
  private readonly preamble: readonly ChatMessage[];

  constructor(systemPrompt: string, cfg: ContextEngineConfig = {}) {
    this.system = systemPrompt;
    this.maxTokens = cfg.maxTokens ?? DEFAULTS.maxTokens;
    this.keepRecent = cfg.keepRecent ?? DEFAULTS.keepRecent;
    this.toolResultCap = cfg.toolResultCap ?? DEFAULTS.toolResultCap;
    this.summarize = cfg.summarize;
    this.estimate = cfg.estimate ?? estimateMessagesTokens;
    this.preamble = cfg.preamble ?? [];
  }

  /** The stable prefix — exposed so callers/tests can assert byte-stability. */
  get systemPrompt(): string {
    return this.system;
  }

  /** Build the message array for one model turn from the run transcript. */
  async assemble(transcript: readonly ChatMessage[]): Promise<ChatMessage[]> {
    const head: ChatMessage[] = [{ role: 'system', content: this.system }, ...this.preamble];
    const edited = transcript.map((m) => this.editToolResult(m));

    if (this.estimate([...head, ...edited]) <= this.maxTokens) {
      return [...head, ...edited];
    }

    const split = this.safeSplitIndex(edited);
    const older = edited.slice(0, split);
    const recent = edited.slice(split);
    if (older.length === 0) {
      return [...head, ...recent]; // nothing left to compact; best effort
    }

    const summaryText = this.summarize ? await this.summarize(older) : structuralSummary(older);
    const summaryMsg: ChatMessage = { role: 'system', content: `[Earlier progress, compacted to fit the context window]\n${summaryText}` };
    return [...head, summaryMsg, ...recent];
  }

  /** Clip an oversized tool result so no single output dominates the window. */
  private editToolResult(message: ChatMessage): ChatMessage {
    if (message.role !== 'tool' || message.content.length <= this.toolResultCap) return message;
    return { ...message, content: `${message.content.slice(0, this.toolResultCap)}\n…[tool output elided: ${message.content.length - this.toolResultCap} more chars]` };
  }

  /**
   * Index at which to cut older|recent. Starts at `len - keepRecent`, then moves
   * forward past any leading `tool` messages so the kept window never opens with
   * an orphaned tool result.
   */
  private safeSplitIndex(messages: ChatMessage[]): number {
    let split = Math.max(0, messages.length - this.keepRecent);
    while (split < messages.length && messages[split].role === 'tool') split++;
    return split;
  }
}

function structuralSummary(older: ChatMessage[]): string {
  const counts: Record<string, number> = {};
  let toolCalls = 0;
  for (const m of older) {
    counts[m.role] = (counts[m.role] ?? 0) + 1;
    toolCalls += m.toolCalls?.length ?? 0;
  }
  const roleSummary = Object.entries(counts)
    .map(([role, n]) => `${n} ${role}`)
    .join(', ');
  return `${older.length} earlier messages elided (${roleSummary}; ${toolCalls} tool call(s)). Continue from the most recent steps below.`;
}
