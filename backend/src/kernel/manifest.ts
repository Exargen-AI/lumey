/**
 * The module contract. A capability module ships a {@link ModuleManifest};
 * the {@link ModuleRegistry} discovers manifests, validates their dependency
 * graph, gates them by entitlement, boots the enabled ones in dependency
 * order, and mounts their routes.
 *
 * Rule that keeps the system plug-and-play: a module communicates with other
 * modules ONLY through the event bus and its declared contracts — never by
 * importing another module's internals. `dependsOn` is the one explicit,
 * validated coupling.
 */

import type { Router } from 'express';
import type { Logger } from 'pino';
import type { EventBus } from './eventBus';

/** Runtime services handed to a module's `init` hook. */
export interface ModuleContext {
  /** The process-wide event bus — subscribe to other modules' facts here. */
  readonly bus: EventBus;
  /** Structured logger (pino). */
  readonly logger: Logger;
}

/** A mountable route group a module contributes. */
export interface ModuleRoute {
  /** Express mount path, e.g. `/api/v1`. */
  readonly path: string;
  /** The Express router to mount. */
  readonly router: Router;
}

export interface ModuleManifest {
  /** Stable, unique module id, e.g. `comments`. */
  readonly id: string;
  /** Module semver. */
  readonly version: string;
  /**
   * Hard dependencies — module ids that MUST also be enabled. The registry
   * refuses to boot if a dependency is unknown or disabled, and boots
   * dependencies before dependents.
   */
  readonly dependsOn?: readonly string[];
  /**
   * Soft relations — modules whose events this one emits/consumes.
   * Informational only (not validated); documents the event coupling.
   */
  readonly enhances?: readonly string[];
  /**
   * Entitlement key gating this module. Defaults to `id`. The registry only
   * boots/mounts a module whose entitlement is enabled for the deployment.
   */
  readonly entitlement?: string;
  /** Route groups contributed by this module. */
  readonly routes?: readonly ModuleRoute[];
  /**
   * One-time wiring at boot — event subscriptions, schedulers, etc. Runs
   * after the module's dependencies have booted. Kept side-effect-light.
   */
  readonly init?: (ctx: ModuleContext) => void | Promise<void>;
}
