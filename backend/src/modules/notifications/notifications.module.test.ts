import './../../test/prismaMock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { prismaMock } from '../../test/prismaMock';
import { ModuleRegistry, ConfigEntitlements } from '../../kernel';
import { EventBus } from '../../kernel/eventBus';
import { notificationsModule, fanOutTaskComment } from './index';
import type { CommentCreatedEvent } from '../comments/events';

const { notifySpy, subscriberIdsSpy } = vi.hoisted(() => ({
  notifySpy: vi.fn().mockResolvedValue(undefined),
  subscriberIdsSpy: vi.fn(),
}));
vi.mock('../../services/notification.service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  notifyTaskSubscribersOfComment: notifySpy,
}));
vi.mock('../../services/taskSubscription.service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getSubscriberIdsForNotify: subscriberIdsSpy,
}));

function event(overrides: Partial<CommentCreatedEvent> = {}): CommentCreatedEvent {
  return {
    type: 'comment.created',
    commentId: 'c1',
    projectId: 'p1',
    projectName: 'Lumey',
    taskId: 't1',
    milestoneId: null,
    authorId: 'u-author',
    authorName: 'Ada',
    contentSnippet: 'looks good',
    mentionedUserIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('notifications module — comment.created fan-out', () => {
  it('notifies task subscribers, excluding the author and mentioned users', async () => {
    subscriberIdsSpy.mockResolvedValue(['s1', 's2']);
    prismaMock.task.findUnique.mockResolvedValue({ title: 'Build login' } as never);

    await fanOutTaskComment(event({ authorId: 'u-author', mentionedUserIds: ['m1'] }));

    expect(subscriberIdsSpy).toHaveBeenCalledWith('t1', new Set(['u-author', 'm1']));
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't1',
        taskTitle: 'Build login',
        authorName: 'Ada',
        subscriberIds: ['s1', 's2'],
      }),
    );
  });

  it('is a no-op for a non-task (milestone/project) comment', async () => {
    await fanOutTaskComment(event({ taskId: null }));
    expect(subscriberIdsSpy).not.toHaveBeenCalled();
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('does not notify when there are no remaining subscribers', async () => {
    subscriberIdsSpy.mockResolvedValue([]);
    await fanOutTaskComment(event());
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('skips cleanly when the task was deleted between create and fan-out', async () => {
    subscriberIdsSpy.mockResolvedValue(['s1']);
    prismaMock.task.findUnique.mockResolvedValue(null as never);
    await fanOutTaskComment(event());
    expect(notifySpy).not.toHaveBeenCalled();
  });
});

describe('notifications module — kernel wiring', () => {
  it('subscribes to comment.created on boot and reacts to a published event', async () => {
    subscriberIdsSpy.mockResolvedValue(['s1']);
    prismaMock.task.findUnique.mockResolvedValue({ title: 'T' } as never);
    const bus = new EventBus();
    const registry = new ModuleRegistry(new ConfigEntitlements(), bus);
    registry.register(notificationsModule);
    await registry.boot();

    await bus.publish(event());

    expect(notifySpy).toHaveBeenCalledOnce();
  });

  it('mounts the notification routes when enabled (401, not 404)', async () => {
    const app = express();
    app.use(express.json());
    const registry = new ModuleRegistry(new ConfigEntitlements());
    registry.register(notificationsModule);
    registry.mount(app);
    const res = await supertest(app).get('/api/v1/notifications').send();
    expect(res.status).toBe(401);
  });

  it('does not mount the routes when notifications is disabled (404)', async () => {
    const app = express();
    const registry = new ModuleRegistry(new ConfigEntitlements('notifications'));
    registry.register(notificationsModule);
    registry.mount(app);
    const res = await supertest(app).get('/api/v1/notifications').send();
    expect(res.status).toBe(404);
  });
});
