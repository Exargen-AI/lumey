/**
 * Entitlements decide which modules are enabled for a deployment — the
 * mechanism behind plug-and-play packaging ("kanban + agents" vs "everything").
 *
 * Day one is config-based: every registered module is enabled unless listed
 * in `LUMEY_DISABLED_MODULES`. When multi-tenant mounting lands, a
 * tenant-scoped, DB-backed implementation of {@link Entitlements} replaces
 * {@link ConfigEntitlements} without the registry changing. See
 * docs/modules/KERNEL.md.
 */

import { env } from '../config/env';

export interface Entitlements {
  /** Whether a module (by its entitlement key) is enabled. */
  isEnabled(entitlementKey: string): boolean;
}

/**
 * Config-driven entitlements. `disabledCsv` is a comma-separated list of
 * entitlement keys to turn off; everything else is on. Parsed once at
 * construction.
 */
export class ConfigEntitlements implements Entitlements {
  private readonly disabled: ReadonlySet<string>;

  constructor(disabledCsv: string | undefined = env.LUMEY_DISABLED_MODULES) {
    this.disabled = new Set(
      (disabledCsv ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  isEnabled(entitlementKey: string): boolean {
    return !this.disabled.has(entitlementKey);
  }
}
