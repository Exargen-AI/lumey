import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateMessageTokens, estimateMessagesTokens } from './tokens';
import type { ChatMessage } from '../model/types';

describe('estimateTokens', () => {
  it('is zero for empty and ~chars/4 otherwise, rounding up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2); // 5/4 → ceil 2
  });

  it('grows monotonically with length', () => {
    expect(estimateTokens('x'.repeat(400))).toBeGreaterThan(estimateTokens('x'.repeat(40)));
  });
});

describe('estimateMessageTokens', () => {
  it('adds per-message overhead and counts tool-call name + arguments', () => {
    const plain: ChatMessage = { role: 'user', content: 'abcd' }; // 1 + 4 overhead
    expect(estimateMessageTokens(plain)).toBe(5);
    const withTool: ChatMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"a"}' }],
    };
    expect(estimateMessageTokens(withTool)).toBeGreaterThan(4);
  });
});

describe('estimateMessagesTokens', () => {
  it('sums across messages', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'abcd' },
      { role: 'assistant', content: 'abcd' },
    ];
    expect(estimateMessagesTokens(msgs)).toBe(estimateMessageTokens(msgs[0]) + estimateMessageTokens(msgs[1]));
  });
});
