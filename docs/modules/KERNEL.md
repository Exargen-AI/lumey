# Kernel & module system (M0)

The kernel is the always-on substrate every Lumey deployment runs. Capability
modules plug in around it. This is the foundation of the plug-and-play
architecture (`docs/planning/ARCHITECTURE.md` §2): one customer enables
*kanban + agents*, another *kanban + observability*, another *everything* —
each is just a different set of enabled modules.

Code: `backend/src/kernel/` · first module: `backend/src/modules/comments/`.

---

## What the kernel provides

| Piece | File | Responsibility |
|---|---|---|
| **Module registry** | `kernel/registry.ts` | Discover modules, validate the dependency graph, gate by entitlement, mount routes, run boot hooks in dependency order |
| **Event bus** | `kernel/eventBus.ts` | In-process typed pub/sub — the decoupling seam between modules |
| **Entitlements** | `kernel/entitlements.ts` | Decide which modules are enabled for the deployment |
| **Manifest contract** | `kernel/manifest.ts` | The shape every module ships |

Public surface is the barrel `kernel/index.ts` — it exports what bootstrap and
modules consume today (`ModuleRegistry`, `ConfigEntitlements`, `ModuleManifest`)
and grows as modules need more.

---

## The module contract

```ts
export interface ModuleManifest {
  id: string;                      // stable unique id, e.g. "comments"
  version: string;                 // semver
  dependsOn?: readonly string[];   // hard deps — must also be enabled; booted first
  enhances?: readonly string[];    // soft, informational: modules whose events it touches
  entitlement?: string;            // gate key (defaults to id)
  routes?: readonly ModuleRoute[]; // { path, router } groups to mount
  init?: (ctx: ModuleContext) => void | Promise<void>; // boot wiring (subscriptions)
}
```

**The one rule that keeps it plug-and-play:** a module talks to other modules
**only** through the event bus and its declared contracts — never by importing
another module's internals. `dependsOn` is the single explicit, validated
coupling. An uninstalled module simply has no event subscriber, so there is no
`if (moduleEnabled)` branch anywhere in producer code.

---

## Lifecycle

```
register(manifest)*   →   mount(app)   →   boot()
```

1. **register** — collect manifests (synchronous, at app assembly).
2. **mount** — resolve the enabled set, validate the graph, mount routes onto
   Express. **Synchronous**, so it slots into the existing synchronous app
   assembly (before the error handler).
3. **boot** — run each enabled module's `init` (event subscriptions, schedulers)
   in dependency order. **Async**, awaited during server bootstrap *before* the
   listener opens, so subscriptions are live before the first request.

Resolution (entitlement filter → graph validation → topological order) is
computed once and memoised, so `mount` and `boot` agree. The graph validator
rejects: an **unknown** dependency, a **disabled** dependency, and **cycles**.

Wiring lives in `backend/src/index.ts`:

```ts
const registry = new ModuleRegistry(new ConfigEntitlements());
registry.register(commentsModule);
// …in the route section (before the error handler):
registry.mount(app);
// …in bootstrap(), before app.listen():
await registry.boot();
```

---

## Authoring a module

1. Create `backend/src/modules/<id>/index.ts` exporting a `ModuleManifest`.
2. Point `routes` at the module's existing Express router(s).
3. If it reacts to other modules, subscribe in `init(ctx)` via `ctx.bus`.
4. Register it in `backend/src/index.ts` (`registry.register(...)`).
5. Add a unit/integration test (see below).

Example — the comments module:

```ts
// backend/src/modules/comments/index.ts
import commentRoutes from '../../routes/comment.routes';
import type { ModuleManifest } from '../../kernel';

export const commentsModule: ModuleManifest = {
  id: 'comments',
  version: '1.0.0',
  entitlement: 'comments',
  routes: [{ path: '/api/v1', router: commentRoutes }],
};
```

---

## Entitlements

Day one is **config-based** (`ConfigEntitlements`): every registered module is
enabled unless listed in `LUMEY_DISABLED_MODULES` (comma-separated entitlement
keys). Example: `LUMEY_DISABLED_MODULES=comments` removes the comment routes
entirely — they return 404, proving the gate controls real routing.

> **Deferred (intentionally, to avoid speculative code):** a tenant-scoped,
> DB-backed entitlement source (with `Tenant` / `ModuleInstallation` models)
> replaces `ConfigEntitlements` when multi-tenant per-request mounting lands.
> The registry doesn't change — only the `Entitlements` implementation does.

---

## The event bus

- Events are past-tense **facts** (`comment.created`), never commands — a
  subscriber reacts to something that already happened and can't veto it.
- `publish` **awaits** every handler, so a caller needing a projection to have
  run can `await bus.publish(...)`.
- A handler that throws is **isolated and logged** — one bad subscriber can
  never break the publisher or its siblings (a notification failure must not
  fail the comment that triggered it).

> The bus is built and unit-tested as kernel infrastructure in M0. Its first
> **domain** producer/consumer pair lands in M1, when the notifications module
> subscribes to `comment.created` — added then, with its consumer, rather than
> published into the void now.

---

## Testing

- **Unit** (`kernel/*.test.ts`): registry graph validation (unknown/disabled
  dep, cycle), entitlement gating, ordered boot; event-bus fan-out, async
  awaiting, error isolation, unsubscribe.
- **Integration** (`modules/comments/comments.module.test.ts`): mounts the real
  module through the registry into Express and asserts route existence flips
  with the entitlement — `401` when enabled (route exists, auth ran), `404` when
  disabled (no handler).

Run: `npm run test --workspace=backend`.

---

## Status (M0)

✅ Registry (dep-graph validation + entitlement gating + ordered mount/boot) ·
event bus (typed, isolating) · config entitlements · `comments` as the first
registered module · 33 kernel tests, full suite green.

**Next (M1):** migrate more spine capabilities to modules; the first domain
events (`comment.created` → notifications) move onto the bus.
