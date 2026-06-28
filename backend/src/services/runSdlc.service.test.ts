import '../test/prismaMock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { CheckConclusion, CheckStatus, PrState } from '@prisma/client';
import {
  recordRunCommit,
  recordRunPullRequest,
  updateRunPullRequestState,
  processCheckRunEvent,
  getRunSdlc,
  type GitHubCheckRunEvent,
} from './runSdlc.service';

beforeEach(() => vi.clearAllMocks());

describe('recordRunCommit', () => {
  it('upserts idempotently on (runId, sha)', async () => {
    prismaMock.runCommit.upsert.mockResolvedValue({ id: 'c1' } as never);
    await recordRunCommit({ runId: 'r1', sha: 'abc123', message: 'feat: x', branch: 'lumey/run-r1' });
    expect(prismaMock.runCommit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { runId_sha: { runId: 'r1', sha: 'abc123' } } }),
    );
  });
});

describe('recordRunPullRequest', () => {
  it('upserts on the provider externalId', async () => {
    prismaMock.runPullRequest.upsert.mockResolvedValue({ id: 'pr1' } as never);
    await recordRunPullRequest({ runId: 'r1', externalId: 'o/r#42', number: 42, url: 'u', title: 't', branch: 'b', baseBranch: 'main' });
    expect(prismaMock.runPullRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { externalId: 'o/r#42' } }),
    );
  });
});

describe('updateRunPullRequestState', () => {
  it('is a no-op (null) when the PR is not a recorded run PR', async () => {
    prismaMock.runPullRequest.findUnique.mockResolvedValue(null as never);
    expect(await updateRunPullRequestState({ externalId: 'o/r#9', state: PrState.MERGED })).toBeNull();
    expect(prismaMock.runPullRequest.update).not.toHaveBeenCalled();
  });

  it('updates state when the run PR exists', async () => {
    prismaMock.runPullRequest.findUnique.mockResolvedValue({ id: 'pr1' } as never);
    prismaMock.runPullRequest.update.mockResolvedValue({ id: 'pr1', state: 'MERGED' } as never);
    await updateRunPullRequestState({ externalId: 'o/r#42', state: PrState.MERGED, mergedAt: new Date('2026-06-28') });
    expect(prismaMock.runPullRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: PrState.MERGED }) }),
    );
  });
});

describe('processCheckRunEvent', () => {
  const event = (over: Partial<GitHubCheckRunEvent['check_run']> = {}): GitHubCheckRunEvent => ({
    action: 'completed',
    repository: { full_name: 'o/r' },
    check_run: {
      id: 555,
      name: 'tests',
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://gh/checks/555',
      started_at: '2026-06-28T09:00:00Z',
      completed_at: '2026-06-28T09:05:00Z',
      check_suite: { head_branch: 'lumey/run-r1' },
      ...over,
    },
  });

  it('ignores a check with no head branch', async () => {
    expect(await processCheckRunEvent('p1', event({ check_suite: { head_branch: null } }))).toBeNull();
    expect(prismaMock.runPullRequest.findFirst).not.toHaveBeenCalled();
  });

  it('ignores a check with no matching run PR in the project', async () => {
    prismaMock.runPullRequest.findFirst.mockResolvedValue(null as never);
    expect(await processCheckRunEvent('p1', event())).toBeNull();
    expect(prismaMock.runCheck.upsert).not.toHaveBeenCalled();
  });

  it('upserts the check on the matching run PR, mapping status + conclusion', async () => {
    prismaMock.runPullRequest.findFirst.mockResolvedValue({ id: 'pr1' } as never);
    prismaMock.runCheck.upsert.mockResolvedValue({ id: 'chk1' } as never);

    await processCheckRunEvent('p1', event());

    // scoped by branch + project
    expect(prismaMock.runPullRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { branch: 'lumey/run-r1', run: { task: { projectId: 'p1' } } } }),
    );
    // idempotent on the GitHub check id, with mapped enums
    const call = prismaMock.runCheck.upsert.mock.calls[0][0] as { where: { externalId: string }; create: { status: CheckStatus; conclusion: CheckConclusion } };
    expect(call.where.externalId).toBe('o/r#check#555');
    expect(call.create.status).toBe(CheckStatus.COMPLETED);
    expect(call.create.conclusion).toBe(CheckConclusion.SUCCESS);
  });
});

describe('getRunSdlc', () => {
  it('assembles commits + the latest PR + that PR\'s checks', async () => {
    prismaMock.runCommit.findMany.mockResolvedValue([{ id: 'c1', sha: 'aaa' }] as never);
    prismaMock.runPullRequest.findMany.mockResolvedValue([
      { id: 'pr1', externalId: 'o/r#42', state: 'OPEN', checks: [{ id: 'chk1', name: 'tests' }] },
    ] as never);

    const sdlc = await getRunSdlc('r1');

    expect(sdlc.commits).toHaveLength(1);
    expect(sdlc.pullRequest).toMatchObject({ id: 'pr1', externalId: 'o/r#42' });
    expect((sdlc.pullRequest as Record<string, unknown>).checks).toBeUndefined(); // checks split out
    expect(sdlc.checks).toEqual([{ id: 'chk1', name: 'tests' }]);
  });

  it('returns nulls/empties when the run has no PR', async () => {
    prismaMock.runCommit.findMany.mockResolvedValue([] as never);
    prismaMock.runPullRequest.findMany.mockResolvedValue([] as never);
    const sdlc = await getRunSdlc('r1');
    expect(sdlc).toEqual({ commits: [], pullRequest: null, checks: [] });
  });
});
