import { describe, it, expect } from 'vitest';
import {
  applyKanbanFilters,
  isAnyFilterActive,
  EMPTY_FILTERS,
  type KanbanFilters,
} from './KanbanFilterChips';

/**
 * 2026-05-21: Pankaj asked for a per-user assignee picker (replaces the
 * coarse "mine / unassigned / everyone" axis with a real filter). These
 * tests pin the new logic:
 *
 *   - assigneeId wins over mine + unassigned when set
 *   - clearing mine + unassigned when assigneeId fires (UX axis-switch)
 *   - the AND-across-categories / OR-within-category contract is unchanged
 *
 * Pure function, fast unit test — covers every branch of the new logic
 * without booting React, the DB, or the dev server.
 */

const ME = 'me-id';
const VIJAY = 'vijay-id';

function makeTask(overrides: Partial<{ assigneeId: string | null; priority: string; isBlocked: boolean }>): any {
  return {
    id: 't-' + Math.random().toString(36).slice(2, 8),
    assigneeId: overrides.assigneeId ?? null,
    priority: overrides.priority ?? 'P2',
    isBlocked: overrides.isBlocked ?? false,
    // Default status: not DONE, so existing tests aren't broken by the
    // new "hide DONE on assignee filter" rule.
    status: 'IN_PROGRESS',
  };
}

function makeTaskWithStatus(overrides: Partial<{
  assigneeId: string | null; priority: string; isBlocked: boolean; status: string;
}>): any {
  return {
    ...makeTask(overrides),
    status: overrides.status ?? 'IN_PROGRESS',
  };
}

describe('applyKanbanFilters — baseline (no filters active)', () => {
  it('passes every task through when no filter is set', () => {
    const t = makeTask({});
    expect(applyKanbanFilters(t, EMPTY_FILTERS, ME)).toBe(true);
  });
});

describe('applyKanbanFilters — mine + unassigned (legacy axis)', () => {
  it('shows only my tasks when mine=true', () => {
    const filters: KanbanFilters = { ...EMPTY_FILTERS, mine: true };
    expect(applyKanbanFilters(makeTask({ assigneeId: ME }), filters, ME)).toBe(true);
    expect(applyKanbanFilters(makeTask({ assigneeId: VIJAY }), filters, ME)).toBe(false);
    expect(applyKanbanFilters(makeTask({ assigneeId: null }), filters, ME)).toBe(false);
  });

  it('shows only unassigned tasks when unassigned=true', () => {
    const filters: KanbanFilters = { ...EMPTY_FILTERS, unassigned: true };
    expect(applyKanbanFilters(makeTask({ assigneeId: null }), filters, ME)).toBe(true);
    expect(applyKanbanFilters(makeTask({ assigneeId: ME }), filters, ME)).toBe(false);
  });

  it('shows mine OR unassigned when both are true (the triage combo)', () => {
    const filters: KanbanFilters = { ...EMPTY_FILTERS, mine: true, unassigned: true };
    expect(applyKanbanFilters(makeTask({ assigneeId: ME }), filters, ME)).toBe(true);
    expect(applyKanbanFilters(makeTask({ assigneeId: null }), filters, ME)).toBe(true);
    expect(applyKanbanFilters(makeTask({ assigneeId: VIJAY }), filters, ME)).toBe(false);
  });
});

