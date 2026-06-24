import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, RefreshCw, Trophy } from 'lucide-react';
import { getActivities } from '@/api/activities';
import { getUsers } from '@/api/users';
import { useProjects } from '@/hooks/useProjects';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/formatters';

type Tone = 'positive' | 'neutral' | 'destructive' | 'info';
type ActionConfig = { icon: string; tone: Tone; label: string };

// Each action gets an emoji, a tone (which drives colour), and a label.
// Tone → colour is centralised in TONE_CHIP below so dark/light mode are
// handled in one place rather than 30+ inline class combos.
const ACTION_CONFIG: Record<string, ActionConfig> = {
  // Tasks
  created_task:           { icon: '➕',  tone: 'positive',    label: 'created task' },
  updated_task:           { icon: '✏️',  tone: 'info',        label: 'updated task' },
  moved_task:             { icon: '➡️',  tone: 'neutral',     label: 'moved task' },
  deleted_task:           { icon: '🗑️',  tone: 'destructive', label: 'deleted task' },
  blocked_task:           { icon: '🚨',  tone: 'destructive', label: 'blocked task' },
  unblocked_task:         { icon: '✅',  tone: 'positive',    label: 'unblocked task' },
  // Projects
  created_project:        { icon: '📁',  tone: 'neutral',     label: 'created project' },
  updated_project:        { icon: '📝',  tone: 'info',        label: 'updated project' },
  deleted_project:        { icon: '🗑️',  tone: 'destructive', label: 'deleted project' },
  changed_phase:          { icon: '🔄',  tone: 'info',        label: 'changed phase' },
  set_health:             { icon: '🏥',  tone: 'info',        label: 'set project health' },
  added_member:           { icon: '👥',  tone: 'positive',    label: 'added member' },
  removed_member:         { icon: '👥',  tone: 'destructive', label: 'removed member' },
  // Milestones
  created_milestone:      { icon: '🎯',  tone: 'neutral',     label: 'created milestone' },
  updated_milestone:      { icon: '✏️',  tone: 'info',        label: 'updated milestone' },
  completed_milestone:    { icon: '🏁',  tone: 'positive',    label: 'completed milestone' },
  deleted_milestone:      { icon: '🗑️',  tone: 'destructive', label: 'deleted milestone' },
  // Decisions
  created_decision:       { icon: '🧭',  tone: 'neutral',     label: 'recorded decision' },
  updated_decision:       { icon: '✏️',  tone: 'info',        label: 'updated decision' },
  deleted_decision:       { icon: '🗑️',  tone: 'destructive', label: 'deleted decision' },
  // Comments
  created_comment:        { icon: '💬',  tone: 'info',        label: 'commented on' },
  // Status updates
  created_status_update:  { icon: '📊',  tone: 'neutral',     label: 'posted status update' },
  // Users / RBAC
  created_user:           { icon: '👤',  tone: 'positive',    label: 'added user' },
  updated_user:           { icon: '✏️',  tone: 'info',        label: 'updated user' },
  deactivated_user:       { icon: '🔒',  tone: 'destructive', label: 'deactivated user' },
  reset_password:         { icon: '🔑',  tone: 'info',        label: 'reset password for' },
  // Auth
  deny:                   { icon: '⛔',  tone: 'destructive', label: 'access denied' },
};

const FALLBACK_CONFIG: ActionConfig = { icon: '🔔', tone: 'neutral', label: 'activity' };

const TONE_CHIP: Record<Tone, string> = {
  positive:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  neutral:     'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
  info:        'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  destructive: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
};

function bucketLabel(createdAt: string, now: Date): 'Today' | 'Yesterday' | 'Earlier this week' | 'Older' {
  const d = new Date(createdAt);
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfToday.getDate() - 1);
  const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfToday.getDate() - 7);
  if (d >= startOfToday) return 'Today';
  if (d >= startOfYesterday) return 'Yesterday';
  if (d >= startOfWeek) return 'Earlier this week';
  return 'Older';
}

