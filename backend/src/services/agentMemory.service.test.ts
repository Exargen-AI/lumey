import './../test/prismaMock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { recordMemory, recallMemories, projectIdForTask } from './agentMemory.service';

beforeEach(() => vi.clearAllMocks());

describe('recordMemory', () => {
  it('creates a memory with trimmed content and a default sourceRunId', async () => {
    prismaMock.agentMemory.create.mockResolvedValue({ id: 'm1' } as never);
    await recordMemory({ projectId: 'p1', kind: 'run-summary', content: '  did a thing  ' });
    expect(prismaMock.agentMemory.create).toHaveBeenCalledWith({
      data: { projectId: 'p1', kind: 'run-summary', content: 'did a thing', sourceRunId: null },
    });
  });

  it('skips empty content (nothing worth remembering)', async () => {
    expect(await recordMemory({ projectId: 'p1', kind: 'x', content: '   ' })).toBeNull();
    expect(prismaMock.agentMemory.create).not.toHaveBeenCalled();
  });

  it('stores a semantic embedding when provided', async () => {
    prismaMock.agentMemory.create.mockResolvedValue({ id: 'm1' } as never);
    await recordMemory({ projectId: 'p1', kind: 'run-summary', content: 'did X', embedding: [0.1, 0.2] });
    expect(prismaMock.agentMemory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ embedding: [0.1, 0.2] }),
    });
  });
});

describe('recallMemories (semantic RAG)', () => {
  it('ranks candidates by cosine similarity to the query embedding', async () => {
    prismaMock.agentMemory.findMany.mockResolvedValue([
      { id: 'far', content: 'far', embedding: [0, 1] },
      { id: 'near', content: 'near', embedding: [1, 0] },
      { id: 'mid', content: 'mid', embedding: [0.8, 0.2] },
    ] as never);
    const out = await recallMemories('p1', { queryEmbedding: [1, 0], limit: 2 });
    expect(out.map((m: { id: string }) => m.id)).toEqual(['near', 'mid']);
  });

  it('falls back to recency when no candidate has an embedding yet', async () => {
    prismaMock.agentMemory.findMany.mockResolvedValue([
      { id: 'a', content: 'a', embedding: null },
      { id: 'b', content: 'b', embedding: null },
    ] as never);
    const out = await recallMemories('p1', { queryEmbedding: [1, 0], limit: 1 });
    expect(out.map((m: { id: string }) => m.id)).toEqual(['a']); // newest-first slice
  });
});

describe('recallMemories', () => {
  it('returns the most recent memories for a project', async () => {
    prismaMock.agentMemory.findMany.mockResolvedValue([{ id: 'm1' }] as never);
    await recallMemories('p1', { limit: 5 });
    expect(prismaMock.agentMemory.findMany).toHaveBeenCalledWith({
      where: { projectId: 'p1' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  });

  it('defaults the limit to 10', async () => {
    prismaMock.agentMemory.findMany.mockResolvedValue([] as never);
    await recallMemories('p1');
    expect(prismaMock.agentMemory.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
  });
});

describe('projectIdForTask', () => {
  it('returns the task project id', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ projectId: 'p9' } as never);
    expect(await projectIdForTask('t1')).toBe('p9');
  });

  it('returns null for a missing task', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null as never);
    expect(await projectIdForTask('nope')).toBeNull();
  });
});
