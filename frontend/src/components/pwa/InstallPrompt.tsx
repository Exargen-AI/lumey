import { useEffect, useState } from 'react';
import { Download, Share, Plus, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * "Add to Home Screen" prompt for mobile.
 *
 * Two install pathways exist in the wild:
 *
 *   1. **Chromium-family browsers (Android Chrome, Edge, Samsung
 *      Internet)** fire a `beforeinstallprompt` event we can stash and
 *      replay on user click — opens the native install dialog with one
 *      tap. That's the happy path.
 *
 *   2. **Safari on iOS / iPadOS** doesn't fire `beforeinstallprompt`.
 *      We can't auto-install; the user has to tap Share → "Add to
 *      Home Screen" themselves. The prompt below detects iOS and
 *      shows step-by-step instructions instead of a single button.
 *
 * Dismissal persists in localStorage for 14 days so the toast doesn't
 * nag on every page navigation. A user who installs satisfies
 * `display-mode: standalone`, which suppresses the prompt entirely
 * (the install check below).
 *
 * Hidden at `lg+` — desktop users have ample browser chrome to do
 * "Install app" through the address-bar menu themselves; a banner
 * there would just be noise.
 */

const DISMISS_KEY = 'pwa.install-prompt.dismissed-at';
const DISMISS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/** Chromium's beforeinstallprompt event shape. Not in lib.dom yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPad on modern iPadOS reports as Macintosh + touch — the touch check
  // disambiguates from a real desktop Safari.
  return /iPhone|iPad|iPod/.test(ua)
    || (ua.includes('Macintosh') && 'ontouchend' in document);
}

function isAlreadyInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  // The display-mode media query flips to 'standalone' when the app is
  // launched from the home screen. iOS also exposes `navigator.standalone`.
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  if ((window.navigator as any).standalone === true) return true;
  return false;
}

function isDismissedRecently(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number.parseInt(raw, 10);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < DISMISS_WINDOW_MS;
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch { /* Safari private mode etc. */ }
}

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Bail entirely if already installed or recently dismissed. Done
  // inside an effect (not on initial render) so server-side / first
  // paint doesn't flash content we're about to hide.
  useEffect(() => {
    if (isAlreadyInstalled() || isDismissedRecently()) {
      setDismissed(true);
    }
  }, []);

  // Chromium path: capture the beforeinstallprompt event. We
  // preventDefault to suppress the browser's own mini-infobar and
  // surface our toast instead.
  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  if (dismissed) return null;

  const ios = isIOS();
  // Don't show anything if Chromium hasn't fired the install event AND
  // we're not on iOS — the user's browser doesn't support PWAs (rare)
  // or they're on desktop where this banner is `lg:hidden` anyway.
  if (!installEvent && !ios) return null;

  const handleInstall = async () => {
    if (installEvent) {
      // Chromium: open the native install dialog. Whether the user
      // accepts or not, the event becomes single-use — clear it.
      try {
        await installEvent.prompt();
        await installEvent.userChoice;
      } catch { /* user closed dialog; the event still consumed itself */ }
      setInstallEvent(null);
      setDismissed(true);
      markDismissed();
    } else if (ios) {
      // iOS: there's no native trigger. Show step-by-step instructions.
      setShowIOSInstructions(true);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    markDismissed();
  };

  // iOS instructions sheet — only rendered when the user explicitly
  // taps "Install" while on Safari. Same shape as the MoreSheet —
  // bottom-anchored, dismissible by backdrop / close.
  if (showIOSInstructions) {
    return (
      <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label="Add to Home Screen">
        <button
          type="button"
          aria-label="Close"
          onClick={handleDismiss}
          className="absolute inset-0 bg-gray-900/55 dark:bg-black/65 backdrop-blur-[2px] animate-fade-in"
        />
        <div
          className={cn(
            'absolute inset-x-0 bottom-0',
            'bg-white dark:bg-obsidian-panel',
            'border-t border-gray-200 dark:border-obsidian-border',
            'rounded-t-2xl shadow-pop dark:shadow-pop-dark',
            'pb-[env(safe-area-inset-bottom)]',
          )}
          style={{ animation: 'sheetSlideUpInstall 0.22s cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          <div className="flex justify-center pt-2 pb-1">
            <span className="w-10 h-1 rounded-full bg-gray-200 dark:bg-obsidian-border" aria-hidden />
          </div>
          <div className="px-5 pt-2 pb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-gray-900 dark:text-obsidian-fg">
              Add to Home Screen
            </h2>
            <button
              type="button"
              onClick={handleDismiss}
              className="w-9 h-9 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-raised transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
          <ol className="px-5 pb-5 space-y-3 text-[13.5px] text-gray-700 dark:text-obsidian-fg leading-relaxed">
            <li className="flex items-start gap-3">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 text-[12px] font-semibold shrink-0">1</span>
              <span className="flex-1">
                Tap the{' '}
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-obsidian-raised text-gray-800 dark:text-obsidian-fg font-medium text-[12px]">
                  <Share size={11} /> Share
                </span>{' '}
                button at the bottom of Safari.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 text-[12px] font-semibold shrink-0">2</span>
              <span className="flex-1">
                Scroll down and tap{' '}
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-obsidian-raised text-gray-800 dark:text-obsidian-fg font-medium text-[12px]">
                  <Plus size={11} /> Add to Home Screen
                </span>.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 text-[12px] font-semibold shrink-0">3</span>
              <span className="flex-1">
                Tap <span className="font-medium">Add</span> in the top corner. Exargen will open fullscreen from your home screen.
              </span>
            </li>
          </ol>
        </div>
        <style>{`
          @keyframes sheetSlideUpInstall {
            from { transform: translateY(100%); }
            to   { transform: translateY(0); }
          }
        `}</style>
      </div>
    );
  }

  // Default state: a small bottom-anchored toast sitting ABOVE the
  // MobileBottomNav (which is at `bottom-0` with z-40). We're at z-50
  // so we stack above the nav; the offset clears the nav's h-14 + safe
  // area. Dismissible via the X; tap "Install" to open the dialog
  // (Chromium) or show iOS instructions.
  return (
    <div
      className={cn(
        'lg:hidden fixed left-3 right-3 z-50',
        // Lift above the bottom navbar — same math as BulkActionBar.
        'bottom-[calc(4rem+env(safe-area-inset-bottom))]',
        'rounded-xl border shadow-pop dark:shadow-pop-dark',
        'bg-white dark:bg-obsidian-panel',
        'border-brand-200 dark:border-brand-500/40',
        'p-3 flex items-center gap-3 animate-fade-in-up',
      )}
      role="region"
      aria-label="Install Exargen on your home screen"
    >
      <div className="w-10 h-10 rounded-lg bg-brand-100 dark:bg-brand-500/20 flex items-center justify-center shrink-0">
        <Download size={16} className="text-brand-700 dark:text-brand-300" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-gray-900 dark:text-obsidian-fg leading-tight">
          Install Exargen
        </p>
        <p className="text-[11.5px] text-gray-500 dark:text-obsidian-muted leading-snug mt-0.5">
          Add it to your home screen for a faster, fullscreen experience.
        </p>
      </div>
      <button
        type="button"
        onClick={handleInstall}
        className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-medium bg-brand-600 hover:bg-brand-700 text-white shadow-soft transition-colors min-h-[36px]"
      >
        Install
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 dark:text-obsidian-faded dark:hover:text-obsidian-fg hover:bg-gray-100 dark:hover:bg-obsidian-raised transition-colors"
        aria-label="Dismiss"
        title="Not now"
      >
        <X size={15} />
      </button>
    </div>
  );
}
