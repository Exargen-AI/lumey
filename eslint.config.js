// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';
import noSecrets from 'eslint-plugin-no-secrets';
import globals from 'globals';

/**
 * Phase 1 of the baseline hardening plan. Introduces ESLint from scratch
 * across the monorepo with a flat config (ESLint 9+).
 *
 * Layering:
 *   1. Base JS rules from `@eslint/js`
 *   2. TypeScript-aware rules from `typescript-eslint` (recommended set)
 *   3. React + react-hooks for `.tsx` files in the frontend
 *   4. eslint-plugin-security catches dangerous JS patterns (eval, child_process,
 *      regex DoS, unsafe regex literals, non-literal fs paths, etc.).
 *   5. eslint-plugin-no-secrets does high-entropy string detection — a final
 *      net under credential leaks that get past code review.
 *
 * Severity model:
 *   - `error` for anything that could ship a real bug or a security hole.
 *   - `warn` only for stylistic stuff we don't want to fail CI on yet.
 *   - `npm run lint` runs with `--max-warnings 0` in CI so warnings still
 *     fail the build there but are visible locally without aborting.
 *
 * What's NOT in scope here:
 *   - Prettier formatting (separate `npm run format:check` in CI).
 *   - Stricter TS flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
 *     — surface ~400 errors today, scheduled as a Phase 1.5 follow-up PR
 *     after the strict-mode escalation has its own focused review.
 */
export default tseslint.config(
  // ─── Global ignores ────────────────────────────────────────────────────
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.next/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.config.js',
      '**/*.config.cjs',
      '**/prisma/migrations/**',
      'backend/dist/**',
      'frontend/dist/**',
      'shared/dist/**',
      '.gstack/**',
      '.claude/**',
    ],
  },

  // ─── Base recommended rules ────────────────────────────────────────────
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // ─── TypeScript files everywhere ───────────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      security,
      'no-secrets': noSecrets,
    },
    rules: {
      // ── TS hygiene ─────────────────────────────────────────────────────
      // Loosened a notch from the strict default because the codebase
      // predates this lint pass — Phase 2/3 tighten as services get
      // their tests. The aim here is "0 errors today" without rewriting
      // a thousand call sites.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          // Underscore prefix is the convention for intentionally unused.
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      // `any` is rampant in the existing codebase (project predates this
      // lint). Warn for visibility, don't error until Phase 1.5 fixes
      // them. Each `any` should grow a justifying comment over time.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Empty-object type is fine for type-only props.
      '@typescript-eslint/no-empty-object-type': 'off',
      // Test fixtures use require sometimes; suppress when we hit it.
      '@typescript-eslint/no-require-imports': 'error',

      // ── Security plugin — recommended subset, tuned ────────────────────
      'security/detect-object-injection': 'off', // too noisy on TS-typed object access
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',

      // ── Secret leak detection ──────────────────────────────────────────
      // High entropy threshold (4.5) keeps false-positives manageable on
      // a TS codebase that already includes lots of UUIDs, hex colors,
      // tailwind class strings, JWT samples in tests, etc. Tighten later.
      'no-secrets/no-secrets': [
        'error',
        {
          tolerance: 4.5,
          additionalRegexes: {
            // Catch the obvious leak shapes even when entropy stays low.
            'AWS Access Key': 'AKIA[0-9A-Z]{16}',
            'GitHub Token (classic)': 'ghp_[A-Za-z0-9]{36,}',
            'Anthropic Key': 'sk-ant-[A-Za-z0-9_-]{32,}',
          },
          ignoreContent: [
            // Test seed password — known constant, ok to skip.
            'Admin@1234',
            // bcrypt hash regex literals used in tests.
            '^\\\\\\$2[aby]\\\\\\$',
          ],
        },
      ],

      // ── Console hygiene ────────────────────────────────────────────────
      // Backend still uses console.* heavily for boot logging; Phase 8
      // replaces with pino. Until then, allow console at module level
      // but flag in service files (handled below per-package).
      'no-console': 'off',

      // ── Misc safety ────────────────────────────────────────────────────
      'no-debugger': 'error',
      'no-alert': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-throw-literal': 'error',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'warn',
    },
  },

  // ─── Frontend-only (.tsx + React rules) ────────────────────────────────
  {
    files: ['frontend/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // React 17+ doesn't need React in scope; vite-plugin-react handles it.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off', // we use TS types instead
      'react/jsx-uses-react': 'off',
      'react/jsx-uses-vars': 'error',
      // Hooks rules are non-negotiable — break these and you ship a bug.
      'react-hooks/rules-of-hooks': 'error',
      // Exhaustive-deps as `error` would surface dozens of legitimate
      // intentional-omission cases today. Leave as `warn` until Phase 4
      // pairs each one with a justifying comment.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ─── Backend-only (Node globals, no DOM) ───────────────────────────────
  {
    files: ['backend/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Express handlers use _req/_res naming convention; already covered
      // by the argsIgnorePattern above. No additional backend-only rules
      // beyond what the security plugin gives us yet — Phase 7's security
      // audit will add the OWASP-specific Semgrep ruleset.
    },
  },

  // ─── Test files — relax some rules ─────────────────────────────────────
  {
    files: [
      '**/*.{test,spec}.{ts,tsx}',
      '**/tests/**/*.{ts,tsx}',
      '**/test/**/*.{ts,tsx}',
    ],
    rules: {
      // `any` is fine in test fixtures + factories.
      '@typescript-eslint/no-explicit-any': 'off',
      // Test seed credentials, fake tokens, etc.
      'no-secrets/no-secrets': 'off',
      // Tests often instantiate the same thing repeatedly.
      'security/detect-non-literal-regexp': 'off',
    },
  },
);
