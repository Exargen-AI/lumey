import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import {
  Heading1, Heading2, Heading3, List, ListOrdered, Quote, Code2, Minus,
} from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SlashItem {
  title: string;
  keywords: string;
  iconName: 'Heading1' | 'Heading2' | 'Heading3' | 'List' | 'ListOrdered' | 'Quote' | 'Code2' | 'Minus';
  command: (args: { editor: any; range: { from: number; to: number } }) => void;
}

const ICONS = {
  Heading1, Heading2, Heading3, List, ListOrdered, Quote, Code2, Minus,
} as const;

interface Props {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

/**
 * Floating menu that appears when the user types `/` in the editor. Arrow
 * keys cycle through items, Enter picks the highlighted one, Escape closes.
 *
 * Exposes an imperative `onKeyDown` so the TipTap suggestion plugin can
 * forward keystrokes from the editor without us listening on `window`
 * (which would be brittle when multiple editors are open).
 */
export const SlashMenu = forwardRef<{ onKeyDown: (props: { event: KeyboardEvent }) => boolean }, Props>(
  function SlashMenu({ items, command }, ref) {
    const [selected, setSelected] = useState(0);

    // Reset selection whenever the visible item set changes (filter, etc.).
    useEffect(() => { setSelected(0); }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowDown') {
          setSelected((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
          return true;
        }
        if (event.key === 'ArrowUp') {
          setSelected((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
          return true;
        }
        if (event.key === 'Enter') {
          const item = items[selected];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="rounded-md border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-panel shadow-lift dark:shadow-lift-dark px-3 py-2 text-[12px] text-gray-500 dark:text-obsidian-muted">
          No commands match.
        </div>
      );
    }

    return (
      <div
        role="listbox"
        className="rounded-lg border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-panel shadow-lift dark:shadow-lift-dark py-1 min-w-[220px] max-h-72 overflow-y-auto"
      >
        {items.map((item, i) => {
          const Icon = ICONS[item.iconName];
          const active = i === selected;
          return (
            <button
              key={item.title}
              type="button"
              role="option"
              aria-selected={active}
              onMouseEnter={() => setSelected(i)}
              onClick={() => command(item)}
              className={cn(
                'w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[13px]',
                'transition-colors',
                active ? 'bg-brand-500/10 text-brand-700 dark:text-brand-200' : 'text-gray-700 dark:text-obsidian-fg hover:bg-gray-50 dark:hover:bg-obsidian-raised/60',
              )}
            >
              <span className={cn(
                'inline-flex items-center justify-center w-6 h-6 rounded',
                active ? 'bg-brand-500/20 text-brand-700 dark:text-brand-200' : 'bg-gray-100 dark:bg-obsidian-raised text-gray-500 dark:text-obsidian-muted',
              )}>
                <Icon size={12} />
              </span>
              {item.title}
            </button>
          );
        })}
      </div>
    );
  },
);
