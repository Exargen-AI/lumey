import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Users } from 'lucide-react';
import { listProjectAcknowledgments } from '@/api/projectAcknowledgment';
import { ROLE_LABELS } from '@exargen/shared';
import { formatDate } from '@/lib/formatters';
import { cn } from '@/lib/cn';

/**
 * Compliance-friendly audit list of every user who has signed the
 * confidentiality acknowledgment for this project. Renders on the Settings
 * tab so the founder can prove who agreed to the NDA, when, and from
 * where.
 *
 * Owner exemption: SUPER_ADMIN never appears here by design — the gate
 * skips them entirely (the company can't NDA itself). The audit list
 * therefore intentionally never contains owners; engineers/PMs viewing
 * this panel don't need a footnote explaining that, so we don't render
 * one. Admin-facing context lives in code comments here.
 */
export function AcknowledgmentAuditPanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['project-acknowledgments', projectId],
    queryFn: () => listProjectAcknowledgments(projectId),
  });

  return (
    <div className={cn(
      'rounded-2xl overflow-hidden',
      'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark',
    )}>
      {/* Header */}
      <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100 dark:border-obsidian-border/60">
        <div className="w-9 h-9 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/15 ring-1 ring-emerald-500/20 flex items-center justify-center shrink-0">
          <ShieldCheck size={18} className="text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
            Confidentiality Acknowledgments
          </h3>
          <p className="text-[12px] text-gray-500 dark:text-obsidian-muted mt-0.5 leading-relaxed">
            Every staff, contractor, and client who has accepted the NDA for this project, with timestamp + IP for audit.
          </p>
        </div>
        {data && data.length > 0 && (
          <span className="text-[11px] font-medium px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 shrink-0">
            {data.length} signed
          </span>
        )}
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="px-5 py-6 space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-9 rounded" />)}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <Users size={28} strokeWidth={1.5} className="mx-auto text-gray-300 dark:text-obsidian-faded mb-2" />
          <p className="text-[13px] text-gray-600 dark:text-obsidian-fg font-medium">No signatures yet</p>
          <p className="text-[12px] text-gray-400 dark:text-obsidian-faded mt-1">
            When non-owner members open the project they'll be asked to acknowledge first.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-obsidian-border/60">
          {data.map((rec) => (
            <div key={rec.id} className="flex items-center gap-3 px-5 py-3">
              <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-500/20 flex items-center justify-center text-[12px] font-semibold text-brand-700 dark:text-brand-300 shrink-0">
                {rec.user.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg leading-tight truncate">
                  {rec.user.name}
                  <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-obsidian-raised text-gray-600 dark:text-obsidian-muted align-middle">
                    {ROLE_LABELS[rec.user.role as keyof typeof ROLE_LABELS] ?? rec.user.role}
                  </span>
                </p>
                <p className="text-[11px] text-gray-500 dark:text-obsidian-muted truncate">{rec.user.email}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[12px] text-gray-700 dark:text-obsidian-fg tabular-nums">{formatDate(rec.acknowledgedAt)}</p>
                {rec.ipAddress && (
                  <p className="text-[10px] text-gray-400 dark:text-obsidian-faded font-mono tabular-nums">{rec.ipAddress}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
