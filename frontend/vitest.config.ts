import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Vitest config for the frontend.
 *
 * Phase 0 of the baseline hardening plan: runs React Testing Library
 * against components and hooks in a jsdom environment, shares the
 * existing Vite plugin + alias setup so tests resolve `@/...` paths
 * identically to runtime, and pre-loads jest-dom matchers via
 * `vitest.setup.ts`.
 *
 * Scope:
 *   - Component tests (`*.test.tsx`) under `src/components/`, `src/pages/`.
 *   - Hook tests (`*.test.ts`) under `src/hooks/`.
 *   - Pure-function tests (`*.test.ts`) under `src/lib/`, `src/utils/`.
 *
 * Out of scope:
 *   - End-to-end browser flows — those live in `tests/e2e/` under
 *     Playwright and have their own config.
 *
 * Coverage thresholds start at 0% — Phase 4 raises them per file as
 * tests land. Coverage cannot drop once a target is reached.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Look for component / hook / unit tests anywhere under src/.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Keep Playwright's tests/e2e folder out of Vitest's view.
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/test/**',
      ],
      /**
       * Coverage RATCHET (2026-05-23).
       *
       * Strategy: the FE has many large untested files (App.tsx,
       * ActivityFeedView, CMS editors) that can't realistically be
       * tested in one campaign. Setting a non-zero GLOBAL threshold
       * would break CI immediately for legitimate work.
       *
       * Instead we lock in PER-FILE thresholds on the helpers +
       * components we've now tested. Those files cannot regress below
       * their current bar without failing the suite. Each future PR
       * that touches them must keep coverage up.
       *
       * Adding a new tested file? Add an entry to this map with a
       * realistic target. Going down the list is the FE testing
       * campaign's roadmap.
       */
      thresholds: {
        // Global stays at 0% — see comment above.
        lines: 0,
        statements: 0,
        functions: 0,
        branches: 0,
        // Pure helpers — 100% achievable and worth holding to it.
        'src/lib/apiErrorMessage.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 90,
        },
        'src/lib/acceptanceCriteria.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 90,
        },
        'src/lib/formatters.ts': {
          lines: 85,
          statements: 85,
          functions: 90,
          branches: 80,
        },
        'src/lib/cn.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // Components with full React Testing Library coverage.
        'src/components/auth/Can.tsx': {
          lines: 95,
          statements: 95,
          functions: 100,
          branches: 80,
        },
        'src/components/kanban/MoveErrorToast.tsx': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 90,
        },
        // Hooks
        'src/hooks/usePermission.ts': {
          lines: 90,
          statements: 90,
          functions: 100,
          branches: 80,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
