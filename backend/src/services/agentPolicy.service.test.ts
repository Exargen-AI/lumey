import '../test/prismaMock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { UserType } from '@prisma/client';
import { NotFoundError, ValidationError } from '../utils/errors';
import { resolveEffectivePolicy, upsertAgentPolicy } from './agentPolicy.service';

beforeEach(() => vi.clearAllMocks());

describe('resolveEffectivePolicy', () => {
  it('returns an unrestricted, fully-defaulted policy when no row exists', async () => {
    prismaMock.agentPolicy.findUnique.mockResolvedValue(null as never);
    expect(await resolveEffectivePolicy('a1')).toEqual({
      enabled: true, allowedTools: null, maxRunTokens: null, maxRunSteps: null, model: null,
    });
  });

  it('maps a stored row (allowlist + caps)', async () => {
    prismaMock.agentPolicy.findUnique.mockResolvedValue({
      enabled: false, allowedTools: ['read_file', 'write_file'], maxRunTokens: 50_000, maxRunSteps: 12, model: 'qwen',
    } as never);
    expect(await resolveEffectivePolicy('a1')).toEqual({
      enabled: false, allowedTools: ['read_file', 'write_file'], maxRunTokens: 50_000, maxRunSteps: 12, model: 'qwen',
    });
  });
});

describe('upsertAgentPolicy', () => {
  it('rejects a non-agent user', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ userType: UserType.HUMAN } as never);
    await expect(upsertAgentPolicy('h1', { enabled: false })).rejects.toBeInstanceOf(ValidationError);
    expect(prismaMock.agentPolicy.upsert).not.toHaveBeenCalled();
  });

  it('throws NotFoundError for a missing user', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null as never);
    await expect(upsertAgentPolicy('nope', {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a non-positive maxRunTokens', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ userType: UserType.AGENT } as never);
    await expect(upsertAgentPolicy('a1', { maxRunTokens: 0 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('upserts a valid policy for an agent', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ userType: UserType.AGENT } as never);
    prismaMock.agentPolicy.upsert.mockResolvedValue({ id: 'p1' } as never);
    await upsertAgentPolicy('a1', { allowedTools: ['read_file'], maxRunTokens: 50_000 });
    expect(prismaMock.agentPolicy.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'a1' } }),
    );
  });
});
