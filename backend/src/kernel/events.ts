/**
 * Domain events that flow over the kernel {@link EventBus}.
 *
 * Every event is a plain, serialisable object discriminated by `type`
 * (dot-namespaced, e.g. `comment.created`). Modules contribute their own
 * event shapes by augmenting this file's union as they're built — the bus
 * itself is type-agnostic, this union is purely for compile-time safety at
 * publish/subscribe call sites.
 *
 * Keep events as past-tense *facts* ("comment.created"), never commands —
 * a subscriber reacts to something that already happened and may never
 * assume it can veto it.
 */

/**
 * Base shape shared by every event on the bus. Modules declare their own
 * event interfaces (extending this) alongside their code as they land — the
 * first domain events arrive with the notifications module in M1.
 */
export interface DomainEvent {
  /** Dot-namespaced, past-tense event type. The discriminant. */
  readonly type: string;
}
