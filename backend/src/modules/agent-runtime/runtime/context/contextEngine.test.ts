import { describe, it, expect } from 'vitest';
import { ContextEngine } from './contextEngine';
import type { ChatMessage } from '../model/types';

const SYSTEM = 'SYSTEM PROMPT';
/** Count-based estimator: 1 token per message — makes budget tests exact. */
const byCount = (msgs: readonly ChatMessage[]) => msgs.length;

function users(n: number): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({ role: 'user', content: `m${i}` }) as ChatMessage);
}

describe('ContextEngine.assemble', () => {
  it('puts the stable system prompt first and passes a small transcript through', async () => {
    const eng = new ContextEngine(SYSTEM);
    const transcript = users(3);
    const out = await eng.assemble(transcript);
    expect(out[0]).toEqual({ role: 'system', content: SYSTEM });
    expect(out.slice(1)).toEqual(transcript);
    expect(eng.systemPrompt).toBe(SYSTEM);
  });

  it('keeps message[0] byte-identical as the transcript grows (prefix stability)', async () => {
    const eng = new ContextEngine(SYSTEM);
    const a = await eng.assemble(users(2));
    const b = await eng.assemble(users(20));
    expect(a[0]).toEqual(b[0]);
  });

  it('clips an oversized tool result with an elision marker', async () => {
    const eng = new ContextEngine(SYSTEM, { toolResultCap: 50 });
    const transcript: ChatMessage[] = [{ role: 'tool', content: 'x'.repeat(500), toolCallId: 'c1' }];
    const out = await eng.assemble(transcript);
    expect(out[1].content.length).toBeLessThan(500);
    expect(out[1].content).toContain('tool output elided');
  });

  it('compacts older turns when over budget, keeping the recent window', async () => {
    const eng = new ContextEngine(SYSTEM, { maxTokens: 5, keepRecent: 2, estimate: byCount });
    const out = await eng.assemble(users(10));
    expect(out[0].content).toBe(SYSTEM);
    expect(out[1].role).toBe('system');
    expect(out[1].content).toContain('8 earlier messages elided');
    // system + summary + 2 recent
    expect(out).toHaveLength(4);
    expect(out.at(-1)).toEqual({ role: 'user', content: 'm9' });
  });

  it('uses an injected summarizer when provided', async () => {
    const eng = new ContextEngine(SYSTEM, {
      maxTokens: 5,
      keepRecent: 2,
      estimate: byCount,
      summarize: async (older) => `CUSTOM(${older.length})`,
    });
    const out = await eng.assemble(users(10));
    expect(out[1].content).toContain('CUSTOM(8)');
  });

  it('never opens the kept window with an orphaned tool message', async () => {
    const eng = new ContextEngine(SYSTEM, { maxTokens: 3, keepRecent: 2, estimate: byCount });
    const transcript: ChatMessage[] = [
      ...users(5),
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }] },
      { role: 'tool', content: 'result', toolCallId: 'c1' },
      { role: 'user', content: 'next' },
    ];
    const out = await eng.assemble(transcript);
    const kept = out.slice(2); // after system + summary
    expect(kept[0].role).not.toBe('tool');
  });
});
