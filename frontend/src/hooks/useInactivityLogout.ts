import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';

/**
 * Inactivity-based auto-logout.
 *
 * Why: the access JWT is 15 min and rotates silently on activity, so a user
 * who walks away from a logged-in tab stays "logged in" indefinitely as long
 * as nothing in the tab fires a request. For a tool that holds project,
 * client, and engineering data, that's not acceptable on a shared
 * workstation. This hook adds a sliding-window timer:
 *
 *   - Reset on any user input (mousemove, keydown, scroll, click, touchstart,
 *     wheel, focus). We listen on `document` so the events bubble from any
 *     element. Also listens on visibilitychange so the timer pauses while
 *     the tab is hidden — leaving the laptop closed shouldn't burn the
 *     budget.
 *   - At T-2min before logout, surface a warning state so the UI can show a
 *     "you'll be logged out in 2 minutes — click to stay" prompt.
 *   - At T=0, call the supplied logout callback (which clears auth + hits
 *     /logout to revoke the refresh token row server-side).
 *
 * Cross-tab: if the user is active in tab A, tab B's timer should also
 * reset. We use the same BroadcastChannel as authStore (`exargen-auth`) and
 * post `{ type: 'activity' }` on every meaningful local activity — debounced
 * to once per 5s so we don't spam the channel.
 *
 * Window sizing (May 2026 — user feedback): the original 15-minute window
 * meant every coffee/meeting kicked people out, and combined with a tab
 * close that's experienced as "it asks me to log in every time I come
 * back." Bumped to 12 hours — covers a full work shift plus a long lunch
 * and a meeting, but still kicks unattended sessions out before an
 * overnight cleaner walks past. The 2-minute warning gives breathing
 * room to dismiss without panic.
 */

/**
 * Total inactivity window before logout. Override per-environment via
 * `VITE_INACTIVITY_TIMEOUT_MS` in `.env` — primarily a dev escape hatch
 * so debugging long flows doesn't auto-logout (QA H-H6). Negative or
 * zero disables the auto-logout path entirely.
 *
 * Default: 12 hours. See doc-comment above for the reasoning.
 */
const ENV_OVERRIDE_MS = Number(import.meta.env.VITE_INACTIVITY_TIMEOUT_MS);
export const INACTIVITY_TIMEOUT_MS = Number.isFinite(ENV_OVERRIDE_MS) && ENV_OVERRIDE_MS > 0
  ? ENV_OVERRIDE_MS
  : 12 * 60 * 60 * 1000;
/** Window in which the "you'll be logged out" warning is shown. Capped
 *  to never exceed half the timeout. 2 min gives a comfortable click-to-
 *  stay window without feeling jumpy. */
export const INACTIVITY_WARNING_MS = Math.min(2 * 60 * 1000, Math.floor(INACTIVITY_TIMEOUT_MS / 2));
/** Disables the auto-logout entirely. Set `VITE_INACTIVITY_TIMEOUT_MS=0`
 *  in dev to keep debugging sessions alive. */
export const INACTIVITY_DISABLED = Number.isFinite(ENV_OVERRIDE_MS) && ENV_OVERRIDE_MS <= 0;
/** Cross-tab activity broadcast debounce. */
const ACTIVITY_BROADCAST_DEBOUNCE_MS = 5_000;

type Phase = 'active' | 'warning';

const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'wheel',
  'scroll',
  // NOTE: `visibilitychange` is NOT in this list. The original
  // implementation included it, which meant tabbing away or coming back
  // RESET the timer (the doc-comment + admin playbook claimed otherwise).
  // QA A-H1: a user who tabs between this app and Slack every 10 minutes
  // would never get logged out. The hidden-tab path is now handled
  // separately by `handleVisibilityChange` below — when the tab becomes
  // hidden we record the timestamp so we can decide on return whether
  // enough time has passed to force a logout.
];

