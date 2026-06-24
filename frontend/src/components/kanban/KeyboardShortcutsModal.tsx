import { Modal } from '@/components/ui';
import { cn } from '@/lib/cn';

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

interface Binding {
  keys: string[];
  description: string;
}

interface Section {
  title: string;
  bindings: Binding[];
}

const SECTIONS: Section[] = [
  {
    title: 'Board',
    bindings: [
      { keys: ['C'],            description: 'Quick add a task' },
      { keys: ['F'],            description: 'Toggle focus mode (full-screen board)' },
      { keys: ['↑', '↓', 'J', 'K'], description: 'Move focus between cards in a column' },
      { keys: ['←', '→'],       description: 'Move focus between columns' },
      { keys: ['Enter'],        description: 'Open the focused task' },
      { keys: ['Esc'],          description: 'Clear focus, close panels, exit focus mode' },
      { keys: ['?'],            description: 'Show this help' },
    ],
  },
  {
    title: 'Jump to column (no focus)',
    bindings: [
      { keys: ['1'], description: 'Backlog' },
      { keys: ['2'], description: 'To Do' },
      { keys: ['3'], description: 'In Progress' },
      { keys: ['4'], description: 'In Review' },
      { keys: ['5'], description: 'Done' },
    ],
  },
  {
    title: 'Focused card',
    bindings: [
      { keys: ['1'], description: 'Set priority to P0 — Critical' },
      { keys: ['2'], description: 'Set priority to P1 — High' },
      { keys: ['3'], description: 'Set priority to P2 — Medium' },
      { keys: ['4'], description: 'Set priority to P3 — Low' },
    ],
  },
  {
    title: 'Slide-over (open task)',
    bindings: [
      { keys: ['J'],   description: 'Next task in the visible list' },
      { keys: ['K'],   description: 'Previous task in the visible list' },
      { keys: ['Esc'], description: 'Close the slide-over' },
    ],
  },
];

/**
 * Cheat-sheet for the kanban shortcuts. Opened with `?` from anywhere on the
 * board. Keeps the bindings discoverable without surfacing them on the canvas.
 */
export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      subtitle="Press ? again to dismiss."
      size="lg"
      accent="brand"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-3">
              {section.title}
            </h3>
            <ul className="space-y-2">
              {section.bindings.map((b, i) => (
                <li key={i} className="flex items-start justify-between gap-3">
                  <span className="text-[12.5px] text-gray-700 dark:text-obsidian-fg leading-snug flex-1">
                    {b.description}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {b.keys.map((k, j) => (
                      <kbd
                        key={j}
                        className={cn(
                          'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded',
                          'bg-gray-100 dark:bg-obsidian-raised',
                          'text-gray-700 dark:text-obsidian-fg',
                          'text-[10px] font-mono',
                          'border border-gray-200 dark:border-obsidian-border',
                        )}
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-6 text-[11px] text-gray-400 dark:text-obsidian-faded italic border-t border-gray-100 dark:border-obsidian-border/60 pt-3">
        Shortcuts are skipped while you're typing in an input or text area, so
        they never fight your keyboard.
      </p>
    </Modal>
  );
}
