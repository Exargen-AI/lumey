import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    // ─── PWA (Tier 1: install + offline shell) ─────────────────────────
    //
    // Lets users add the app to their phone home screen and launches it
    // fullscreen, with a fast cached shell on revisit.
    //
    // `registerType: 'autoUpdate'` makes the service worker grab a fresh
    // build the moment Vercel serves a new index.html. Combined with
    // Workbox's content-hashed precaching, a deploy is effectively
    // automatic — no Cmd+Shift+R needed.
    //
    // We register the SW manually from `main.tsx` (via the
    // `virtual:pwa-register` module the plugin exposes) so an explicit
    // "new version available" toast can be wired in later; today the
    // registration is silent.
    VitePWA({
      registerType: 'autoUpdate',
      // Files in /public that the SW should precache alongside the built
      // assets. Listed explicitly so the plugin doesn't sweep them in
      // surprising orders.
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'logo.jpeg',
      ],
      manifest: {
        name: 'Lumey Command Center',
        short_name: 'Lumey',
        description: 'Portfolio + project management for the Lumey studio. Track work, sign off deliverables, and submit bugs from anywhere.',
        // Match the iOS / Android theme-color metas in index.html so the
        // status-bar matches the app surface on launch.
        theme_color: '#fafbfc',
        background_color: '#fafbfc',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        // Bundle a sensible icon set. The 'any' icons cover the standard
        // adaptive case; 'maskable' lets Android crop into its launcher
        // shape without distorting the logo. Apple's `apple-touch-icon`
        // is referenced from index.html separately — manifest entries
        // don't influence iOS.
        icons: [
          { src: '/icon-192.png',           sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png',           sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/maskable-icon-512.png',  sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Shortcuts surface in the long-press menu on Android. Keeping
        // these to two evergreen, role-agnostic destinations — Today
        // and Account — so they make sense for every user role.
        shortcuts: [
          {
            name: 'Today',
            short_name: 'Today',
            description: 'See what shipped today across your projects.',
            url: '/today',
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Account',
            short_name: 'Account',
            description: 'Profile + password.',
            url: '/account',
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      workbox: {
        // Precache every build artifact (HTML, JS, CSS, font, image).
        // Workbox content-hashes them so cache busting is automatic.
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,woff,woff2}'],
        // Network-first for API responses (under /api/v1/*) — we never
        // want to serve stale task / project data from cache. If the
        // network's down, the cache becomes the fallback (Workbox
        // default behaviour).
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'exargen-api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Long-lived asset hosts (S3 documents, S3 presigned URLs).
          // Stale-while-revalidate: serve cached copy immediately, refresh
          // in background. Documents rarely change once uploaded so this
          // gives a near-instant repeat fetch.
          {
            urlPattern: /^https:\/\/.*\.amazonaws\.com\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'exargen-s3-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // Fall back to the SPA shell for navigation requests that aren't
        // in the precache. Without this, deep-linked routes (/client/projects/.../foo)
        // 404 when navigated to from an installed home-screen launch.
        navigateFallback: '/index.html',
        // Don't fall back for /api/* or static asset paths — those should
        // hit the network / runtimeCaching path above.
        navigateFallbackDenylist: [/^\/api\//, /^\/assets\//],
      },
      devOptions: {
        // Keep the SW disabled in `vite dev` so HMR doesn't fight with
        // precaching. The PWA experience is only meaningful on the
        // production build anyway.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Split heavy vendors into their own chunks so first-paint doesn't
    // download a 1.9 MB monolith (QA H-H5). Chunks are cached
    // independently — TipTap doesn't need to re-download when only the
    // app code changes, recharts only when an analytics page is hit, etc.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-tiptap': ['@tiptap/react', '@tiptap/core', '@tiptap/starter-kit', '@tiptap/extension-placeholder', '@tiptap/extension-link'],
          'vendor-charts': ['recharts'],
          'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          'vendor-icons': ['lucide-react'],
          'vendor-query': ['@tanstack/react-query', 'zustand'],
          'vendor-utils': ['axios', 'dompurify', 'date-fns'],
        },
      },
    },
  },
});