export function useInactivityLogout(onLogout: () => void) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [phase, setPhase] = useState<Phase>('active');
  const [secondsLeft, setSecondsLeft] = useState(Math.floor(INACTIVITY_WARNING_MS / 1000));

  const lastActivityRef = useRef<number>(Date.now());
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBroadcastRef = useRef<number>(0);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const clearAllTimers = useCallback(() => {
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    warnTimerRef.current = null;
    logoutTimerRef.current = null;
    tickRef.current = null;
  }, []);

  const scheduleTimers = useCallback(() => {
    clearAllTimers();
    setPhase('active');

    warnTimerRef.current = setTimeout(() => {
      setPhase('warning');
      // Start a 1Hz countdown for the warning UI. Lightweight; only runs
      // during the 60-second warning window.
      setSecondsLeft(Math.floor(INACTIVITY_WARNING_MS / 1000));
      tickRef.current = setInterval(() => {
        setSecondsLeft((s) => Math.max(0, s - 1));
      }, 1_000);
    }, INACTIVITY_TIMEOUT_MS - INACTIVITY_WARNING_MS);

    logoutTimerRef.current = setTimeout(() => {
      // Fire logout. The hook's caller is expected to call clearAuth + hit
      // /logout; we don't do it here to keep this hook UI-only and avoid
      // pulling axios into the dependency graph.
      onLogout();
    }, INACTIVITY_TIMEOUT_MS);
  }, [clearAllTimers, onLogout]);

  const recordActivity = useCallback((opts: { broadcast?: boolean } = {}) => {
    const now = Date.now();
    lastActivityRef.current = now;
    scheduleTimers();
    if (opts.broadcast !== false && channelRef.current) {
      // Debounce so a continuous mousemove doesn't spam every other tab.
      if (now - lastBroadcastRef.current >= ACTIVITY_BROADCAST_DEBOUNCE_MS) {
        lastBroadcastRef.current = now;
        try { channelRef.current.postMessage({ type: 'activity', at: now }); } catch { /* SSR / tab closed */ }
      }
    }
  }, [scheduleTimers]);

  // The "stay signed in" button calls this. Same as recordActivity but force-
  // broadcasts so other tabs synchronise immediately rather than waiting up
  // to 5s for the debounce window.
  const stayLoggedIn = useCallback(() => {
    lastBroadcastRef.current = 0;
    recordActivity();
  }, [recordActivity]);

  useEffect(() => {
    if (!isAuthenticated || INACTIVITY_DISABLED) {
      // Auth gate OR explicit dev disable — clear any in-flight timers
      // and don't install listeners.
      clearAllTimers();
      setPhase('active');
      return;
    }

    // BroadcastChannel for cross-tab sync. authStore already creates one
    // for login/logout messages; we instantiate a separate channel object
    // (same name) because BroadcastChannel doesn't expose a singleton —
    // multiple instances on the same tab still share the wire.
    const channel: BroadcastChannel | null =
      typeof window !== 'undefined' && 'BroadcastChannel' in window
        ? new BroadcastChannel('exargen-auth')
        : null;
    channelRef.current = channel;

    const handler = () => recordActivity();
    ACTIVITY_EVENTS.forEach((evt) => document.addEventListener(evt, handler, { passive: true }));

    // QA A-H1: visibilitychange is handled separately. When the tab goes
    // hidden, we DON'T reset (the user isn't doing anything visible).
    // When the tab comes back, we check how long it's been hidden — if
    // longer than the inactivity window, the timer has effectively
    // already expired and we logout immediately.
    let hiddenAtRef: number | null = null;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef = Date.now();
      } else if (document.visibilityState === 'visible' && hiddenAtRef != null) {
        const hiddenFor = Date.now() - hiddenAtRef;
        hiddenAtRef = null;
        if (hiddenFor >= INACTIVITY_TIMEOUT_MS) {
          // Tab was hidden longer than the whole window — log out now.
          onLogout();
        }
        // Otherwise we DON'T reset the timer; the user just came back to
        // a tab they hadn't given activity to. The next real input event
        // (mousemove etc.) will reset it normally.
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // window.focus is similar — used to mean "user is on this tab."
    // Removed from the auto-reset path because alt-tabbing back into
    // the window without doing anything shouldn't extend the session.
    // (Same reasoning as visibilitychange.)

    if (channel) {
      channel.onmessage = (e) => {
        if (e.data?.type === 'activity') {
          // Sibling tab saw activity — reset our timer too, but ONLY if
          // we're currently visible. A hidden tab in a closed laptop
          // shouldn't have its session extended just because some other
          // tab on a coworker's monitor is busy. (QA A-M1 partial fix.)
          if (document.visibilityState !== 'hidden') {
            recordActivity({ broadcast: false });
          }
        }
        // Logout/login messages are handled by authStore.
      };
    }

    // Initial schedule.
    recordActivity({ broadcast: false });

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => document.removeEventListener(evt, handler));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearAllTimers();
      if (channel) {
        try { channel.close(); } catch { /* ignore */ }
        channelRef.current = null;
      }
    };
  }, [isAuthenticated, recordActivity, clearAllTimers, onLogout]);

  return {
    phase,
    secondsLeft,
    stayLoggedIn,
  };
}
