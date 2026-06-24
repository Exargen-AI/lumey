import './../test/prismaMock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { linkPullRequestToTask } from './taskPullRequestLink.service';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.taskExternalLink.upsert.mockResolvedValue({ id: 'l1' } as never);
});

describe('linkPullRequestToTask', () => {
  it('upserts a GITHUB_PR external link, idempotent on (task, kind, externalId)', async () => {
    await linkPullRequestToTask('task1', { externalId: 'local/sandbox#5', url: 'https://x/5', title: 'My PR', authorName: 'Lumey Agent' });

    expect(prismaMock.taskExternalLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId_kind_externalId: { taskId: 'task1', kind: 'GITHUB_PR', externalId: 'local/sandbox#5' } },
        create: expect.objectContaining({ taskId: 'task1', kind: 'GITHUB_PR', url: 'https://x/5', title: 'My PR', state: 'OPEN', authorName: 'Lumey Agent' }),
        update: expect.objectContaining({ url: 'https://x/5', state: 'OPEN' }),
      }),
    );
  });

  it('defaults title/author to null when omitted', async () => {
    await linkPullRequestToTask('task1', { externalId: 'e', url: 'u' });
    const arg = prismaMock.taskExternalLink.upsert.mock.calls[0][0] as { create: { title: unknown; authorName: unknown } };
    expect(arg.create.title).toBeNull();
    expect(arg.create.authorName).toBeNull();
  });
});
