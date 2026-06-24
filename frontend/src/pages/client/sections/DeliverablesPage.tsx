import { useParams } from 'react-router-dom';
import { useProject } from '@/hooks/useProjects';
import { DeliverablesPanel } from '@/components/deliverables/DeliverablesPanel';

/**
 * Deliverables section. Phase 2 home for DeliverablesPanel (was wedged on
 * Overview with an id="deliverables-panel" anchor; that anchor is preserved
 * here for any in-flight links from before the redesign).
 *
 * Defaults to client / read-only mode (manage=false). When an admin views
 * this page via /admin → Eye affordance, they still see the same read-only
 * view their client sees — the admin DOES management from the project's
 * admin detail page, not the client view. Consistent with the design call
 * we made on PR #81.
 */
export function ClientDeliverablesPage() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isLoading } = useProject(id!);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-6 rounded w-40" />
        <div className="skeleton h-96 rounded-2xl" />
      </div>
    );
  }
  if (!project) return null;

  return (
    <div className="space-y-7 animate-fade-in-down">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
          Deliverables
        </h1>
        <p className="mt-1.5 text-sm text-gray-500 dark:text-obsidian-muted max-w-2xl">
          Items the team has prepared for your review and sign-off, plus everything that's been delivered so far.
        </p>
      </header>

      <div
        id="deliverables-panel"
        className="scroll-mt-16 rounded-2xl border p-6 bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border shadow-soft dark:shadow-soft-dark"
      >
        <DeliverablesPanel projectId={id!} />
      </div>
    </div>
  );
}
