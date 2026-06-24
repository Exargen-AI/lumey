import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
type Size = 'xs' | 'sm';

interface Props {
  tone?: Tone;
  size?: Size;
  /** Show a small leading dot (helpful for status badges). */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  brand:   'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
  success: 'bg-success-100 text-success-700 dark:bg-success-500/15 dark:text-success-500',
  warning: 'bg-warning-100 text-warning-700 dark:bg-warning-500/15 dark:text-warning-500',
  danger:  'bg-danger-100 text-danger-700 dark:bg-danger-500/15 dark:text-danger-500',
  info:    'bg-info-100 text-info-700 dark:bg-info-500/15 dark:text-info-500',
};

const dotClasses: Record<Tone, string> = {
  neutral: 'bg-gray-400',
  brand:   'bg-brand-500',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger:  'bg-danger-500',
  info:    'bg-info-500',
};

const sizeClasses: Record<Size, string> = {
  xs: 'text-2xs px-1.5 h-4 rounded',
  sm: 'text-xs px-2 h-5 rounded-md',
};

/**
 * Compact, semantic status pill. Use everywhere you'd otherwise write
 * `<span class="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">`.
 *
 * Examples:
 *   <Badge tone="success">Done</Badge>
 *   <Badge tone="danger" dot>Blocked</Badge>
 *   <Badge tone="brand" size="xs">P0</Badge>
 */
export function Badge({ tone = 'neutral', size = 'sm', dot, className, children }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium whitespace-nowrap',
        toneClasses[tone],
        sizeClasses[size],
        className,
      )}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotClasses[tone])} />}
      {children}
    </span>
  );
}
