/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Typed app env vars (augments vite/client's base ImportMetaEnv).
interface ImportMetaEnv {
  /** Backend origin (no trailing slash, no /api/v1). */
  readonly VITE_API_URL?: string;
  /** Inactivity-logout window in ms. `0` disables auto-logout. */
  readonly VITE_INACTIVITY_TIMEOUT_MS?: string;
  /** Error-collector ingest URL (Sentry DSN or custom). Presence enables reporting. */
  readonly VITE_ERROR_REPORTING_DSN?: string;
  /** Release/version tag attached to reported errors for grouping. */
  readonly VITE_APP_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
