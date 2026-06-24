import { useState, useRef, useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Side = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  /** The text shown in the tooltip. Pass a React node for richer content. */
  content: ReactNode;
  /** Which side of the trigger to render the tooltip. Defaults to top. */
  side?: Side;
  /** Hover delay in ms before showing. Defaults to 250 to avoid flicker on transit. */
  delay?: number;
  /**
   * The element that triggers the tooltip on hover/focus. Must accept the
   * standard mouse + focus event handlers (any HTMLElement does).
   */
  children: ReactNode;
  /** Disable the tooltip — useful when content is empty or trigger is disabled. */
  disabled?: boolean;
}

const SIDE_CLASS: Record<Side, string> = {
  top:    'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left:   'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right:  'left-full top-1/2 -translate-y-1/2 ml-1.5',
};

const ARROW_CLASS: Record<Side, string> = {
  top:    'top-full left-1/2 -translate-x-1/2 -mt-px border-x-transparent border-b-transparent',
  bottom: 'bottom-full left-1/2 -translate-x-1/2 -mb-px border-x-transparent border-t-transparent',
  left:   'left-full top-1/2 -translate-y-1/2 -ml-px border-y-transparent border-r-transparent',
  right:  'right-full top-1/2 -translate-y-1/2 -mr-px border-y-transparent border-l-transparent',
};

/**
 * Lightweight tooltip — wraps an element, shows a positioned bubble on hover/focus.
 * Use for short hints. For richer help/explanations, prefer a Popover-style component.
 *
 * Examples:
 *   <Tooltip content="Sign out"><button><LogOut /></button></Tooltip>
 *   <Tooltip content="Press ⌘K" side="bottom"><Search /></Tooltip>
 */
export function Tooltip({ content, side = 'top', delay = 250, children, disabled }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const show = () => {
    if (disabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  if (disabled || !content) return <>{children}</>;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            'absolute z-[60] pointer-events-none',
            'whitespace-nowrap text-[11px] font-medium',
            'px-2 py-1 rounded-md',
            'bg-gray-900 text-white dark:bg-obsidian-raised dark:text-obsidian-fg dark:ring-1 dark:ring-obsidian-border-strong',
            'shadow-pop',
            'animate-fade-in',
            SIDE_CLASS[side],
          )}
        >
          {content}
          <span
            aria-hidden
            className={cn(
              'absolute w-0 h-0 border-[5px]',
              'border-gray-900 dark:border-obsidian-raised',
              ARROW_CLASS[side],
            )}
          />
        </span>
      )}
    </span>
  );
}
