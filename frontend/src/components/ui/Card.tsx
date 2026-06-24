import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** When true, lifts on hover (use for clickable cards). */
  interactive?: boolean;
  /** Bigger padding for hero/dashboard cards. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Subtle gradient accent — for emphasis cards (e.g. "Today's Focus"). */
  accent?: 'none' | 'brand' | 'success' | 'warning' | 'danger';
}

const paddingClasses = {
  none: '',
  sm:   'p-3',
  md:   'p-5',
  lg:   'p-6',
};

const accentClasses = {
  none:    '',
  brand:   'bg-gradient-to-br from-brand-50 to-brand-50/40 dark:from-brand-950/30 dark:to-brand-950/10 border-brand-100 dark:border-brand-900/40',
  success: 'bg-gradient-to-br from-success-50 to-success-50/40 dark:from-success-500/5 dark:to-success-500/[0.03] border-success-100 dark:border-success-700/30',
  warning: 'bg-gradient-to-br from-warning-50 to-warning-50/40 dark:from-warning-500/5 dark:to-warning-500/[0.03] border-warning-100 dark:border-warning-700/30',
  danger:  'bg-gradient-to-br from-danger-50 to-danger-50/40 dark:from-danger-500/5 dark:to-danger-500/[0.03] border-danger-100 dark:border-danger-700/30',
};

/**
 * The standard surface for grouping content. Use everywhere you'd otherwise
 * write `bg-white rounded-xl border border-gray-200 p-N`.
 *
 * Examples:
 *   <Card>plain content</Card>
 *   <Card padding="lg" interactive onClick={...}>hover-lift card</Card>
 *   <Card accent="brand">Today's focus</Card>
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive, padding = 'md', accent = 'none', className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border bg-white dark:bg-gray-900',
        accent === 'none'
          ? 'border-gray-200 dark:border-gray-800'
          : accentClasses[accent],
        'shadow-soft',
        interactive && 'cursor-pointer hover-lift hover:shadow-lift focus-within:shadow-lift',
        paddingClasses[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

interface SectionProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  /** Right-aligned actions (buttons/links). */
  actions?: React.ReactNode;
}

/** Header bar inside a Card. Use to give a card a title + actions row. */
export function CardHeader({ title, subtitle, actions, className, children, ...rest }: SectionProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3 mb-4', className)} {...rest}>
      <div className="min-w-0 flex-1">
        {title && <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">{title}</h3>}
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  );
}
