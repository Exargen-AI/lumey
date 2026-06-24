import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { initErrorReporting } from './lib/errorReporter';
import './index.css';

// Install global error + unhandledrejection listeners before first render.
// No-op unless VITE_ERROR_REPORTING_DSN is configured.
initErrorReporting();

// PWA service worker registration. Vite-plugin-pwa exposes the
// `virtual:pwa-register` module at build time; the SW itself is only
// generated for production builds (devOptions.enabled is false in
// vite.config). `immediate: true` activates the SW on first load
// rather than waiting for the next page; `autoUpdate` registration
// type means a new build replaces the cached shell without prompting.
// We don't surface a "new version available" toast yet — keep this
// silent and additive for Tier 1.
if (typeof window !== 'undefined') {
  registerSW({ immediate: true });
}

// Apply dark class synchronously, before first render — prevents the
// light-mode flash on /login (which renders outside AppShell, where the
// reactive useEffect lives). Default: dark, matching Obsidian's identity.
(() => {
  const stored = localStorage.getItem('darkMode');
  const isDark = stored !== null ? stored === 'true' : true;
  document.documentElement.classList.toggle('dark', isDark);
})();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
