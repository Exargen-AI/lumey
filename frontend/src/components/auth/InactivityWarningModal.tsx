import { useEffect } from 'react';
import { Clock } from 'lucide-react';
import { Modal, Button } from '@/components/ui';

interface InactivityWarningModalProps {
  /** True when we're inside the warning window (60s before forced logout). */
  open: boolean;
  /** Seconds remaining until the forced logout fires. */
  secondsLeft: number;
  /** "Stay signed in" — resets the inactivity timer. */
  onStay: () => void;
  /** "Sign out now" — fires the logout immediately rather than waiting out the timer. */
  onLogoutNow: () => void;
}

/**
 * Warning interstitial shown for the last 60 seconds of the inactivity
 * window. Two actions:
 *   - "Stay signed in" → resets the sliding-window timer (and broadcasts to
 *     other tabs so they reset too).
 *   - "Sign out now"   → fires the same logout the timer would have, just
 *     immediately.
 *
 * No `onClose` (X / backdrop) — the user has to make an explicit choice.
 * This is by design: an idle laptop in a coffee shop should never half-
 * dismiss the warning and then silently extend the session.
 *
 * Also pings the document title every second so a user who's switched tabs
 * gets a visible nudge without us having to request notification permission.
 */
export function InactivityWarningModal({ open, secondsLeft, onStay, onLogoutNow }: InactivityWarningModalProps) {
  // Tab-title ping. Restore the original title on close so a user who comes
  // back from another tab doesn't see "(0s) Sign out warning…" lingering.
  useEffect(() => {
    if (!open) return;
    const original = document.title;
    document.title = `(${secondsLeft}s) Signing you out…`;
    return () => { document.title = original; };
  }, [open, secondsLeft]);

  // Format mm:ss — a single 0:59 reads cleaner than "59 seconds".
  const mm = Math.floor(secondsLeft / 60);
  const ss = (secondsLeft % 60).toString().padStart(2, '0');

  return (
    <Modal
      open={open}
      onClose={onStay}
      title={null}
      size="sm"
      hideClose
      modal
    >
      <div className="px-5 py-4 flex flex-col items-center text-center gap-3">
        <div className="w-11 h-11 rounded-full bg-amber-50 dark:bg-amber-500/[0.12] flex items-center justify-center">
          <Clock size={22} className="text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-obsidian-fg">
            Are you still here?
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-obsidian-muted">
            For your security we'll sign you out after 15 minutes of inactivity.
          </p>
        </div>
        <div className="text-2xl font-mono tabular-nums text-gray-900 dark:text-obsidian-fg">
          {mm}:{ss}
        </div>
        <div className="flex gap-2 w-full pt-1">
          <Button variant="ghost" className="flex-1" onClick={onLogoutNow}>
            Sign out now
          </Button>
          <Button variant="primary" className="flex-1" onClick={onStay}>
            Stay signed in
          </Button>
        </div>
      </div>
    </Modal>
  );
}
