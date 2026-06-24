import { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  /** Lucide icon component (e.g. `KanbanSquare`). */
  icon?: LucideIcon;
  /** Optional count pill shown after the label. */
  count?: number;
  /** Disable this tab (greyed out, not clickable). */
  disabled?: boolean;
}

interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  /** Visual variant — `underline` (default, project-detail style) or `pills` (toolbar style). */
  variant?: 'underline' | 'pills';
  /** Right-aligned slot — typically actions like "+ Add". */
  rightSlot?: ReactNode;
  className?: string;
}

/**
 * Tabbed navigation. Two visual variants:
 *
 *   - underline: minimal, violet underline + violet text on active. Best for
 *     in-page section navigation like Project Detail's Board/Timeline/Decisions.
 *
 *   - pills: rounded background pill on active. Best for toolbar-style
 *     filters where you need stronger affordance.
 *
 * Examples:
 *   <Tabs items={[{id: 'a', label: 'Alpha'}, {id: 'b', label: 'Beta'}]}
 *         active={tab} onChange={setTab} />
 *
 *   <Tabs items={[
 *     { id: 'all', label: 'All', count: 12 },
 *     { id: 'mine', label: 'Mine', count: 3, icon: User },
 *   ]} active={tab} onChange={setTab} variant="pills" />
 */
export function Tabs<T extends string = string>({
  items, active, onChange, variant = 'underline', rightSlot, className,
}: TabsProps<T>) {
  if (variant === 'pills') {
    return (
      <div className={cn('flex items-center gap-1 p-1 rounded-lg bg-gray-100 dark:bg-obsidian-sunken', className)} role="tablist">
        {items.map((tab) => {
          const isActive = active === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              disabled={tab.disabled}
              onClick={() => onChange(tab.id)}
              className={cn(
                'inline-flex items-center gap-2 h-8 px-3 rounded-md text-[13px] font-medium transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                isActive
                  ? 'bg-white text-gray-900 shadow-soft dark:bg-obsidian-panel dark:text-obsidian-fg dark:shadow-soft-dark'
                  : 'text-gray-600 hover:text-gray-900 dark:text-obsidian-muted dark:hover:text-obsidian-fg',
              )}
            >
              {Icon && <Icon size={13} />}
              {tab.label}
              {tab.count !== undefined && (
                <span className={cn(
                  'text-[10px] font-bold rounded-full px-1.5 py-0.5 -mr-1',
                  isActive
                    ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'bg-gray-200 text-gray-600 dark:bg-obsidian-raised dark:text-obsidian-muted',
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
        {rightSlot && <div className="ml-auto">{rightSlot}</div>}
      </div>
    );
  }

  // Default: underline variant
  return (
    <div className={cn('flex items-center justify-between border-b border-gray-200 dark:border-obsidian-border', className)}>
      <nav className="flex gap-1" role="tablist">
        {items.map((tab) => {
          const isActive = active === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              disabled={tab.disabled}
              onClick={() => onChange(tab.id)}
              className={cn(
                'relative inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                isActive
                  ? 'text-brand-600 dark:text-brand-400'
                  : 'text-gray-500 hover:text-gray-900 dark:text-obsidian-muted dark:hover:text-obsidian-fg',
              )}
            >
              {Icon && <Icon size={14} />}
              {tab.label}
              {tab.count !== undefined && (
                <span className={cn(
                  'text-[10px] font-bold rounded-full px-1.5 py-0.5',
                  isActive
                    ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-obsidian-raised dark:text-obsidian-muted',
                )}>
                  {tab.count}
                </span>
              )}
              {isActive && (
                <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-brand-500 dark:bg-brand-400 rounded-full" />
              )}
            </button>
          );
        })}
      </nav>
      {rightSlot && <div className="pb-2">{rightSlot}</div>}
    </div>
  );
}