const BUCKET_ORDER: ('Today' | 'Yesterday' | 'Earlier this week' | 'Older')[] = ['Today', 'Yesterday', 'Earlier this week', 'Older'];

export function ActivityFeedPage() {
  const [projectFilter, setProjectFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const { data: projects } = useProjects();
  const { data: users } = useQuery({
    queryKey: ['users-active'],
    queryFn: () => getUsers({ isActive: 'true' }),
  });

  const params: Record<string, string> = {};
  if (projectFilter) params.project = projectFilter;
  if (userFilter) params.userId = userFilter;

  const { data: activities, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['activities', params],
    queryFn: () => getActivities(params),
    refetchInterval: 30000,
  });

  const grouped = useMemo(() => {
    const now = new Date();
    const out: Record<string, any[]> = { Today: [], Yesterday: [], 'Earlier this week': [], Older: [] };
    (activities || []).forEach((a: any) => out[bucketLabel(a.createdAt, now)].push(a));
    return out;
  }, [activities]);

  const stats = useMemo(() => {
    const todayList = grouped['Today'] || [];
    const userCounts = new Map<string, { name: string; count: number }>();
    const actionCounts = new Map<string, number>();
    let destructiveCount = 0;

    todayList.forEach((a: any) => {
      const u = a.user?.name || 'Unknown';
      const cur = userCounts.get(u) || { name: u, count: 0 };
      cur.count += 1;
      userCounts.set(u, cur);
      const cfg = ACTION_CONFIG[a.action] || FALLBACK_CONFIG;
      actionCounts.set(cfg.label, (actionCounts.get(cfg.label) || 0) + 1);
      if (cfg.tone === 'destructive') destructiveCount += 1;
    });

    const sortedUsers = [...userCounts.values()].sort((a, b) => b.count - a.count);
    const sortedActions = [...actionCounts.entries()].sort((a, b) => b[1] - a[1]);
    return {
      total: todayList.length,
      topContributor: sortedUsers[0],
      topAction: sortedActions[0],
      destructiveCount,
    };
  }, [grouped]);

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between gap-4 animate-fade-in-down">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-500/10 dark:bg-brand-500/15 ring-1 ring-brand-500/20 flex items-center justify-center">
            <Activity size={18} className="text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">Activity Feed</h1>
            <p className="text-[12px] text-gray-500 dark:text-obsidian-muted mt-0.5">Everything happening across the workspace</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className={selectClass}
          >
            <option value="">All projects</option>
            {projects?.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className={selectClass}
          >
            <option value="">All people</option>
            {users?.map((u: any) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="w-9 h-9 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-panel transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ─── Today's stats ─── */}
      {!isLoading && activities && activities.length > 0 && (
        <div className="stagger-fade grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={panelCls}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-1.5">Today</p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <p className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg tabular-nums">{stats.total}</p>
              <p className="text-[12px] text-gray-500 dark:text-obsidian-muted">events</p>
              {stats.destructiveCount > 0 && (
                <span className="ml-auto text-[10px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 rounded-full px-2 py-0.5">
                  {stats.destructiveCount} destructive
                </span>
              )}
            </div>
          </div>
          <div className={panelCls}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-1.5">Top contributor today</p>
            {stats.topContributor ? (
              <div className="flex items-center gap-2 min-w-0">
                <Trophy size={15} className="text-amber-500 shrink-0" />
                <p className="text-[14px] font-semibold text-gray-900 dark:text-obsidian-fg truncate">{stats.topContributor.name}</p>
                <span className="text-[11px] text-gray-500 dark:text-obsidian-muted shrink-0">{stats.topContributor.count} events</span>
              </div>
            ) : (
              <p className="text-sm text-gray-400 dark:text-obsidian-faded">—</p>
            )}
          </div>
          <div className={panelCls}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-1.5">Most common action</p>
            {stats.topAction ? (
              <div className="flex items-baseline gap-2 min-w-0">
                <p className="text-[14px] font-semibold text-gray-900 dark:text-obsidian-fg capitalize truncate">{stats.topAction[0]}</p>
                <span className="text-[11px] text-gray-500 dark:text-obsidian-muted shrink-0">×{stats.topAction[1]}</span>
              </div>
            ) : (
              <p className="text-sm text-gray-400 dark:text-obsidian-faded">—</p>
            )}
          </div>
        </div>
      )}

      {/* ─── Activity list ─── */}
      <div className={cn(
        'rounded-2xl border overflow-hidden',
        'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'shadow-soft dark:shadow-soft-dark',
      )}>
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="skeleton w-8 h-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 rounded w-3/4" />
                  <div className="skeleton h-3 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : !activities?.length ? (
          <div className="py-16 text-center">
            <Activity size={32} strokeWidth={1.5} className="mx-auto text-gray-300 dark:text-obsidian-faded mb-3" />
            <p className="text-sm text-gray-500 dark:text-obsidian-muted">No activity to show with these filters.</p>
            {(projectFilter || userFilter) && (
              <button
                onClick={() => { setProjectFilter(''); setUserFilter(''); }}
                className="mt-3 text-[13px] text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div>
            {BUCKET_ORDER.map((bucket) => {
              const items = grouped[bucket];
              if (!items || items.length === 0) return null;
              return (
                <div key={bucket} className="border-b border-gray-100 dark:border-obsidian-border last:border-b-0">
                  <div className="px-5 py-2.5 bg-gray-50 dark:bg-obsidian-sunken/60 sticky top-0 z-10 backdrop-blur-sm">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted">
                      {bucket}
                      <span className="font-normal text-gray-400 dark:text-obsidian-faded ml-1.5">({items.length})</span>
                    </p>
                  </div>
                  <div className="divide-y divide-gray-50 dark:divide-obsidian-border/60">
                    {items.map((activity: any) => {
                      const config = ACTION_CONFIG[activity.action] || { ...FALLBACK_CONFIG, label: activity.action.replace(/_/g, ' ') };
                      const isDestructive = config.tone === 'destructive';
                      return (
                        <div
                          key={activity.id}
                          className={cn(
                            'flex items-start gap-3 px-5 py-3 transition-colors',
                            'hover:bg-gray-50/70 dark:hover:bg-obsidian-raised/50',
                            isDestructive && 'bg-rose-50/40 dark:bg-rose-500/[0.04]',
                          )}
                        >
                          <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0', TONE_CHIP[config.tone])}>
                            {config.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] text-gray-900 dark:text-obsidian-fg leading-snug">
                              <span className="font-medium">{activity.user?.name || 'Unknown'}</span>
                              {' '}{config.label}{' '}
                              {activity.details?.title && (
                                <span className="font-medium">"{activity.details.title}"</span>
                              )}
                              {activity.details?.from && activity.details?.to && (
                                <span className="text-gray-500 dark:text-obsidian-muted"> ({activity.details.from} → {activity.details.to})</span>
                              )}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5">
                              {activity.project && (
                                <span className="text-[10px] bg-gray-100 dark:bg-obsidian-raised text-gray-600 dark:text-obsidian-muted rounded-md px-1.5 py-0.5">
                                  {activity.project.name}
                                </span>
                              )}
                              <span className="text-[10px] text-gray-400 dark:text-obsidian-faded">{formatRelative(activity.createdAt)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const selectClass = cn(
  'h-9 rounded-md px-3 text-[13px]',
  'bg-white border border-gray-200 hover:border-gray-300',
  'dark:bg-obsidian-panel dark:border-obsidian-border dark:hover:border-obsidian-border-strong',
  'text-gray-700 dark:text-obsidian-fg',
  'focus:outline-none focus:border-brand-500 dark:focus:border-brand-400',
  'transition-colors',
);

const panelCls = cn(
  'rounded-xl border p-4 hover-lift',
  'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
  'shadow-soft dark:shadow-soft-dark',
);
