/**
 * 2026-05-23 — pins the Done-gate visibility helper. The kanban card
 * uses this to surface "AC 1/3" before the user drags, so they don't
 * walk into a silent failure (the symptom Pankaj reported in the
 * screenshot that prompted this work).
 *
 * Critical because:
 *   - The kanban card, the task detail modal, and any future surface
 *     all read AC state through this helper. If the contract drifts,
 *     all surfaces drift in lockstep.
 *   - The "blocksDoneFromHere" flag drives the amber-vs-gray-vs-green
 *     tone on the card. Wrong flag → wrong color → user confused.
 *   - Backend stores AC as Json (`[{ text, done }]`). Anything could
 *     end up here: null, empty array, malformed items, partial data
 *     after a hot-reload. Helper has to tolerate all of it without
 *     crashing the render.
 */

import { describe, it, expect } from 'vitest';
import { getAcceptanceCriterionStatus } from './acceptanceCriteria';

describe('getAcceptanceCriterionStatus', () => {
  it('returns all-zero status for a task with no acceptance criteria', () => {
    const status = getAcceptanceCriterionStatus({ status: 'IN_PROGRESS' });
    expect(status).toEqual({
      total: 0,
      done: 0,
      remaining: 0,
      allChecked: false,
      blocksDoneFromHere: false,
    });
  });

  it('counts done vs total correctly on a partial-check task', () => {
    const status = getAcceptanceCriterionStatus({
      status: 'IN_REVIEW',
      acceptanceCriteria: [
        { text: 'Tests added', done: true },
        { text: 'Docs updated', done: false },
        { text: 'Approved by reviewer', done: false },
      ],
    });
    expect(status.total).toBe(3);
    expect(status.done).toBe(1);
    expect(status.remaining).toBe(2);
    expect(status.allChecked).toBe(false);
    expect(status.blocksDoneFromHere).toBe(true);
  });

  it('flags allChecked when every item is done — the "ready to ship" state', () => {
    const status = getAcceptanceCriterionStatus({
      status: 'IN_REVIEW',
      acceptanceCriteria: [
        { text: 'A', done: true },
        { text: 'B', done: true },
      ],
    });
    expect(status.allChecked).toBe(true);
    expect(status.blocksDoneFromHere).toBe(false);
  });

  it('does NOT mark blocksDoneFromHere when task is in BACKLOG (not realistically about to ship)', () => {
    const status = getAcceptanceCriterionStatus({
      status: 'BACKLOG',
      acceptanceCriteria: [{ text: 'A', done: false }],
    });
    expect(status.total).toBe(1);
    expect(status.blocksDoneFromHere).toBe(false);
  });

  it('does NOT mark blocksDoneFromHere when task is already in DONE (move is into the same column)', () => {
    const status = getAcceptanceCriterionStatus({
      status: 'DONE',
      acceptanceCriteria: [{ text: 'A', done: false }],
    });
    expect(status.blocksDoneFromHere).toBe(false);
  });

  it('marks blocksDoneFromHere when task is IN_PROGRESS with unchecked AC (user is about to drag)', () => {
    const status = getAcceptanceCriterionStatus({
      status: 'IN_PROGRESS',
      acceptanceCriteria: [{ text: 'A', done: false }],
    });
    expect(status.blocksDoneFromHere).toBe(true);
  });

  it('marks blocksDoneFromHere when task is IN_REVIEW with unchecked AC (Pankaj\'s exact screenshot case)', () => {
    const status = getAcceptanceCriterionStatus({
      status: 'IN_REVIEW',
      acceptanceCriteria: [
        { text: 'First AC', done: true },
        { text: 'Second AC', done: false },
        { text: 'Third AC', done: false },
      ],
    });
    // 2/3 unchecked = blocked. Matches the screenshot's "2 acceptance
    // criteria are still unchecked" error.
    expect(status.remaining).toBe(2);
    expect(status.blocksDoneFromHere).toBe(true);
  });

  it('tolerates null / undefined task without crashing (defensive against stale cache)', () => {
    expect(getAcceptanceCriterionStatus(null).total).toBe(0);
    expect(getAcceptanceCriterionStatus(undefined).total).toBe(0);
  });

  it('tolerates missing acceptanceCriteria field on the task', () => {
    const status = getAcceptanceCriterionStatus({ status: 'IN_PROGRESS' });
    expect(status.total).toBe(0);
    expect(status.blocksDoneFromHere).toBe(false);
  });

  it('tolerates a non-array acceptanceCriteria value (contract drift defense)', () => {
    const status = getAcceptanceCriterionStatus({
      status: 'IN_PROGRESS',
      acceptanceCriteria: 'not an array' as any,
    });
    expect(status.total).toBe(0);
  });

  it('tolerates null entries inside the array without crashing the filter', () => {
    const status = getAcceptanceCriterionStatus({
      status: 'IN_PROGRESS',
      acceptanceCriteria: [
        null,
        { text: 'A', done: true },
        undefined,
        { text: 'B', done: false },
      ] as any,
    });
    // Null/undefined entries count toward total but never toward done.
    // (Total reflects what the data SHAPE claims; "done" only counts the
    // explicit `done === true` items per the backend gate's logic.)
    expect(status.total).toBe(4);
    expect(status.done).toBe(1);
  });

  it('treats truthy-but-not-true `done` values as NOT done (strict equality matches backend gate)', () => {
    // Backend's enforceDoneGate uses `c.done !== true`. So `1`, `"true"`,
    // etc. count as unchecked. We mirror that strictness so the badge
    // can't claim "all checked" while the backend still rejects.
    const status = getAcceptanceCriterionStatus({
      status: 'IN_REVIEW',
      acceptanceCriteria: [
        { text: 'A', done: 1 },
        { text: 'B', done: 'true' },
        { text: 'C', done: true },
      ] as any,
    });
    expect(status.done).toBe(1);
    expect(status.allChecked).toBe(false);
  });
});
