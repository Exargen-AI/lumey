import { type LucideIcon, Inbox, FolderOpen, CheckCircle2, ClipboardList } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/lib/cn';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
  };
  /** Render as a dashed-border panel (default) or inline (no border). */
  variant?: 'panel' | 'inline';
  className?: string;
}

/**
 * Empty-state placeholder. Used wherever "no data yet" appears.
 *
 * Examples:
 *   <EmptyState title="No tasks" />
 *   <EmptyState icon={FolderOpen} title="No projects" description="Create one to get started"
 *     action={{ label: 'Create Project', onClick: ... }} />
 */
export function EmptyState({ icon: Icon = Inbox, title, description, action, variant = 'panel', className }: EmptyStateProps) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center text-center',
      variant === 'panel'
        ? cn(
            'rounded-2xl border-2 border-dashed py-14 px-6',
            'border-gray-200 dark:border-obsidian-border',
            'bg-white/40 dark:bg-obsidian-panel/40',
          )
        : 'py-12 px-6',
      className,
    )}>
      <Icon size={36} strokeWidth={1.5} className="text-gray-300 dark:text-obsidian-faded mb-3" />
      <h3 className="text-sm font-medium text-gray-700 dark:text-obsidian-fg">{title}</h3>
      {description && (
        <p className="text-xs text-gray-500 dark:text-obsidian-muted max-w-sm mt-1.5 leading-relaxed">{description}</p>
      )}
      {action && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          leadingIcon={action.icon ? <action.icon size={14} /> : undefined}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}

// Pre-configured empty states — common cases get a one-liner.

export function NoProjects({ onCreate }: { onCreate?: () => void }) {
  return (
    <EmptyState
      icon={FolderOpen}
      title="No projects yet"
      description="Create your first project to start tracking progress."
      action={onCreate ? { label: 'Create Project', onClick: onCreate } : undefined}
    />
  );
}

export function NoTasks() {
  return (
    <EmptyState
      icon={ClipboardList}
      title="No tasks"
      description="Add tasks to your project board to get started."
    />
  );
}

export function AllDone() {
  return (
    <EmptyState
      icon={CheckCircle2}
      title="All caught up!"
      description="No pending items. Great work!"
    />
  );
}
