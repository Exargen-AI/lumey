import './../test/prismaMock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { resolveRunRepoConfig } from './runRepoConfig.service';

beforeEach(() => vi.clearAllMocks());

describe('resolveRunRepoConfig', () => {
  it('returns owner/repo/baseBranch from the project GitHub integration', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      project: { githubIntegration: { repoOwner: 'acme', repoName: 'web', defaultBranch: 'develop' } },
    } as never);
    expect(await resolveRunRepoConfig('t1')).toEqual({ owner: 'acme', repo: 'web', baseBranch: 'develop' });
  });

  it('returns null when the project has no integration', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ project: { githubIntegration: null } } as never);
    expect(await resolveRunRepoConfig('t1')).toBeNull();
  });

  it('returns null when the task is missing', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null as never);
    expect(await resolveRunRepoConfig('nope')).toBeNull();
  });
});
