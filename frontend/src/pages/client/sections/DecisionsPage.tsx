import { useParams } from 'react-router-dom';
import { Lightbulb } from 'lucide-react';
import { useProject } from '@/hooks/useProjects';
import { useDecisions } from '@/hooks/useDecisions';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';

/**
 * Decisions section. Read-only list of architectural / product decisions
 * recorded for this project. Phase 2 surface for the existing Decision
 * model — the admin side (`/admin/projects/:id` → Decisions tab) already
 * lets PMs/Engineers create and edit; the client view is purely "what
 * was decided and why".
 *
 * Note on visibility: there is no `clientVisible` flag on decisions in
 * the current schema, so every decision the project records is shown.
 * If product wants per-decision client-visibility later, that's a small
 * additive change to schema + this filter.
 */
export function ClientDecisionsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isLoading: projectLoading } = useProject(id!);
  const {
    data: decisions,
    isLoading: decisionsLoading,
    isError: decisionsFailed,
    error: decisionsError,
  } = useDecisions(id!);
  const decisionsForbidden = (decisionsError as any)?.response?.status === 403;

  if (projectLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-6 rounded w-40" />
        <div className="skeleton h-32 rounded-2xl" />
        <div className="skeleton h-32 rounded-2xl" />
      </div>
    );
  }
  if (!project) return null;

  const sortedDecisions = (decisions ?? []).slice().sort(
    (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="space-y-7 animate-fade-in-down">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
          Decisions
        </h1>
        <p className="mt-1.5 text-sm text-gray-500 dark:text-obsidian-muted max-w-2xl">
          Architectural and product choices that shaped this project — what was decided, the reasoning, and what alternatives were weighed.
        </p>
      </header>

      {decisionsLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}
        </div>
      ) : decisionsFailed ? (
        // A 403 means decisions aren't shared with this client on this
        // project — say so plainly instead of the false "no decisions yet".
        // Any other failure is transient → offer a refresh.
        <AccessState forbidden={decisionsForbidden} />
      ) : sortedDecisions.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {sortedDecisions.map((decision: any) => (
            <DecisionCard key={decision.id} decision={decision} />
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionCard({ decision }: { decision: any }) {
  const statusColor =
    decision.status === 'ACCEPTED' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    : decision.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
    : decision.status === 'SUPERSEDED' ? 'bg-gray-100 text-gray-600 dark:bg-obsidian-raised dark:text-obsidian-muted'
    : 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';

  return (
    <div className={cn(
      'rounded-2xl border p-6',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark',
    )}>
      <div className="flex items-start gap-4">
        <div className="w-9 h-9 rounded-lg bg-brand-50 dark:bg-brand-500/10 flex items-center justify-center shrink-0">
          <Lightbulb size={16} className="text-brand-600 dark:text-brand-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-[15px] font-semibold text-gray-900 dark:text-obsidian-fg leading-snug">
              {decision.title}
            </h3>
            {decision.status && (
              <span className={cn(
                'shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded',
                statusColor,
              )}>
                {decision.status}
              </span>
            )}
          </div>

          <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500 dark:text-obsidian-muted">
            <span>{formatDate(decision.createdAt)}</span>
            {decision.tags?.length > 0 && (
              <>
                <span aria-hidden>·</span>
                <div className="flex gap-1 flex-wrap">
                  {decision.tags.map((tag: string) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-obsidian-raised text-gray-600 dark:text-obsidian-muted text-[10px] font-medium"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {decision.rationale && (
            <div className="mt-3">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-1">
                Rationale
              </h4>
              <p className="text-[13px] text-gray-700 dark:text-obsidian-muted leading-relaxed whitespace-pre-wrap">
                {decision.rationale}
              </p>
            </div>
          )}

          {decision.alternatives && (
            <div className="mt-3">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-1">
                Alternatives considered
              </h4>
              <p className="text-[13px] text-gray-700 dark:text-obsidian-muted leading-relaxed whitespace-pre-wrap">
                {decision.alternatives}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-gray-200 dark:border-obsidian-border bg-white/40 dark:bg-obsidian-sunken/40 px-6 py-12 text-center">
      <div className="inline-flex w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-500/10 items-center justify-center mb-3">
        <Lightbulb size={18} className="text-brand-600 dark:text-brand-400" />
      </div>
      <p className="text-sm font-medium text-gray-900 dark:text-obsidian-fg">No decisions recorded yet</p>
      <p className="mt-1.5 text-[12px] text-gray-500 dark:text-obsidian-muted max-w-md mx-auto">
        Decisions show up here whenever the team chooses between architectural or product alternatives — you'll see the reasoning, what else was considered, and the current status.
      </p>
    </div>
  );
}

// Shown when the decisions query fails. A 403 is the common case: this
// client hasn't been granted the project's full internal view, so decisions
// aren't shared with them. Anything else is treated as transient.
function AccessState({ forbidden }: { forbidden: boolean }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-gray-200 dark:border-obsidian-border bg-white/40 dark:bg-obsidian-sunken/40 px-6 py-12 text-center">
      <div className="inline-flex w-10 h-10 rounded-xl bg-gray-100 dark:bg-obsidian-raised items-center justify-center mb-3">
        <Lightbulb size={18} className="text-gray-500 dark:text-obsidian-muted" />
      </div>
      {forbidden ? (
        <>
          <p className="text-sm font-medium text-gray-900 dark:text-obsidian-fg">Decisions aren’t shared on this project</p>
          <p className="mt-1.5 text-[12px] text-gray-500 dark:text-obsidian-muted max-w-md mx-auto">
            Your account doesn’t have access to the decision log for this project. If you need it, ask your project contact to enable it.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-gray-900 dark:text-obsidian-fg">We couldn’t load decisions</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
          >
            Refresh to try again
          </button>
        </>
      )}
    </div>
  );
}
