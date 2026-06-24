import { useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ShieldCheck, ShieldQuestion, Users } from 'lucide-react';
import { useProject } from '@/hooks/useProjects';
import { useProjectCompliance } from '@/hooks/useClientCompliance';
import { ROLE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';

/**
 * Client-facing Compliance section. Shows the people working on your
 * project plus the agreements each has signed (NDA, IP Assignment,
 * Code of Conduct, etc.) with sign dates.
 *
 * What this page is for:
 *   - Trust signal. A client looking for "did the engineer who's
 *     touching my private repos sign an NDA?" should get a yes/no in
 *     three seconds.
 *   - Auditable but not forensic. We deliberately don't surface IP
 *     addresses, user agents, or document snapshots — that's the
 *     admin's compliance audit page. The "you can prove it later"
 *     story stays on the server-side rows; this page is the
 *     summary, not the evidence pack.
 *
 * What's hidden:
 *   - CLIENT members. Other clients on the same project are not part
 *     of this view (different confidentiality posture).
 *   - Forensic detail. Per the rationale above.
 */
export function ClientCompliancePage() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isLoading: projectLoading } = useProject(id!);
  const { data: compliance, isLoading: complianceLoading } = useProjectCompliance(id!);

  if (projectLoading || complianceLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-6 rounded w-40" />
        <div className="skeleton h-16 rounded-2xl" />
        <div className="skeleton h-44 rounded-2xl" />
        <div className="skeleton h-44 rounded-2xl" />
      </div>
    );
  }
  if (!project) return null;

  const members = compliance?.members ?? [];
  const total = compliance?.totalAgreements ?? 0;
  const signed = compliance?.signedAgreements ?? 0;
  const completion = total === 0 ? 100 : Math.round((signed / total) * 100);

  return (
    <div className="space-y-7 animate-fade-in-down">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
          Compliance &amp; Confidentiality
        </h1>
        <p className="mt-1.5 text-sm text-gray-500 dark:text-obsidian-muted max-w-2xl">
          The people working on this project, and the agreements each has signed.
          Dates reflect when the signature was captured on the platform.
        </p>
      </header>

      {/* Top strip — at-a-glance totals. */}
      <section className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat
          label="Team members"
          value={members.length}
          icon={<Users size={14} />}
          tone="neutral"
        />
        <Stat
          label="Agreements signed"
          value={signed}
          icon={<CheckCircle2 size={14} />}
          tone="emerald"
        />
        <Stat
          label="Coverage"
          value={`${completion}%`}
          icon={<ShieldCheck size={14} />}
          tone={completion === 100 ? 'emerald' : completion >= 50 ? 'amber' : 'rose'}
        />
      </section>

      {/* Body */}
      {members.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {members.map((m) => (
            <MemberCard key={m.userId} member={m} />
          ))}
        </div>
      )}

      {compliance && (
        <p className="text-[11px] text-gray-400 dark:text-obsidian-faded">
          Generated {formatDate(compliance.generatedAt)}.
          Need the full forensic record (IP, user agent, full text snapshots)?
          Contact your account admin.
        </p>
      )}
    </div>
  );
}

/* ─── Member card ──────────────────────────────────────────────── */

function MemberCard({ member }: { member: ReturnType<typeof useProjectCompliance>['data'] extends infer T
  ? T extends { members: Array<infer M> } ? M : never : never }) {
  const totalDocs = member.documents.length;
  const signedDocs = member.documents.filter((d) => d.signedAt != null).length;
  const initials = (member.name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const allSigned = member.allSigned;

  return (
    <article className={cn(
      'rounded-2xl border overflow-hidden',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark',
    )}>
      <header className="flex items-start gap-3 px-5 py-4 border-b border-gray-100 dark:border-obsidian-border bg-gray-50/40 dark:bg-obsidian-sunken/40">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-[12px] font-semibold text-white shadow-soft shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-gray-900 dark:text-obsidian-fg truncate">
            {member.name}
          </p>
          <p className="text-[11.5px] text-gray-500 dark:text-obsidian-muted mt-0.5">
            {ROLE_LABELS[member.role as keyof typeof ROLE_LABELS] ?? member.role}
            {member.company && (
              <>
                <span aria-hidden> · </span>
                {member.company}
              </>
            )}
          </p>
        </div>
        <CoverageBadge allSigned={allSigned} signed={signedDocs} total={totalDocs} />
      </header>

      {totalDocs === 0 ? (
        <p className="px-5 py-6 text-[12.5px] text-gray-400 dark:text-obsidian-faded">
          No mandatory agreements apply to this role yet.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-obsidian-border">
          {member.documents.map((d) => (
            <li
              key={`${d.courseSlug}-${d.documentSlug}`}
              className="px-5 py-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg truncate">
                  {d.documentTitle}
                </p>
                <p className="text-[11px] text-gray-400 dark:text-obsidian-faded truncate">
                  {d.courseTitle}
                  {d.documentVersion != null && (
                    <>
                      <span aria-hidden> · </span>v{d.documentVersion}
                    </>
                  )}
                </p>
              </div>
              {d.signedAt ? (
                <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-emerald-700 dark:text-emerald-300 shrink-0">
                  <CheckCircle2 size={12} />
                  Signed {formatDate(d.signedAt)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-amber-700 dark:text-amber-300 shrink-0">
                  <ShieldQuestion size={12} />
                  Pending
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function CoverageBadge({ allSigned, signed, total }: { allSigned: boolean; signed: number; total: number }) {
  if (total === 0) return null;
  const tone = allSigned ? 'emerald' : signed === 0 ? 'rose' : 'amber';
  const accent: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    amber:   'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    rose:    'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  };
  const Icon = allSigned ? CheckCircle2 : AlertCircle;
  return (
    <span className={cn(
      'shrink-0 inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full',
      accent[tone],
    )}>
      <Icon size={11} />
      {signed}/{total} signed
    </span>
  );
}

/* ─── Stat tile ────────────────────────────────────────────────── */

function Stat({
  label, value, icon, tone,
}: { label: string; value: string | number; icon: React.ReactNode; tone: 'neutral' | 'emerald' | 'amber' | 'rose' }) {
  const accent: Record<string, { text: string; bar: string }> = {
    neutral: { text: 'text-gray-700 dark:text-obsidian-fg',    bar: 'bg-gray-300 dark:bg-obsidian-faded' },
    emerald: { text: 'text-emerald-700 dark:text-emerald-300', bar: 'bg-emerald-500' },
    amber:   { text: 'text-amber-700 dark:text-amber-300',     bar: 'bg-amber-500' },
    rose:    { text: 'text-rose-700 dark:text-rose-300',       bar: 'bg-rose-500' },
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
        <p className={cn('mt-1 text-[22px] font-semibold tabular-nums leading-none', accent[tone].text)}>
          {value}
        </p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className={cn(
      'rounded-2xl border-2 border-dashed py-14 text-center',
      'border-gray-200 dark:border-obsidian-border',
      'bg-white/40 dark:bg-obsidian-panel/40',
    )}>
      <ShieldCheck size={32} className="mx-auto text-gray-300 dark:text-obsidian-faded mb-3" />
      <p className="text-sm text-gray-500 dark:text-obsidian-muted">
        Team members will appear here once the project is staffed.
      </p>
    </div>
  );
}
