import { useParams } from 'react-router-dom';
import { useProject } from '@/hooks/useProjects';
import { DocumentsPanel } from '@/components/documents/DocumentsPanel';

/**
 * Documents section. Lit up by the S3-backed Project Documents feature:
 * the team uploads files here; AI agents fetch them via `cc docs fetch
 * <slug> <id>` as they pick up tasks; clients browse + download.
 *
 * The actual list + upload + delete UI is in DocumentsPanel — same
 * component the admin project page will use, so behaviours stay
 * identical across surfaces.
 */
export function ClientDocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isLoading } = useProject(id!);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-6 rounded w-40" />
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }
  if (!project) return null;

  return (
    <div className="space-y-7 animate-fade-in-down">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
          Documents
        </h1>
        <p className="mt-1.5 text-sm text-gray-500 dark:text-obsidian-muted max-w-2xl">
          Specs, designs, contracts, runbooks, and anything else the team needs to reference on this project.
          Documents you upload here are visible to both the team and any AI agents working on this project.
        </p>
      </header>

      <DocumentsPanel projectId={id!} />
    </div>
  );
}
