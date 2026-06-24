import { useEffect, useState } from 'react';
import { Monitor, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Soft "this page is better on desktop" banner. Renders ONLY at `< lg`
 * (1024px) — the same boundary the mobile shell pivots on. Above that
 * it's a no-op.
 *
 * Why soft hint over hard block: the pages we attach this to (RBAC
 * matrix, Gantt timeline, TipTap blog editor) are usable on mobile in
 * a pinch — RBAC is mostly read-heavy, Timeline can be panned, the
 * blog editor renders content fine even if editing is fiddly. A hard
 * block would frustrate someone who just wants a quick look from
 * their phone. The hint nudges them to switch when they have the
 * choice.
 *
 * Dismissal persists per-page (via the `dismissKey` prop) in
 * localStorage so the user doesn't see it every time they navigate
 * back. Each page passes a stable key so the dismissal scope is clear.
 *
 * The banner uses `lg:hidden` instead of a JS viewport check so the
 * initial render on mobile doesn't flash empty space waiting for the
 * matchMedia listener to fire.
 */

interface DesktopHintProps {
  /** Stable localStorage key for this page's dismissal state. Pages
   *  pass something like `desktop-hint.rbac`. */
  dismissKey: string;
  /** One-sentence reason. Default: a generic "this page is denser
   *  than a phone screen can comfortably show". */
  reason?: string;
  /** Tone — `info` (default) for "would be nicer on desktop", `warn`
   *  for "you'll probably get stuck on phone" (e.g. TipTap editor). */
  tone?: 'info' | 'warn';
}

export function DesktopHint({ dismissKey, reason, tone = 'info' }: DesktopHintProps) {
  const storageKey = `desktop-hint.${dismissKey}`;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (dismissed) {
      try { window.localStorage.setItem(storageKey, '1'); } catch { /* private mode */ }
    }
  }, [dismissed, storageKey]);

  if (dismissed) return null;

  const palette = tone === 'warn'
    ? {
        bg:    'bg-amber-50 dark:bg-amber-500/10',
        ring:  'border-amber-200 dark:border-amber-500/30',
        icon:  'text-amber-700 dark:text-amber-300',
        title: 'text-amber-900 dark:text-amber-200',
        body:  'text-amber-800/80 dark:text-amber-200/80',
        hover: 'hover:bg-amber-100 dark:hover:bg-amber-500/15',
      }
    : {
        bg:    'bg-indigo-50 dark:bg-indigo-500/10',
        ring:  'border-indigo-200 dark:border-indigo-500/30',
        icon:  'text-indigo-700 dark:text-indigo-300',
        title: 'text-indigo-900 dark:text-indigo-200',
        body:  'text-indigo-800/80 dark:text-indigo-200/80',
        hover: 'hover:bg-indigo-100 dark:hover:bg-indigo-500/15',
      };

  const defaultReason = tone === 'warn'
    ? 'Editing this page on a phone can be fiddly — the toolbar and inline controls don\'t lay out comfortably below 1024px.'
    : 'This page is denser than a phone screen can comfortably show. Most cards + tables work, but you\'ll see scrolling and small hit-targets.';

  return (
    <div className={cn(
      'lg:hidden rounded-xl border p-4 mb-4 flex items-start gap-3',
      palette.bg,
      palette.ring,
    )}>
      <div className={cn(
        'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
        tone === 'warn' ? 'bg-amber-100 dark:bg-amber-500/20' : 'bg-indigo-100 dark:bg-indigo-500/20',
      )}>
        <Monitor size={15} className={palette.icon} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn('text-[13px] font-semibold', palette.title)}>
          Best viewed on a larger screen
        </p>
        <p className={cn('mt-0.5 text-[12px] leading-snug', palette.body)}>
          {reason ?? defaultReason}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className={cn(
          'shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-md transition-colors',
          palette.icon,
          palette.hover,
        )}
        aria-label="Dismiss desktop hint"
        title="Got it"
      >
        <X size={15} />
      </button>
    </div>
  );
}
