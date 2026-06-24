import { useMemo } from 'react';
import { ExternalLink, Check } from 'lucide-react';
import type { CustomFieldDefinition, CustomFieldValue } from '@/api/customFields';
import { cn } from '@/lib/cn';

interface CustomFieldInputProps {
  definition: CustomFieldDefinition;
  value: CustomFieldValue;
  onChange: (next: CustomFieldValue) => void;
  disabled?: boolean;
  /** Inline error message — usually surfaced from the server response. */
  error?: string | null;
}

/**
 * Renders the right input control for a custom field type. The component
 * stays uncontrolled-friendly: it never owns the truth, just relays edits
 * back via onChange. The parent decides when to persist (typically on blur
 * for plain inputs, on change for selects/checkboxes).
 */
export function CustomFieldInput({ definition, value, onChange, disabled, error }: CustomFieldInputProps) {
  const id = `cf-${definition.id}`;
  const config = definition.config ?? {};

  const inputCls = cn(
    'w-full rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
    'bg-white dark:bg-obsidian-bg',
    'border focus:outline-none focus:ring-2 focus:ring-brand-500/40',
    error
      ? 'border-rose-400 dark:border-rose-500/60'
      : 'border-gray-200 dark:border-obsidian-border focus:border-brand-500/60',
    'text-gray-900 dark:text-obsidian-fg',
    'placeholder:text-gray-400 dark:placeholder:text-obsidian-faded',
    disabled && 'opacity-60 cursor-not-allowed',
  );

  const labelEl = (
    <div className="flex items-baseline justify-between mb-1">
      <label
        htmlFor={id}
        className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted"
      >
        {definition.name}
        {definition.required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {definition.hint && !error && (
        <span className="text-[10px] text-gray-400 dark:text-obsidian-faded italic truncate max-w-[60%]" title={definition.hint}>
          {definition.hint}
        </span>
      )}
    </div>
  );

  const errorEl = error ? (
    <p role="alert" className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
      {error}
    </p>
  ) : null;

  switch (definition.fieldType) {
    case 'TEXT': {
      const v = typeof value === 'string' ? value : '';
      if (config.multiline) {
        return (
          <div>
            {labelEl}
            <textarea
              id={id}
              defaultValue={v}
              disabled={disabled}
              rows={3}
              maxLength={config.maxLength ?? 1000}
              onBlur={(e) => onChange(e.target.value)}
              className={inputCls}
            />
            {errorEl}
          </div>
        );
      }
      return (
        <div>
          {labelEl}
          <input
            id={id}
            type="text"
            defaultValue={v}
            disabled={disabled}
            maxLength={config.maxLength ?? 200}
            onBlur={(e) => onChange(e.target.value)}
            className={inputCls}
          />
          {errorEl}
        </div>
      );
    }
    case 'NUMBER': {
      const v = typeof value === 'number' ? value : '';
      return (
        <div>
          {labelEl}
          <input
            id={id}
            type="number"
            defaultValue={v}
            disabled={disabled}
            min={config.min}
            max={config.max}
            step={config.step ?? 'any'}
            onBlur={(e) => {
              const raw = e.target.value;
              if (raw === '') { onChange(null); return; }
              const num = Number(raw);
              if (Number.isFinite(num)) onChange(num);
            }}
            className={inputCls}
          />
          {errorEl}
        </div>
      );
    }
    case 'SELECT': {
      const options = config.options ?? [];
      if (config.multi) {
        const current = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div>
            {labelEl}
            <div className="flex flex-wrap gap-1.5">
              {options.map((opt) => {
                const active = current.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      if (disabled) return;
                      const next = active
                        ? current.filter((v) => v !== opt.value)
                        : [...current, opt.value];
                      onChange(next);
                    }}
                    aria-pressed={active}
                    disabled={disabled}
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                      active
                        ? 'border-brand-500/50 bg-brand-500/10 text-brand-700 dark:text-brand-200'
                        : 'border-gray-200 dark:border-obsidian-border text-gray-600 dark:text-obsidian-muted hover:border-gray-300',
                      disabled && 'opacity-60 cursor-not-allowed',
                    )}
                    style={active && opt.color ? { borderColor: `${opt.color}80`, background: `${opt.color}1f`, color: opt.color } : undefined}
                  >
                    {active && <Check size={10} strokeWidth={3} />}
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {errorEl}
          </div>
        );
      }
      const v = typeof value === 'string' ? value : '';
      return (
        <div>
          {labelEl}
          <select
            id={id}
            value={v}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value || null)}
            className={inputCls}
          >
            <option value="">— Select —</option>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {errorEl}
        </div>
      );
    }
    case 'DATE': {
      const v = typeof value === 'string' ? value.slice(0, 10) : '';
      return (
        <div>
          {labelEl}
          <input
            id={id}
            type="date"
            defaultValue={v}
            disabled={disabled}
            onBlur={(e) => onChange(e.target.value || null)}
            className={inputCls}
          />
          {errorEl}
        </div>
      );
    }
    case 'URL': {
      const v = typeof value === 'string' ? value : '';
      return (
        <div>
          {labelEl}
          <div className="relative">
            <input
              id={id}
              type="url"
              defaultValue={v}
              disabled={disabled}
              placeholder="https://…"
              onBlur={(e) => onChange(e.target.value.trim() || null)}
              className={cn(inputCls, 'pr-8')}
            />
            {v && (
              <a
                href={v}
                target="_blank"
                rel="noreferrer noopener"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-obsidian-faded hover:text-brand-600 dark:hover:text-brand-300"
                aria-label="Open link in new tab"
                title="Open"
              >
                <ExternalLink size={12} />
              </a>
            )}
          </div>
          {errorEl}
        </div>
      );
    }
    case 'BADGE': {
      const v = value === true;
      return (
        <div>
          {labelEl}
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={v}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked)}
              className="w-4 h-4 rounded text-brand-600 accent-brand-600 disabled:cursor-not-allowed"
            />
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ring-1"
              style={{
                backgroundColor: v ? `${config.color ?? '#7c3aed'}1f` : 'transparent',
                color: v ? (config.color ?? '#7c3aed') : '#6b7280',
                borderColor: 'transparent',
              }}
            >
              {v ? (config.trueLabel ?? 'On') : (config.falseLabel ?? 'Off')}
            </span>
          </label>
          {errorEl}
        </div>
      );
    }
    default:
      return null;
  }
}

