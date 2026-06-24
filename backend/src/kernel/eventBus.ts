/**
 * In-process, typed publish/subscribe bus — the decoupling seam between
 * capability modules. A module announces facts (`publish`) without knowing
 * who, if anyone, listens; other modules `subscribe` without the publisher
 * knowing they exist. An uninstalled module simply has no subscriber, so
 * there is never an `if (moduleEnabled)` branch in producer code.
 *
 * Design guarantees:
 *   - `publish` AWAITS every handler, so a caller that needs a projection to
 *     have run can `await bus.publish(...)` and rely on it.
 *   - A handler that throws is ISOLATED and logged — one bad subscriber can
 *     never break the publisher or its sibling subscribers. (A notification
 *     failure must not fail the comment that triggered it.)
 *
 * Process-local only. A durable/cross-process transport can implement the
 * same surface later without touching producers or consumers.
 */

import { logger } from '../lib/logger';
import type { DomainEvent } from './events';

export type EventHandler<E extends DomainEvent = DomainEvent> = (
  event: E,
) => void | Promise<void>;

/** Unsubscribe handle returned by {@link EventBus.subscribe}. */
export type Unsubscribe = () => void;

export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  /**
   * Register a handler for an event type. Returns an idempotent unsubscribe.
   */
  subscribe<E extends DomainEvent>(type: E['type'], handler: EventHandler<E>): Unsubscribe {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as EventHandler);
    return () => {
      this.handlers.get(type)?.delete(handler as EventHandler);
    };
  }

  /**
   * Publish an event to all subscribers and await their completion. Handler
   * errors are caught, logged, and swallowed so they cannot propagate to the
   * publisher. Returns once every handler has settled.
   */
  async publish<E extends DomainEvent>(event: E): Promise<void> {
    const set = this.handlers.get(event.type);
    if (!set || set.size === 0) return;
    // Snapshot so a handler that (un)subscribes mid-dispatch can't mutate the
    // set we're iterating.
    await Promise.all(
      [...set].map(async (handler) => {
        try {
          await handler(event);
        } catch (err) {
          logger.error({ err, eventType: event.type }, '[kernel] event subscriber failed');
        }
      }),
    );
  }

  /** Number of handlers registered for a type. Introspection / tests. */
  listenerCount(type: string): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  /** Drop every subscription. Test isolation only. */
  clear(): void {
    this.handlers.clear();
  }
}

/**
 * Process-wide singleton. Services publish through it; module `init` hooks
 * subscribe through the `bus` handed to them in their {@link ModuleContext}
 * (which is this same instance).
 */
export const bus = new EventBus();
