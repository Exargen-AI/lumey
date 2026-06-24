import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './eventBus';
import type { DomainEvent } from './events';

interface ThingHappened extends DomainEvent {
  type: 'thing.happened';
  value: number;
}

describe('EventBus', () => {
  it('delivers a published event to a subscriber with its payload', async () => {
    const bus = new EventBus();
    const seen: number[] = [];
    bus.subscribe<ThingHappened>('thing.happened', (e) => void seen.push(e.value));

    await bus.publish<ThingHappened>({ type: 'thing.happened', value: 42 });

    expect(seen).toEqual([42]);
  });

  it('fans out to every subscriber of a type', async () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe('thing.happened', a);
    bus.subscribe('thing.happened', b);

    await bus.publish<ThingHappened>({ type: 'thing.happened', value: 1 });

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('does not deliver to subscribers of other types', async () => {
    const bus = new EventBus();
    const other = vi.fn();
    bus.subscribe('other.event', other);

    await bus.publish<ThingHappened>({ type: 'thing.happened', value: 1 });

    expect(other).not.toHaveBeenCalled();
  });

  it('awaits async handlers before resolving', async () => {
    const bus = new EventBus();
    let done = false;
    bus.subscribe('thing.happened', async () => {
      await new Promise((r) => setTimeout(r, 5));
      done = true;
    });

    await bus.publish<ThingHappened>({ type: 'thing.happened', value: 1 });

    expect(done).toBe(true);
  });

  it('isolates a throwing handler — siblings still run and publish resolves', async () => {
    const bus = new EventBus();
    const sibling = vi.fn();
    bus.subscribe('thing.happened', () => {
      throw new Error('boom');
    });
    bus.subscribe('thing.happened', sibling);

    await expect(
      bus.publish<ThingHappened>({ type: 'thing.happened', value: 1 }),
    ).resolves.toBeUndefined();
    expect(sibling).toHaveBeenCalledOnce();
  });

  it('isolates a rejecting async handler the same way', async () => {
    const bus = new EventBus();
    const sibling = vi.fn();
    bus.subscribe('thing.happened', async () => Promise.reject(new Error('async boom')));
    bus.subscribe('thing.happened', sibling);

    await expect(
      bus.publish<ThingHappened>({ type: 'thing.happened', value: 1 }),
    ).resolves.toBeUndefined();
    expect(sibling).toHaveBeenCalledOnce();
  });

  it('unsubscribe stops further delivery and is idempotent', async () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const off = bus.subscribe('thing.happened', handler);

    await bus.publish<ThingHappened>({ type: 'thing.happened', value: 1 });
    off();
    off(); // idempotent — must not throw
    await bus.publish<ThingHappened>({ type: 'thing.happened', value: 2 });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('publishing with no subscribers is a no-op', async () => {
    const bus = new EventBus();
    await expect(
      bus.publish<ThingHappened>({ type: 'thing.happened', value: 1 }),
    ).resolves.toBeUndefined();
  });

  it('tracks listener count and clears all subscriptions', async () => {
    const bus = new EventBus();
    bus.subscribe('thing.happened', vi.fn());
    bus.subscribe('thing.happened', vi.fn());
    expect(bus.listenerCount('thing.happened')).toBe(2);

    bus.clear();
    expect(bus.listenerCount('thing.happened')).toBe(0);
  });

  it('does not deliver to a handler subscribed during the same dispatch', async () => {
    const bus = new EventBus();
    const late = vi.fn();
    bus.subscribe('thing.happened', () => {
      bus.subscribe('thing.happened', late);
    });

    await bus.publish<ThingHappened>({ type: 'thing.happened', value: 1 });

    expect(late).not.toHaveBeenCalled();
  });
});
