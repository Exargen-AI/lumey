/**
 * 2026-05-23 — Layer 2 / agent control plane.
 *
 * Tests for the next-task picker. This endpoint is the heart of the
 * agent runtime's work loop, so getting selection right matters.
 *
 * Pinned invariants:
 *   - Agent-only (humans get 403)
 *   - Excludes DONE + IN_REVIEW statuses
 *   - Excludes isBlocked tasks
 *   - Excludes tasks with unsatisfied BLOCKS dependencies
 *   - Returns null when nothing is ready
 *   - Priority order P0 > P1 > P2 > P3
 *   - Active-sprint preference (tasks in the sprint outrank same-priority
 *     tasks not in the sprint)
 *   - dueDate tiebreaker (overdue first), createdAt stable tiebreaker
 *   - Rationale string explains the selection
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { ForbiddenError } from '../utils/errors';
import { getNextTaskForAgent } from './agentNextTask.service';

const AGENT_ID = 'agent-1';

function makeTask(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'task-1',
    taskNumber: overrides.taskNumber ?? 1,
    title: overrides.title ?? 'Task',
    description: overrides.description ?? null,
    status: overrides.status ?? 'TODO',
    priority: overrides.priority ?? 'P2',
    projectId: overrides.projectId ?? 'proj-1',
    sprintId: overrides.sprintId ?? null,
    dueDate: overrides.dueDate ?? null,
    storyPoints: overrides.storyPoints ?? null,
    // Default fixture is agent-ready: real agent-assigned tasks carry a
    // checkable definition of done. Tests override with [] to exercise the
    // Definition-of-Ready gate.
    acceptanceCriteria:
      overrides.acceptanceCriteria ?? [{ id: 'ac-1', text: 'Works as specified', done: false }],
    isBlocked: overrides.isBlocked ?? false,
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    project: overrides.project ?? { id: 'proj-1', slug: 'exargen' },
    linksTo: overrides.linksTo ?? [],
    linksFrom: overrides.linksFrom ?? [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getNextTaskForAgent — authorization', () => {
  it('refuses non-agent callers with ForbiddenError', async () => {
    await expect(getNextTaskForAgent(AGENT_ID, 'HUMAN')).rejects.toBeInstanceOf(ForbiddenError);
    // CRITICAL: must not query the DB on the auth failure path.
    expect(prismaMock.task.findMany).not.toHaveBeenCalled();
  });

  it('proceeds for agent callers', async () => {
    prismaMock.task.findMany.mockResolvedValue([] as any);
    prismaMock.sprint.findMany.mockResolvedValue([] as any);
    await getNextTaskForAgent(AGENT_ID, 'AGENT');
    expect(prismaMock.task.findMany).toHaveBeenCalled();
  });
});

describe('getNextTaskForAgent — empty / null-return cases', () => {
  it('returns null when the agent has no assigned tasks', async () => {
    prismaMock.task.findMany.mockResolvedValue([] as any);
    prismaMock.sprint.findMany.mockResolvedValue([] as any);
    const result = await getNextTaskForAgent(AGENT_ID, 'AGENT');
    expect(result).toBeNull();
  });

  it('queries Postgres with the right WHERE shape (assignee + actionable statuses + not blocked)', async () => {
    prismaMock.task.findMany.mockResolvedValue([] as any);
    prismaMock.sprint.findMany.mockResolvedValue([] as any);
    await getNextTaskForAgent(AGENT_ID, 'AGENT');
    const args = prismaMock.task.findMany.mock.calls[0]?.[0] as any;
    expect(args.where.assigneeId).toBe(AGENT_ID);
    expect(args.where.isBlocked).toBe(false);
    expect(args.where.status.in).toEqual(['BACKLOG', 'TODO', 'IN_PROGRESS']);
    // CRITICAL: must NOT include DONE or IN_REVIEW.
    expect(args.where.status.in).not.toContain('DONE');
    expect(args.where.status.in).not.toContain('IN_REVIEW');
  });

  it('returns null when every candidate has an unsatisfied BLOCKS dependency', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({
        id: 't1',
        linksTo: [
          // BLOCKS link: blocker is still IN_PROGRESS — dep unsatisfied.
          { type: 'BLOCKS', fromTask: { id: 'blocker', status: 'IN_PROGRESS' } },
        ],
      }),
    ] as any);
    prismaMock.sprint.findMany.mockResolvedValue([] as any);
    const result = await getNextTaskForAgent(AGENT_ID, 'AGENT');
    expect(result).toBeNull();
  });

  it('lets a task through when all its BLOCKS dependencies are DONE', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({
        id: 't-ready',
        linksTo: [
          { type: 'BLOCKS', fromTask: { id: 'blocker', status: 'DONE' } },
        ],
      }),
    ] as any);
    prismaMock.sprint.findMany.mockResolvedValue([] as any);
    const result = await getNextTaskForAgent(AGENT_ID, 'AGENT');
    expect(result?.task.id).toBe('t-ready');
  });

  it('skips a task with no acceptance criteria (Definition of Ready not met)', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ id: 't-unspecified', acceptanceCriteria: [] }),
    ] as any);
    prismaMock.sprint.findMany.mockResolvedValue([] as any);
    const result = await getNextTaskForAgent(AGENT_ID, 'AGENT');
    expect(result).toBeNull();
  });

  it('readiness overrides priority — a ready P2 beats an unspecified P0', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ id: 't-unspecified', priority: 'P0', acceptanceCriteria: [] }),
      makeTask({ id: 't-ready', priority: 'P2' }),
    ] as any);
    prismaMock.sprint.findMany.mockResolvedValue([] as any);
    const result = await getNextTaskForAgent(AGENT_ID, 'AGENT');
    expect(result?.task.id).toBe('t-ready');
  });
});

describe('getNextTaskForAgent — priority order', () => {
  it('picks the highest-priority task (P0 wins over P1, P1 over P2)', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ id: 't-p2', priority: 'P2' }),
      makeTask({ id: 't-p0', priority: 'P0' }),
      makeTask({ id: 't-p1', priority: 'P1' }),
    ] as any);
    prismaMock.sprint.findMany.mockResolvedValue([] as any);
    const result = await getNextTaskForAgent(AGENT_ID, 'AGENT');
    expect(result?.task.id).toBe('t-p0');
  });
});

describe('getNextTaskForAgent — active-sprint preference', () => {
  it('prefers a sprint-active task over a same-priority NON-sprint task', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ id: 't-out', priority: 'P1', sprintId: null }),
      makeTask({ id: 't-in', priority: 'P1', sprintId: 'sprint-active' }),
    ] as any);
    prismaMock.sprint.findMany.mockResolvedValue([
      { id: 'sprint-active', projectId: 'proj-1' },
    ] as any);

    const result = await getNextTaskForAgent(AGENT_ID, 'AGENT');
    expect(result?.task.id).toBe('t-in');
    expect(result?.rationale).toContain('in active sprint');
  });

  it('does NOT prefer a sprint-active task when the OTHER task is a higher priority', async () => {
    // P0 outside sprint should still beat P1 in sprint.
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ id: 't-in-p1', priority: 'P1', sprintId: 'sprint-active' }),
      makeTask({ id: 't-out-p0', priority: 'P0', sprintId: null }),
    ] as any);
    prismaMock.sprint.findMany.mockResolvedValue([
      { id: 'sprint-active', projectId: 'proj-1' },
    ] as any);
    const result = await getNextTaskForAgent(AGENT_ID, 'AGENT');
    expect(result?.task.id).toBe('t-out-p0');
  });
});

describe('getNextTaskForAgent — due-date tiebreaker', () => {
  it('overdue task wins over a same-priority not-yet-due task', async () => {
    const past = new Date('2025-01-01T00:00:00Z');
    const future = new Date('2027-01-01T00:00:00Z');
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ id: 't-future', priority: 'P1', dueDate: future }),
      makeTask({ id: 't-overdue', priority: 'P1', dueDate: past }),
    ] as any);
    prismaMock.sprint.findMany.mockResolvedValue([] as any);

    const result = await getNextTaskForAgent(AGENT_ID, 'AGENT');
    expect(result?.task.id).toBe('t-overdue');
    expect(result?.rationale).toContain('overdue');
  });

  it('null dueDate comes LAST (after dated tasks of same priority)', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ id: 't-no-date', priority: 'P1', dueDate: null }),
      makeTask({ id: 't-dated', priority: 'P1', dueDate: new Date('2026-06-01') }),
    ] as any);
    prismaMock.sprint.findMany.mockResolvedValue([] as any);

    const result = await getNextTaskForAgent(AGENT_ID, 'AGENT');
    expect(result?.task.id).toBe('t-dated');
  });
});

describe('getNextTaskForAgent — stable tiebreak', () => {
  it('uses createdAt ascending so two identical tasks deterministically pick the older one', async () => {
    const older = new Date('2026-01-01T00:00:00Z');
    const newer = new Date('2026-03-01T00:00:00Z');
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ id: 't-newer', priority: 'P2', createdAt: newer }),
      makeTask({ id: 't-older', priority: 'P2', createdAt: older }),
    ] as any);
    prismaMock.sprint.findMany.mockResolvedValue([] as any);

    const result = await getNextTaskForAgent(AGENT_ID, 'AGENT');
    expect(result?.task.id).toBe('t-older');
  });
});

describe('getNextTaskForAgent — response shape', () => {
  it('includes acceptance criteria + blockingTaskIds + projectSlug + rationale', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({
        id: 't1',
        priority: 'P0',
        acceptanceCriteria: [{ text: 'Tests added', done: false }],
        linksFrom: [
          { type: 'BLOCKS', toTaskId: 't-downstream-1' },
          { type: 'BLOCKS', toTaskId: 't-downstream-2' },
        ],
        project: { id: 'proj-1', slug: 'exargen-com' },
      }),
    ] as any);
    prismaMock.sprint.findMany.mockResolvedValue([] as any);

    const result = await getNextTaskForAgent(AGENT_ID, 'AGENT');
    expect(result?.task.acceptanceCriteria).toEqual([{ text: 'Tests added', done: false }]);
    expect(result?.task.blockingTaskIds).toEqual(['t-downstream-1', 't-downstream-2']);
    expect(result?.task.projectSlug).toBe('exargen-com');
    expect(result?.rationale).toContain('P0');
  });
});
