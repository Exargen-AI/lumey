import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { cn } from '@/lib/cn';

export interface MentionItem {
  id: string;
  name: string;
  email?: string;
}

interface Props {
  items: MentionItem[];
  command: (item: { id: string; label: string }) => void;
}

/**
 * @-mention autocomplete. Walks via arrow keys, picks via Enter, hides via
 * Escape. The TipTap Mention extension passes the picked `{id, label}` back
 * through its `command` prop and inserts a styled chip carrying
 * `data-id={id}` — that ID is what a future notifier would use.
 */
export const MentionList = forwardRef<{ onKeyDown: (props: { event: KeyboardEvent }) => boolean }, Props>(
  function MentionList({ items, command }, ref) {
    const [selected, setSelected] = useState(0);
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
          if (item) command({ id: item.id, label: item.name });
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="rounded-md border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-panel shadow-lift dark:shadow-lift-dark px-3 py-2 text-[12px] text-gray-500 dark:text-obsidian-muted">
          No matches in this project.
        </div>
      );
    }

    return (
      <div
        role="listbox"
        className="rounded-lg border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-panel shadow-lift dark:shadow-lift-dark py-1 min-w-[220px] max-h-64 overflow-y-auto"
      >
        {items.map((item, i) => {
          const initials = item.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
          const active = i === selected;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={active}
              onMouseEnter={() => setSelected(i)}
              onClick={() => command({ id: item.id, label: item.name })}
              className={cn(
                'w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[13px]',
                active ? 'bg-brand-500/10 text-brand-700 dark:text-brand-200' : 'text-gray-700 dark:text-obsidian-fg hover:bg-gray-50 dark:hover:bg-obsidian-raised/60',
              )}
            >
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-500/15 ring-1 ring-brand-500/25 text-[10px] font-semibold text-brand-700 dark:text-brand-300 shrink-0">
                {initials}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {item.name}
                {item.email && (
                  <span className="ml-1.5 text-[11px] text-gray-400 dark:text-obsidian-faded font-mono">
                    {item.email.split('@')[0]}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    );
  },
);
