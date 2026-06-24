import { describe, it, expect } from 'vitest';
import { evaluateAgentReadiness } from './taskReadiness';

describe('evaluateAgentReadiness', () => {
  it('is ready when at least one acceptance criterion has text', () => {
    const r = evaluateAgentReadiness({
      acceptanceCriteria: [{ id: 'a', text: 'Login returns a JWT', done: false }],
    });
    expect(r.ready).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('is not ready when there are no acceptance criteria', () => {
    const r = evaluateAgentReadiness({ acceptanceCriteria: [] });
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/definition of done/i);
  });

  it('is not ready when every criterion is blank/whitespace', () => {
    const r = evaluateAgentReadiness({
      acceptanceCriteria: [
        { id: 'a', text: '   ', done: false },
        { id: 'b', text: '', done: true },
      ],
    });
    expect(r.ready).toBe(false);
  });

  it('is ready if any one criterion has text amongst blanks', () => {
    const r = evaluateAgentReadiness({
      acceptanceCriteria: [
        { id: 'a', text: '', done: false },
        { id: 'b', text: 'Handles the empty case', done: false },
      ],
    });
    expect(r.ready).toBe(true);
  });

  it('fails closed (not ready) on a malformed, non-array value', () => {
    expect(evaluateAgentReadiness({ acceptanceCriteria: null }).ready).toBe(false);
    expect(evaluateAgentReadiness({ acceptanceCriteria: 'oops' }).ready).toBe(false);
    expect(evaluateAgentReadiness({ acceptanceCriteria: { text: 'x' } }).ready).toBe(false);
  });

  it('ignores array entries that are not well-formed criteria', () => {
    const r = evaluateAgentReadiness({
      acceptanceCriteria: [null, 42, { nope: true }, { text: 123 }],
    });
    expect(r.ready).toBe(false);
  });
});
