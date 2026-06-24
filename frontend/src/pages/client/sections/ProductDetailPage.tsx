import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Bug as BugIcon, Package, PauseCircle, Sparkles, ListChecks,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { useProject } from '@/hooks/useProjects';
import { useProduct } from '@/hooks/useProducts';
import { useTasks } from '@/hooks/useTasks';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { BugSubmissionModal } from '@/components/bugs/BugSubmissionModal';
import { cn } from '@/lib/cn';

/**
 * Client-side Product Detail. Mirrors the admin page's shape but:
 *   - Drops admin-only affordances (edit, delete).
 *   - Routes the embedded kanban into clientCreateMode so clients can
 *     submit task requests scoped to this product directly from the
 *     BACKLOG column (same affordance the client board page already
 *     exposes — same safety net on the server).
 *   - Prominent "Submit a bug for this product" CTA that opens the
 *     structured bug modal with productId locked.
 */
export function ClientProductDetailPage() {
  const { id: projectId, productId } = useParams<{ id: string; productId: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(projectId!);
  const { data: product, isLoading } = useProduct(projectId!, productId);
  const { data: tasks } = useTasks(projectId!, productId ? { productId } : undefined);

  const [bugOpen, setBugOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-1/3 rounded" />
        <div className="skeleton h-24 rounded-2xl" />
        <div className="skeleton h-96 rounded-2xl" />
      </div>
    );
  }
  if (!product) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-obsidian-muted">
        Product not found.
      </div>
    );
  }

  const accentColor = product.color && /^#[0-9a-fA-F]{6}$/.test(product.color) ? product.color : null;
  const totalTasks = (tasks ?? []).length;
  const doneTasks = (tasks ?? []).filter((t: any) => t.status === 'DONE').length;
  const bugs = (tasks ?? []).filter((t: any) => t.taskType === 'BUG').length;
  const openBugs = (tasks ?? []).filter((t: any) => t.taskType === 'BUG' && t.status !== 'DONE').length;
  const completionPct = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);

  return (
    <div className="space-y-5 animate-fade-in-down">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <button
            onClick={() => navigate(`/client/projects/${projectId}/products`)}
            className="p-1.5 -ml-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-obsidian-raised text-gray-400 dark:text-obsidian-muted shrink-0 mt-0.5"
            aria-label="Back to products"
          >
            <ArrowLeft size={18} />
          </button>
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            style={{
              backgroundColor: accentColor ? accentColor + '20' : undefined,
              color: accentColor ?? undefined,
            }}
          >
            <Package size={18} className={accentColor ? '' : 'text-gray-500 dark:text-obsidian-muted'} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg truncate">
                {product.name}
              </h1>
              {product.status === 'PAUSED' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 px-2 py-0.5">
                  <PauseCircle size={10} /> Paused
                </span>
              )}
            </div>
            {project?.name && (
              <p className="text-[11.5px] text-gray-500 dark:text-obsidian-muted mt-0.5 truncate">
                in {project.name}
              </p>
            )}
            {product.description && (
              <p className="text-[12.5px] text-gray-600 dark:text-obsidian-muted mt-2 max-w-2xl leading-snug">
                {product.description}
              </p>
            )}
          </div>
        </div>
        <Button variant="primary" onClick={() => setBugOpen(true)}>
          <BugIcon size={14} /> Submit a bug
        </Button>
      </div>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Tasks" value={totalTasks} icon={<ListChecks size={13} />} tone="neutral" />
        <Stat label="Completion" value={`${completionPct}%`} icon={<Sparkles size={13} />} tone="brand" />
        <Stat
          label="Bugs"
          value={bugs}
          icon={<BugIcon size={13} />}
          tone={openBugs > 0 ? 'rose' : 'emerald'}
          sub={openBugs > 0 ? `${openBugs} open` : 'all closed'}
        />
        <Stat label="Status" value={product.status} icon={<Package size={13} />} tone="neutral" />
      </section>

      {/* Read-only kanban scoped to this product. clientCreateMode is
          intentionally ON — clients can still propose task requests
          scoped to this product from the BACKLOG column. */}
      <KanbanBoard
        projectId={projectId!}
        productId={product.id}
        clientCreateMode
        onTaskClick={(taskId) => navigate(`/client/projects/${projectId}/tasks/${taskId}`)}
      />

      <BugSubmissionModal
        open={bugOpen}
        onClose={() => setBugOpen(false)}
        projectId={projectId!}
        defaultProductId={product.id}
        lockProduct
      />
    </div>
  );
}

function Stat({
  label, value, icon, tone, sub,
}: { label: string; value: string | number; icon: React.ReactNode; tone: 'neutral' | 'brand' | 'rose' | 'emerald'; sub?: string }) {
  const accent: Record<string, { text: string; bar: string }> = {
    neutral: { text: 'text-gray-700 dark:text-obsidian-fg',   bar: 'bg-gray-300 dark:bg-obsidian-faded' },
    brand:   { text: 'text-brand-700 dark:text-brand-300',    bar: 'bg-brand-500' },
    rose:    { text: 'text-rose-700 dark:text-rose-300',      bar: 'bg-rose-500' },
    emerald: { text: 'text-emerald-700 dark:text-emerald-300', bar: 'bg-emerald-500' },
  };
  return (
    <div className={cn(
      'relative rounded-xl border p-3 overflow-hidden',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark',
    )}>
      <span className={cn('absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full', accent[tone].bar)} />
      <div className="ml-2">
        <div className="flex items-center gap-1.5 text-gray-500 dark:text-obsidian-muted">
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">{label}</span>
        </div>
        <p className={cn('mt-1 text-[20px] font-semibold tabular-nums leading-none', accent[tone].text)}>
          {value}
        </p>
        {sub && (
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-obsidian-muted">{sub}</p>
        )}
      </div>
    </div>
  );
}
