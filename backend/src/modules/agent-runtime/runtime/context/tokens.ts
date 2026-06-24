/**
 * Token estimation. We don't ship a tokenizer dependency for what is, in the
 * loop, a *budgeting* decision — a fast, slightly-conservative heuristic is the
 * right tradeoff and is injectable, so a real tokenizer can replace it later
 * without touching the ContextEngine.
 *
 * The ~4-chars-per-token rule is the well-known BPE approximation for English
 * source text + prose; we round up and add a small per-message overhead so the
 * estimate errs toward *over*-counting (compact early rather than overflow).
 */
import type { ChatMessage } from '../model/types';

const CHARS_PER_TOKEN = 4;
const PER_MESSAGE_OVERHEAD = 4; // role/formatting framing the wire adds per message

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(message: ChatMessage): number {
  let total = PER_MESSAGE_OVERHEAD + estimateTokens(message.content);
  for (const call of message.toolCalls ?? []) {
    total += estimateTokens(call.name) + estimateTokens(call.arguments);
  }
  return total;
}

export function estimateMessagesTokens(messages: readonly ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}