/**
 * Display-only renderer for read-only contexts (cards, list views). Keeps
 * the visual treatment consistent with the editor.
 */
export function CustomFieldDisplay({
  definition, value,
}: {
  definition: CustomFieldDefinition;
  value: CustomFieldValue;
}) {
  const config = definition.config ?? {};
  const text = useMemo(() => {
    if (value === undefined || value === null || value === '') return null;
    switch (definition.fieldType) {
      case 'SELECT': {
        const options = config.options ?? [];
        if (config.multi && Array.isArray(value)) {
          return value.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ');
        }
        if (typeof value === 'string') {
          return options.find((o) => o.value === value)?.label ?? value;
        }
        return null;
      }
      case 'NUMBER': return typeof value === 'number' ? String(value) : null;
      case 'BADGE':  return value ? (config.trueLabel ?? 'On') : null;
      case 'DATE':   return typeof value === 'string' ? value.slice(0, 10) : null;
      case 'URL':
      case 'TEXT':
      default:       return typeof value === 'string' ? value : null;
    }
  }, [definition, value, config]);

  if (!text) return null;
  return (
    <div className="flex items-baseline gap-1.5 text-[12px]">
      <span className="text-gray-500 dark:text-obsidian-faded">{definition.name}:</span>
      {definition.fieldType === 'URL' ? (
        <a href={text} target="_blank" rel="noreferrer noopener" className="text-brand-600 dark:text-brand-300 hover:underline truncate">
          {text}
        </a>
      ) : (
        <span className="text-gray-800 dark:text-obsidian-fg">{text}</span>
      )}
    </div>
  );
}
