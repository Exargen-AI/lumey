/**
 * Lumey kernel — the always-on substrate every deployment runs: a module
 * registry, an event bus, and entitlements. Capability modules plug in around
 * it. See docs/modules/KERNEL.md for the module-authoring guide.
 *
 * This barrel exposes the kernel's *public* surface — what bootstrap and
 * modules consume. It grows as modules need more (e.g. `bus` / event types
 * land here when the first module subscribes). Internal kernel files import
 * from each other directly.
 */

export { ModuleRegistry } from './registry';
export { ConfigEntitlements } from './entitlements';
export type { ModuleManifest } from './manifest';
