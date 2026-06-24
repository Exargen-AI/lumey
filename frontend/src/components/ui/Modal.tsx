import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

type Size = 'sm' | 'md' | 'lg' | 'xl';
type AccentTone = 'brand' | 'success' | 'warning' | 'danger';

interface ModalProps {
  /** Whether the modal is shown. */
  open: boolean;
  /** Called when the user requests close (Escape key or backdrop click). */
  onClose: () => void;
  /**
   * Title shown in the header. Pass `null` to omit the header entirely (use a
   * custom layout inside `children`).
   */
  title?: string | null;
  /** Subtitle shown under the title. */
  subtitle?: string;
  /** Width preset. md (default) ≈ 28rem, sm ≈ 22rem, lg ≈ 36rem, xl ≈ 48rem. */
  size?: Size;
  /**
   * Style the header as a coloured banner (like the acknowledgment dialog).
   * When set, header text becomes white and the close button matches.
   */
  accent?: AccentTone;
  /** Footer slot — typically holds the primary/secondary action buttons. */
  footer?: ReactNode;
  /** Hide the X close button (e.g. for hard interstitials that must be answered). */
  hideClose?: boolean;
  /** Disable closing on Escape and backdrop click — same use case as hideClose. */
  modal?: boolean;
  children: ReactNode;
}

const SIZE_CLASS: Record<Size, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

// Each accent renders a gradient banner across the header. Brand violet is the
// default for "important" modals (acknowledgment, sign-off). Other tones are
// available for confirmations.
const ACCENT_HEADER: Record<AccentTone, string> = {
  brand:   'bg-gradient-to-br from-brand-600 via-brand-500 to-fuchsia-600 text-white',
  success: 'bg-gradient-to-br from-emerald-600 to-teal-600 text-white',
  warning: 'bg-gradient-to-br from-amber-500 to-orange-600 text-white',
  danger:  'bg-gradient-to-br from-rose-600 to-red-700 text-white',
};

/**
 * Standard modal dialog used across the app.
 *
 * Behaviour:
 *   - Mounted to <body> via portal so it isn't trapped inside scrollable parents.
 *   - Closes on Escape and backdrop click unless `modal` is true.
 *   - Body scroll is locked while open.
 *   - Focus moves into the dialog on open; returns to the trigger on close.
 *
 * Examples:
 *   <Modal open={open} onClose={() => setOpen(false)} title="Edit user">
 *     <Field label="Name"><Input value={name} onChange={...} /></Field>
 *   </Modal>
 *
 *   <Modal open={open} onClose={...} accent="brand" title="Confirm" subtitle="For: Project X"
 *     footer={<>
 *       <Button variant="ghost" onClick={onClose}>Cancel</Button>
 *       <Button variant="primary" onClick={onConfirm}>Confirm</Button>
 *     </>}>
 *     ...body...
 *   </Modal>
 */
export function Modal({
  open, onClose, title, subtitle, size = 'md', accent, footer, hideClose, modal, children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<Element | null>(null);

  // Lock body scroll + remember focus + focus the dialog on open.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus into the dialog so screen readers + keyboard work.
    requestAnimationFrame(() => dialogRef.current?.focus());

    return () => {
      document.body.style.overflow = prevOverflow;
      // Restore focus to whatever was active before opening.
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus();
      }
    };
  }, [open]);

  // Escape key closes (unless modal=true).
  useEffect(() => {
    if (!open || modal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, modal, onClose]);

  if (!open) return null;

  const headerOnAccent = !!accent;
  const accentClass = accent ? ACCENT_HEADER[accent] : '';

  const overlay = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/80 dark:bg-black/80 backdrop-blur-md p-4 animate-fade-in"
      onClick={modal ? undefined : onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          // 90dvh (dynamic viewport height) instead of 90vh so iOS Safari's
          // URL-bar push/pull doesn't push the modal's bottom edge off-
          // screen. Falls back to `auto` on browsers without dvh support
          // (pre-iOS 15.4 / pre-Chrome 108) — those render the modal at
          // its content height, which is fine for the small forms we use.
          'w-full max-h-[90dvh] flex flex-col overflow-hidden rounded-2xl outline-none',
          'bg-white dark:bg-obsidian-panel',
          'border border-gray-200 dark:border-obsidian-border',
          'shadow-pop dark:shadow-pop-dark',
          'animate-scale-in',
          SIZE_CLASS[size],
        )}
      >
        {/* ─── Header ─── */}
        {title !== null && (title || !hideClose) && (
          <div className={cn(
            'relative flex items-center gap-3 px-6 py-4 shrink-0',
            headerOnAccent
              ? cn('overflow-hidden', accentClass)
              : 'border-b border-gray-200 dark:border-obsidian-border',
          )}>
            {/* Accent header gets a subtle highlight */}
            {headerOnAccent && (
              <span aria-hidden className="pointer-events-none absolute inset-0 opacity-20"
                style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, rgba(255,255,255,0.4), transparent 40%)' }}
              />
            )}
            <div className="relative min-w-0 flex-1">
              {title && (
                <h2
                  id="modal-title"
                  className={cn(
                    'text-base font-semibold tracking-tight truncate',
                    headerOnAccent ? 'text-white' : 'text-gray-900 dark:text-obsidian-fg',
                  )}
                >
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className={cn(
                  'text-[13px] truncate mt-0.5',
                  headerOnAccent ? 'text-white/80' : 'text-gray-500 dark:text-obsidian-muted',
                )}>
                  {subtitle}
                </p>
              )}
            </div>
            {!hideClose && (
              <button
                onClick={onClose}
                className={cn(
                  'relative shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-md transition-colors',
                  headerOnAccent
                    ? 'text-white/80 hover:text-white hover:bg-white/15'
                    : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-raised',
                )}
                title="Close"
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}

        {/* ─── Body (scrollable) ─── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>

        {/* ─── Footer ─── */}
        {footer && (
          <div className={cn(
            'flex items-center justify-end gap-2 px-6 py-4 shrink-0',
            'border-t border-gray-200 dark:border-obsidian-border',
            'bg-gray-50 dark:bg-obsidian-sunken',
          )}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
