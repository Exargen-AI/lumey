import { forwardRef, useId, cloneElement, isValidElement, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

// ─── Shared field-shell styling ───
//
// Used by Input/Textarea/Select. Single source of truth for the obsidian-themed
// field surface — change once, every form field updates.
const fieldShellBase = cn(
  'w-full text-sm rounded-lg transition-colors',
  'bg-white border border-gray-200 hover:border-gray-300',
  'dark:bg-obsidian-raised dark:border-obsidian-border dark:hover:border-obsidian-border-strong',
  'focus:outline-none focus:border-brand-500 dark:focus:border-brand-400',
  'placeholder:text-gray-400 dark:placeholder:text-obsidian-faded',
  'text-gray-900 dark:text-obsidian-fg',
  'disabled:opacity-50 disabled:cursor-not-allowed',
);

const errorShell = 'border-rose-300 focus:border-rose-500 dark:border-rose-500/40 dark:focus:border-rose-400';

// ─── Input ────────────────────────────────────────────────────────────────

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Render an error border + sets aria-invalid. Pair with <Field error="..."> for a message. */
  invalid?: boolean;
  /** Visual size — controls height. */
  size?: 'sm' | 'md';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, size = 'md', className, ...rest },
  ref,
) {
  const sizeClass = size === 'sm' ? 'h-8 px-2.5' : 'h-10 px-3';
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldShellBase, sizeClass, invalid && errorShell, className)}
      {...rest}
    />
  );
});

// ─── Textarea ────────────────────────────────────────────────────────────

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldShellBase, 'px-3 py-2 resize-y min-h-[80px]', invalid && errorShell, className)}
      {...rest}
    />
  );
});

// ─── Select ──────────────────────────────────────────────────────────────

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  invalid?: boolean;
  size?: 'sm' | 'md';
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, size = 'md', className, children, ...rest },
  ref,
) {
  const sizeClass = size === 'sm' ? 'h-8 px-2.5' : 'h-10 px-3';
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldShellBase, sizeClass, 'pr-8', invalid && errorShell, className)}
      {...rest}
    >
      {children}
    </select>
  );
});

// ─── Field — label + hint + leading icon + trailing slot + error ─────────

interface FieldProps {
  label?: string;
  required?: boolean;
  hint?: string;
  /** Error message — when present, the wrapped input gets the invalid border. */
  error?: string;
  /** Icon shown inside the input on the left edge. */
  icon?: ReactNode;
  /** Element shown inside the input on the right edge (e.g. password show/hide button). */
  trailing?: ReactNode;
  /** The form control. Pass <Input>, <Textarea>, or <Select>. */
  children: ReactNode;
  /** Extra class for the outer wrapper. */
  className?: string;
}

/**
 * Wraps a form control with label, hint, leading icon, trailing slot, and error message.
 *
 * Examples:
 *   <Field label="Email" icon={<Mail size={15} />}>
 *     <Input type="email" placeholder="you@example.com" />
 *   </Field>
 *
 *   <Field label="Password" required error={errors.password}
 *     trailing={<button>show</button>}>
 *     <Input type="password" />
 *   </Field>
 */
export function Field({ label, required, hint, error, icon, trailing, children, className }: FieldProps) {
  const id = useId();

  // When there's an icon or trailing slot, we need to overlay them on the input.
  // The simplest reliable way: wrap the input in a relative container and pad
  // the input on the relevant side.
  const hasOverlay = !!icon || !!trailing;

  return (
    <div className={className}>
      {label && (
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor={id} className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted">
            {label} {required && <span className="text-rose-500">*</span>}
          </label>
          {hint && <span className="text-[10px] text-gray-400 dark:text-obsidian-faded italic">{hint}</span>}
        </div>
      )}

      {hasOverlay ? (
        <div className="relative">
          {icon && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-obsidian-faded">
              {icon}
            </span>
          )}
          <CloneWithPadding leftPad={!!icon} rightPad={!!trailing}>
            {children}
          </CloneWithPadding>
          {trailing && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2">
              {trailing}
            </span>
          )}
        </div>
      ) : (
        children
      )}

      {error && (
        <div className="mt-1.5 flex items-start gap-1.5 text-[12px] text-rose-600 dark:text-rose-400">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

// Adds left/right padding to the wrapped input to make room for icon/trailing
// without forcing every caller to remember the exact pixel value.
function CloneWithPadding({ children, leftPad, rightPad }: { children: ReactNode; leftPad?: boolean; rightPad?: boolean }) {
  // We cloneElement so the consumer can pass any of Input/Textarea/Select
  // and we don't need to know which it is.
  if (isValidElement<{ className?: string }>(children)) {
    const extraClass = cn(leftPad && 'pl-9', rightPad && 'pr-9');
    const merged = cn(children.props.className, extraClass);
    return cloneElement(children, { className: merged });
  }
  return <>{children}</>;
}
