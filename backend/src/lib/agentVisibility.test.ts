/**
 * Agent visibility policy tests (2026-06-01).
 *
 * The single source of truth for "may this viewer see AI agents?". A
 * regression here would either leak agent work to regular users or
 * hide it from SUPER_ADMIN / allowlisted users — both bad — so the
 * truth table is pinned explicitly.
 */

import { describe, it, expect } from 'vitest';
import { UserRole, UserType } from '@prisma/client';
import {
  viewerCanSeeAgents,
  maskAgentActor,
  EXCLUDE_AGENT_ASSIGNED_TASKS,
} from './agentVisibility';

describe('viewerCanSeeAgents', () => {
  it('SUPER_ADMIN always sees agents (flag irrelevant)', () => {
    expect(viewerCanSeeAgents({ role: UserRole.SUPER_ADMIN })).toBe(true);
    expect(viewerCanSeeAgents({ role: UserRole.SUPER_ADMIN, canViewAgents: false })).toBe(true);
  });

  it('non-SUPER_ADMIN sees agents only with the allowlist flag', () => {
    for (const role of [UserRole.ADMIN, UserRole.PRODUCT_MANAGER, UserRole.ENGINEER, UserRole.CLIENT]) {
      expect(viewerCanSeeAgents({ role })).toBe(false);
      expect(viewerCanSeeAgents({ role, canViewAgents: false })).toBe(false);
      expect(viewerCanSeeAgents({ role, canViewAgents: true })).toBe(true);
    }
  });

  it('treats null/undefined flag + null viewer as cannot-see', () => {
    expect(viewerCanSeeAgents({ role: UserRole.ENGINEER, canViewAgents: null })).toBe(false);
    expect(viewerCanSeeAgents(null)).toBe(false);
    expect(viewerCanSeeAgents(undefined)).toBe(false);
  });
});

describe('maskAgentActor', () => {
  const agent = { id: 'a1', name: 'Codey', userType: UserType.AGENT };
  const human = { id: 'h1', name: 'Pat', userType: UserType.HUMAN };

  it('nulls an agent actor when the viewer cannot see agents', () => {
    expect(maskAgentActor(agent, false)).toBeNull();
  });

  it('returns the agent unchanged when the viewer CAN see agents', () => {
    expect(maskAgentActor(agent, true)).toEqual(agent);
  });

  it('never masks a human actor', () => {
    expect(maskAgentActor(human, false)).toEqual(human);
    expect(maskAgentActor(human, true)).toEqual(human);
  });

  it('passes null/undefined through', () => {
    expect(maskAgentActor(null, false)).toBeNull();
    expect(maskAgentActor(undefined, false)).toBeUndefined();
  });
});

describe('EXCLUDE_AGENT_ASSIGNED_TASKS', () => {
  it('is a NOT filter on assignee.userType === AGENT (keeps null-assignee tasks)', () => {
    expect(EXCLUDE_AGENT_ASSIGNED_TASKS).toEqual({
      NOT: { assignee: { is: { userType: UserType.AGENT } } },
    });
  });
});
