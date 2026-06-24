import { useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useProjectMembers, useSetProjectMemberFullAccess } from '@/hooks/useProjects';
import { Card, CardHeader, useConfirm } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * SUPER_ADMIN-only panel (Project → Settings) to grant a specific CLIENT
 * member the FULL internal view of THIS project — every task (including
 * internal, non-client-visible ones), decisions, and internal comments —
 * instead of the stripped client-visible subset. Scoped to this project's
 * membership, so the same client stays restricted on other projects.
 *
 * Renders nothing for non-super-admins: exposing internal work to an
 * external client is a privileged action gated to SUPER_ADMIN (the backend
 * enforces this independently via requireRoles on the PATCH endpoint).
 */
export function ClientAccessPanel({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { data: members } = useProjectMembers(projectId);
  const setFullAccess = useSetProjectMemberFullAccess(projectId);
  const confirm = useConfirm();
  // Inline confirmation after a grant/revoke (the app has no global toast).
  // Auto-clears; also tells the admin the action actually landed.
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (user?.role !== 'SUPER_ADMIN') return null;

  const clientMembers = (members ?? []).filter((m: any) => m.user?.role === 'CLIENT');

  function flash(next: { tone: 'ok' | 'err'; text: string }) {
    setFeedback(next);
    window.setTimeout(() => setFeedback((cur) => (cur === next ? null : cur)), 5000);
  }

  async function toggle(member: any) {
    const next = !member.fullAccess;
    if (next) {
      const ok = await confirm({
        title: 'Grant full project access?',
        tone: 'danger',
        confirmLabel: 'Grant full access',
        body: (
          <span>
            <strong>{member.user.name}</strong> will see <strong>everything</strong> on this
            project — every task (including internal, non-client-visible ones), decisions, and
            internal comments — not just the client-visible subset. This exposes internal work to
            an external client. Only enable it for clients you trust with the full picture.
          </span>
        ),
      });
      if (!ok) return;
    }
    setFeedback(null);
    setPendingId(member.user.id);
    setFullAccess.mutate(
      { userId: member.user.id, fullAccess: next },
      {
        onSuccess: () =>
          flash({
            tone: 'ok',
            text: next
              ? `${member.user.name} now has full access to this project.`
              : `Full access removed for ${member.user.name}.`,
          }),
        onError: (err: any) =>
          flash({
            tone: 'err',
            text:
              err?.response?.data?.error?.message ||
              `Couldn't update access for ${member.user.name}. Please try again.`,
          }),
        onSettled: () => setPendingId(null),
      },
    );
  }

  return (
    <Card>
      <CardHeader
        title="Client full access"
        subtitle="Let a specific client see this project's entire internal view — tasks, decisions, and comments — instead of the client-visible subset. Scoped to this project only."
      />

      {feedback && (
        <div
          role="status"
          className={cn(
            'mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] animate-fade-in-down',
            feedback.tone === 'ok'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
          )}
        >
          {feedback.tone === 'ok' && <Check size={14} className="mt-0.5 shrink-0" />}
          <span>{feedback.text}</span>
        </div>
      )}

      {clientMembers.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No client members on this project yet. Add a CLIENT to the project to grant them full access.
        </p>
      ) : (
        <ul className="space-y-2">
          {clientMembers.map((m: any) => {
            const rowPending = setFullAccess.isPending && pendingId === m.user.id;
            return (
              <li
                key={m.user.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 dark:border-obsidian-border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-gray-900 dark:text-obsidian-fg truncate">
                      {m.user.name}
                    </span>
                    {/* Explicit, persistent state badge so the grant is
                        unmistakable beyond the toggle colour. */}
                    {m.fullAccess && (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                        <Check size={10} /> Full access
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-obsidian-muted truncate">
                    {m.user.email}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(m)}
                  disabled={rowPending}
                  aria-pressed={!!m.fullAccess}
                  title={m.fullAccess ? 'Full access ON — click to revoke' : 'Full access OFF — click to grant'}
                  className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
                    m.fullAccess ? 'bg-brand-600' : 'bg-gray-300 dark:bg-obsidian-border',
                    rowPending && 'opacity-60',
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                      m.fullAccess ? 'translate-x-5' : 'translate-x-0.5',
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        Full access exposes internal, non-client-visible work to an external client. Only Super Admin can change this.
      </p>
    </Card>
  );
}