describe('applyKanbanFilters — assigneeId picker (Pankaj 2026-05-21)', () => {
  it('shows only the picked user when assigneeId is set', () => {
    const filters: KanbanFilters = { ...EMPTY_FILTERS, assigneeId: VIJAY };
    expect(applyKanbanFilters(makeTask({ assigneeId: VIJAY }), filters, ME)).toBe(true);
    expect(applyKanbanFilters(makeTask({ assigneeId: ME }), filters, ME)).toBe(false);
    expect(applyKanbanFilters(makeTask({ assigneeId: null }), filters, ME)).toBe(false);
  });

  it('overrides mine + unassigned when assigneeId is set (defensive precedence)', () => {
    // The UX clears mine/unassigned when the picker fires — but if a stale
    // combination ever reaches the filter, assigneeId wins. Pin it.
    const filters: KanbanFilters = {
      ...EMPTY_FILTERS,
      mine: true,
      unassigned: true,
      assigneeId: VIJAY,
    };
    expect(applyKanbanFilters(makeTask({ assigneeId: VIJAY }), filters, ME)).toBe(true);
    // Even though `mine: true` would otherwise match this, the assigneeId
    // override scopes to Vijay only.
    expect(applyKanbanFilters(makeTask({ assigneeId: ME }), filters, ME)).toBe(false);
    expect(applyKanbanFilters(makeTask({ assigneeId: null }), filters, ME)).toBe(false);
  });

  it('treats null assigneeId on filter as not set (back-compat with old saved filters)', () => {
    // A persisted filter from before the picker shipped won't have
    // `assigneeId` at all (undefined). Make sure that still behaves like
    // the empty filter set.
    const filters: KanbanFilters = { ...EMPTY_FILTERS, assigneeId: null };
    expect(applyKanbanFilters(makeTask({ assigneeId: ME }), filters, ME)).toBe(true);
    expect(applyKanbanFilters(makeTask({ assigneeId: VIJAY }), filters, ME)).toBe(true);
  });

  it('stacks with priority + blocked filters (AND across categories)', () => {
    const filters: KanbanFilters = {
      ...EMPTY_FILTERS,
      assigneeId: VIJAY,
      p0: true,
      blocked: true,
    };
    expect(applyKanbanFilters(makeTask({ assigneeId: VIJAY, priority: 'P0', isBlocked: true }), filters, ME)).toBe(true);
    // Wrong assignee — out.
    expect(applyKanbanFilters(makeTask({ assigneeId: ME, priority: 'P0', isBlocked: true }), filters, ME)).toBe(false);
    // Right assignee, wrong priority — out.
    expect(applyKanbanFilters(makeTask({ assigneeId: VIJAY, priority: 'P1', isBlocked: true }), filters, ME)).toBe(false);
    // Right assignee + priority, not blocked — out.
    expect(applyKanbanFilters(makeTask({ assigneeId: VIJAY, priority: 'P0', isBlocked: false }), filters, ME)).toBe(false);
  });
});

describe('applyKanbanFilters — hide DONE when assignee filter active (Pankaj 2026-05-22 bug)', () => {
  it('hides DONE tasks when filtering Unassigned (the reported bug)', async () => {
    const filters: KanbanFilters = { ...EMPTY_FILTERS, unassigned: true };
    // Unassigned + Done → hidden (was previously showing — the bug).
    expect(applyKanbanFilters(makeTaskWithStatus({ assigneeId: null, status: 'DONE' }), filters, ME)).toBe(false);
    // Unassigned + In Progress → shown (the triage queue).
    expect(applyKanbanFilters(makeTaskWithStatus({ assigneeId: null, status: 'IN_PROGRESS' }), filters, ME)).toBe(true);
  });

  it('hides DONE when filtering Mine', () => {
    const filters: KanbanFilters = { ...EMPTY_FILTERS, mine: true };
    expect(applyKanbanFilters(makeTaskWithStatus({ assigneeId: ME, status: 'DONE' }), filters, ME)).toBe(false);
    expect(applyKanbanFilters(makeTaskWithStatus({ assigneeId: ME, status: 'IN_PROGRESS' }), filters, ME)).toBe(true);
  });

  it('hides DONE when filtering by a specific assignee (picker)', () => {
    const filters: KanbanFilters = { ...EMPTY_FILTERS, assigneeId: VIJAY };
    expect(applyKanbanFilters(makeTaskWithStatus({ assigneeId: VIJAY, status: 'DONE' }), filters, ME)).toBe(false);
    expect(applyKanbanFilters(makeTaskWithStatus({ assigneeId: VIJAY, status: 'IN_PROGRESS' }), filters, ME)).toBe(true);
  });

  it('SHOWS DONE when no assignee filter active — priority filter alone is a reporting query', () => {
    // Filtering by P0 alone should show every P0, including done ones.
    // "Show me all P0 work shipped this sprint" is a legit query.
    const filters: KanbanFilters = { ...EMPTY_FILTERS, p0: true };
    expect(applyKanbanFilters(makeTaskWithStatus({ status: 'DONE', priority: 'P0' }), filters, ME)).toBe(true);
  });

  it('SHOWS DONE when blocked filter alone is set (classification, not workload)', () => {
    const filters: KanbanFilters = { ...EMPTY_FILTERS, blocked: true };
    expect(applyKanbanFilters(makeTaskWithStatus({ status: 'DONE', isBlocked: true }), filters, ME)).toBe(true);
  });
});

