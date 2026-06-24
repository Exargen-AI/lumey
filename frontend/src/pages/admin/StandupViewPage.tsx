import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDate, toLocalDateString } from '@/lib/formatters';
import api from '@/api/client';

// Stable sort: blockers first, then by role, then alphabetically.
const ROLE_SORT: Record<string, number> = {
  SUPER_ADMIN: 0,
  ADMIN: 1,
  PRODUCT_MANAGER: 2,
  ENGINEER: 3,
  CLIENT: 4,
};

async function getTeamUpdates(date: string) {
  const { data } = await api.get('/daily-updates/team', { params: { date } });
  return data.data;
}

export function StandupViewPage() {
  const [dayOffset, setDayOffset] = useState(0);
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  const dateStr = toLocalDateString(date);
  const isToday = dayOffset === 0;

  const { data: updates, isLoading } = useQuery({
    queryKey: ['team-updates', dateStr],
    queryFn: () => getTeamUpdates(dateStr),
  });

  const sortedUpdates = useMemo(() => {
    if (!updates) return [];
    return [...updates].sort((a: any, b: any) => {
      const blockA = a.blockers ? 0 : 1;
      const blockB = b.blockers ? 0 : 1;
      if (blockA !== blockB) return blockA - blockB;
      const roleA = ROLE_SORT[a.user?.role] ?? 99;
      const roleB = ROLE_SORT[b.user?.role] ?? 99;
      if (roleA !== roleB) return roleA - roleB;
      return (a.user?.name || '').localeCompare(b.user?.name || '');
    });
  }, [updates]);

  const blockers = useMemo(() => sortedUpdates.filter((u: any) => u.blockers), [sortedUpdates]);

  const totalTasks = sortedUpdates.reduce((sum: number, u: any) => sum + (u.tasks?.length || 0), 0);

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-end justify-between gap-4 animate-fade-in-down">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-500/10 dark:bg-brand-500/15 ring-1 ring-brand-500/20 flex items-center justify-center">
            <Users size={18} className="text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">Team Standup</h1>
            <p className="text-[12px] text-gray-500 dark:text-obsidian-muted mt-0.5">Daily updates from the whole team</p>
          </div>
        </div>
      </div>

      {/* ─── Date navigation ─── */}
      <div className={cn(
        'flex items-center justify-between rounded-xl p-3',
        'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'shadow-soft dark:shadow-soft-dark',
      )}>
        <button
          onClick={() => setDayOffset(dayOffset - 1)}
          className="w-9 h-9 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-raised transition-colors"
          title="Previous day"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="text-center">
          <p className="text-[14px] font-semibold text-gray-900 dark:text-obsidian-fg">{formatDate(dateStr)}</p>
          {isToday && <p className="text-[10px] text-brand-600 dark:text-brand-400 font-semibold uppercase tracking-[0.1em] mt-0.5">Today</p>}
        </div>
        <button
          onClick={() => setDayOffset(Math.min(0, dayOffset + 1))}
          disabled={dayOffset >= 0}
          className={cn(
            'w-9 h-9 inline-flex items-center justify-center rounded-md transition-colors',
            'text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-raised',
            'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-500',
          )}
          title="Next day"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* ─── Summary stats ─── */}
      {sortedUpdates.length > 0 && (
        <div className="stagger-fade grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryStat label="Updates submitted" value={sortedUpdates.length} tone="brand" />
          <SummaryStat label="Tasks worked on" value={totalTasks} tone="info" />
          <SummaryStat label="Blockers reported" value={blockers.length} tone={blockers.length > 0 ? 'danger' : 'success'} />
        </div>
      )}

      {/* ─── Needs Attention — at-a-glance triage ─── */}
      {sortedUpdates.length > 0 && (
        <div>
          {/* Needs Attention */}
          <div className={cn(
            'rounded-2xl border p-5 shadow-soft dark:shadow-soft-dark',
            blockers.length > 0
              ? 'bg-rose-50/70 border-rose-200 dark:bg-rose-500/[0.06] dark:border-rose-500/30'
              : 'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
          )}>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={14} className={blockers.length > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-400 dark:text-obsidian-faded'} />
              <h3 className={cn(
                'text-[11px] font-semibold uppercase tracking-[0.1em]',
                blockers.length > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-gray-500 dark:text-obsidian-muted',
              )}>
                Needs Attention
              </h3>
              <span className={cn(
                'text-[10px] font-bold rounded-full px-2 py-0.5 ml-auto',
                blockers.length > 0
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-obsidian-raised dark:text-obsidian-muted',
              )}>
                {blockers.length}
              </span>
            </div>
            {blockers.length === 0 ? (
              <p className="text-[13px] text-gray-500 dark:text-obsidian-muted">No blockers reported. 🎉</p>
            ) : (
              <ul className="space-y-2.5">
                {blockers.map((u: any) => (
                  <li key={u.id} className="flex gap-3 text-[13px]">
                    <div className="w-6 h-6 rounded-full bg-rose-100 dark:bg-rose-500/20 flex items-center justify-center text-[10px] font-semibold text-rose-700 dark:text-rose-300 shrink-0 mt-0.5">
                      {u.user?.name?.charAt(0) || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 dark:text-obsidian-fg">{u.user?.name}</p>
                      <p className="text-rose-700 dark:text-rose-300 break-words leading-relaxed">{u.blockers}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ─── Team updates ─── */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-40 rounded-2xl" />)}
        </div>
      ) : !sortedUpdates.length ? (
        <div className={cn(
          'rounded-2xl border-2 border-dashed py-16 text-center',
          'border-gray-200 dark:border-obsidian-border',
          'bg-white/40 dark:bg-obsidian-panel/40',
        )}>
          <Users size={32} strokeWidth={1.5} className="mx-auto text-gray-300 dark:text-obsidian-faded mb-3" />
          <p className="text-sm text-gray-500 dark:text-obsidian-muted">No updates submitted for this day</p>
          {isToday && <p className="text-xs text-gray-400 dark:text-obsidian-faded mt-1">Team members will appear here after they submit their EOD updates</p>}
        </div>
      ) : (
        <div className="stagger-fade space-y-3">
          {sortedUpdates.map((update: any) => {
            return (
              <div
                key={update.id}
                className={cn(
                  'rounded-2xl overflow-hidden border-l-4 border-l-brand-500',
                  'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
                  'shadow-soft dark:shadow-soft-dark',
                )}
              >
                {/* Person header */}
                <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100 dark:border-obsidian-border bg-gray-50/50 dark:bg-obsidian-sunken/40">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-[13px] font-semibold text-white shrink-0">
                    {update.user?.name?.charAt(0) || '?'}
                  </div>
                  <div className="flex-1">
                    <p className="text-[14px] font-medium text-gray-900 dark:text-obsidian-fg leading-tight">{update.user?.name}</p>
                    <p className="text-[11px] text-gray-500 dark:text-obsidian-muted capitalize mt-0.5 leading-tight">{update.user?.role?.toLowerCase().replace('_', ' ')}</p>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  <Section label="Summary">
                    <p className="text-[13px] text-gray-700 dark:text-obsidian-fg leading-relaxed">{update.summary}</p>
                  </Section>

                  {update.tasks?.length > 0 && (
                    <Section label={`Tasks (${update.tasks.length})`}>
                      <div className="space-y-1.5">
                        {update.tasks.map((t: any) => (
                          <div key={t.id} className="flex items-center gap-2 text-[13px]">
                            <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                            <span className="text-gray-700 dark:text-obsidian-fg truncate">{t.task?.title}</span>
                            {t.statusBefore !== t.statusAfter && (
                              <span className="text-[10px] text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-500/15 rounded px-1.5 py-0.5 shrink-0 font-medium">
                                {t.statusBefore} → {t.statusAfter}
                              </span>
                            )}
                            <span className="text-[10px] text-gray-400 dark:text-obsidian-faded ml-auto shrink-0">{t.task?.project?.name}</span>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {update.blockers && (
                    <div className="rounded-lg p-3 bg-rose-50 border border-rose-100 dark:bg-rose-500/[0.08] dark:border-rose-500/20">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-rose-600 dark:text-rose-400 mb-1.5 flex items-center gap-1">
                        <AlertTriangle size={11} /> Blockers
                      </p>
                      <p className="text-[13px] text-rose-700 dark:text-rose-300 leading-relaxed">{update.blockers}</p>
                    </div>
                  )}

                  {update.plans && (
                    <Section label="Tomorrow's Plan">
                      <p className="text-[13px] text-gray-600 dark:text-obsidian-muted leading-relaxed">{update.plans}</p>
                    </Section>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ───

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-1.5">{label}</p>
      {children}
    </div>
  );
}

function SummaryStat({ label, value, tone }: {
  label: string; value: number; tone: 'brand' | 'info' | 'success' | 'danger';
}) {
  const valueClass: Record<string, string> = {
    brand:   'text-brand-600 dark:text-brand-400',
    info:    'text-blue-600 dark:text-blue-400',
    success: 'text-emerald-600 dark:text-emerald-400',
    danger:  'text-rose-600 dark:text-rose-400',
  };
  const ringClass: Record<string, string> = {
    brand:   'ring-brand-500/20 bg-white dark:bg-obsidian-panel',
    info:    'ring-blue-500/20 bg-white dark:bg-obsidian-panel',
    success: 'ring-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/[0.05]',
    danger:  'ring-rose-500/30 bg-rose-50/60 dark:bg-rose-500/[0.05]',
  };
  return (
    <div className={cn(
      'rounded-xl p-4 text-center ring-1 hover-lift',
      'border border-gray-200 dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark',
      ringClass[tone],
    )}>
      <p className={cn('text-2xl font-semibold tracking-tight tabular-nums', valueClass[tone])}>{value}</p>
      <p className="text-[11px] text-gray-500 dark:text-obsidian-muted mt-1">{label}</p>
    </div>
  );
}
