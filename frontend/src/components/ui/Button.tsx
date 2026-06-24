import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size    = 'xs' | 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Icon shown on the left. Pass a JSX node, e.g. `<Plus size={14} />`. */
  leadingIcon?: ReactNode;
  /** Icon shown on the right. */
  trailingIcon?: ReactNode;
  /** When true, button stretches to its container width. */
  fullWidth?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 ' +
    'shadow-soft hover:shadow-lift',
  secondary:
    'bg-white text-gray-900 border border-gray-200 hover:bg-gray-50 active:bg-gray-100 ' +
    'dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 ' +
    'shadow-soft',
  ghost:
    'bg-transparent text-gray-700 hover:bg-gray-100 active:bg-gray-200 ' +
    'dark:text-gray-300 dark:hover:bg-gray-800 dark:active:bg-gray-700',
  danger:
    'bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-700 ' +
    'shadow-soft hover:shadow-lift',
  success:
    'bg-success-600 text-white hover:bg-success-700 active:bg-success-700 ' +
    'shadow-soft hover:shadow-lift',
};

const sizeClasses: Record<Size, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1 rounded-md',
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-md',
  md: 'h-9 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-base gap-2 rounded-lg',
};

/**
 * The single Button primitive used across the app.
 *
 * Examples:
 *   <Button>Save</Button>                              // primary, md
 *   <Button variant="secondary" size="sm">Cancel</Button>
 *   <Button variant="ghost" leadingIcon={<Plus size={14} />}>Add task</Button>
 *   <Button variant="danger" loading>Delete</Button>
 */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leadingIcon,
    trailingIcon,
    fullWidth,
    className,
    disabled,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        // base — every variant shares these
        'inline-flex items-center justify-center font-medium select-none',
        'transition-[background-color,box-shadow,transform,color] duration-150 ease-out',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none',
        'focus-visible:outline-none', // global focus ring takes care of the visual
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        loading && 'cursor-wait',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner />
      ) : leadingIcon ? (
        <span className="shrink-0 inline-flex">{leadingIcon}</span>
      ) : null}
      {children && <span className="truncate">{children}</span>}
      {!loading && trailingIcon && <span className="shrink-0 inline-flex">{trailingIcon}</span>}
    </button>
  );
});

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