describe('applyKanbanFilters — priority OR within category', () => {
  it('shows P0 OR P1 when both are toggled (not AND)', () => {
    const filters: KanbanFilters = { ...EMPTY_FILTERS, p0: true, p1: true };
    expect(applyKanbanFilters(makeTask({ priority: 'P0' }), filters, ME)).toBe(true);
    expect(applyKanbanFilters(makeTask({ priority: 'P1' }), filters, ME)).toBe(true);
    expect(applyKanbanFilters(makeTask({ priority: 'P2' }), filters, ME)).toBe(false);
  });
});

describe('applyKanbanFilters — agents-only (Pankaj 2026-05-22)', () => {
  function makeAgentTask(assigneeId: string | null, userType: 'AGENT' | 'HUMAN' | undefined = undefined): any {
    return {
      id: 't-agent',
      assigneeId,
      assignee: assigneeId
        ? { id: assigneeId, name: 'Manjari', userType }
        : null,
      priority: 'P2',
      isBlocked: false,
      status: 'IN_PROGRESS',
    };
  }

  it('keeps tasks assigned to an AGENT when agentsOnly=true', () => {
    const filters: KanbanFilters = { ...EMPTY_FILTERS, agentsOnly: true };
    expect(applyKanbanFilters(makeAgentTask('manjari-id', 'AGENT'), filters, ME)).toBe(true);
  });

  it('hides HUMAN-assigned tasks when agentsOnly=true', () => {
    const filters: KanbanFilters = { ...EMPTY_FILTERS, agentsOnly: true };
    expect(applyKanbanFilters(makeAgentTask('eng-id', 'HUMAN'), filters, ME)).toBe(false);
  });

  it('hides unassigned tasks when agentsOnly=true (no agent owning them)', () => {
    const filters: KanbanFilters = { ...EMPTY_FILTERS, agentsOnly: true };
    expect(applyKanbanFilters(makeAgentTask(null), filters, ME)).toBe(false);
  });

  it('hides assigned tasks where userType is undefined (back-compat safety)', () => {
    // Old task payloads (pre-userType field) — we err on the safe
    // side and don't claim "this is an agent task". A HUMAN is the
    // default; agent membership must be explicit.
    const filters: KanbanFilters = { ...EMPTY_FILTERS, agentsOnly: true };
    expect(applyKanbanFilters(makeAgentTask('eng-id', undefined), filters, ME)).toBe(false);
  });

  it('still hides DONE when agentsOnly is active (assignee-axis carve-out)', () => {
    const filters: KanbanFilters = { ...EMPTY_FILTERS, agentsOnly: true };
    const doneAgentTask = { ...makeAgentTask('manjari-id', 'AGENT'), status: 'DONE' };
    expect(applyKanbanFilters(doneAgentTask, filters, ME)).toBe(false);
  });
});

describe('isAnyFilterActive', () => {
  it('returns false on the empty filter', () => {
    expect(isAnyFilterActive(EMPTY_FILTERS)).toBe(false);
  });

  it('returns true when assigneeId is set (the new branch)', () => {
    expect(isAnyFilterActive({ ...EMPTY_FILTERS, assigneeId: VIJAY })).toBe(true);
  });

  it('returns false when assigneeId is explicitly null', () => {
    expect(isAnyFilterActive({ ...EMPTY_FILTERS, assigneeId: null })).toBe(false);
  });

  it('returns true for each individual filter axis', () => {
    expect(isAnyFilterActive({ ...EMPTY_FILTERS, mine: true })).toBe(true);
    expect(isAnyFilterActive({ ...EMPTY_FILTERS, unassigned: true })).toBe(true);
    expect(isAnyFilterActive({ ...EMPTY_FILTERS, p0: true })).toBe(true);
    expect(isAnyFilterActive({ ...EMPTY_FILTERS, p1: true })).toBe(true);
    expect(isAnyFilterActive({ ...EMPTY_FILTERS, blocked: true })).toBe(true);
  });
});
