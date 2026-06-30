import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio, Bot, Coins, Activity as ActivityIcon, ArrowRight } from 'lucide-react';
import { useFleetOverview, useFleetRuns } from '@/hooks/useFleet';
import type { RunStatus } from '@/api/agentRuns';
import { formatRelative } from '@/lib/formatters';
import { cn } from '@/lib/cn';

/** Colour per run status — shared by the distribution chips + the runs table. */
const STATUS: Record<RunStatus, { label: string; dot: string; text: string }> = {
  QUEUED: { label: 'Queued', dot: 'bg-gray-400', text: 'text-gray-500 dark:text-obsidian-muted' },
  RUNNING: { label: 'Running', dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400' },
  PAUSED: { label: 'Paused', dot: 'bg-indigo-400', text: 'text-indigo-600 dark:text-indigo-400' },
  AWAITING_INPUT: { label: 'Needs input', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  AWAITING_REVIEW: { label: 'Awaiting review', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  BLOCKED: { label: 'Blocked', dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' },
  SUCCEEDED: { label: 'Succeeded', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  FAILED: { label: 'Failed', dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' },
  CANCELLED: { label: 'Cancelled', dot: 'bg-gray-400', text: 'text-gray-500 dark:text-obsidian-muted' },
};

export function FleetPage() {
  const { data: overview, isLoading } = useFleetOverview();
  const [statusFilter, setStatusFilter] = useState<RunStatus | ''>('');
  const { data: runs } = useFleetRuns(statusFilter || undefined);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-1 flex items-center gap-2">
        <Radio size={20} className="text-violet-500" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-obsidian-fg">Fleet</h1>
      </header>
      <p className="mb-5 text-[13px] text-gray-500 dark:text-obsidian-muted">
        Every agent run across the system — what's in flight, how it's distributed, and which agents are doing the work.
      </p>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={<Radio size={14} />} label="Active runs" value={overview?.totals.active ?? 0} accent="violet" loading={isLoading} />
        <Stat icon={<ActivityIcon size={14} />} label="Total runs" value={overview?.totals.total ?? 0} loading={isLoading} />
        <Stat icon={<ActivityIcon size={14} />} label="Last 24h" value={overview?.last24h.runs ?? 0} loading={isLoading} />
        <Stat icon={<Coins size={14} />} label="Tokens" value={overview?.tokens ?? 0} loading={isLoading} />
      </div>

      {/* Lifecycle distribution */}
      {overview && overview.byStatus.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted">Lifecycle</h2>
          <div className="flex flex-wrap gap-1.5">
            {overview.byStatus.map((s) => (
              <span key={s.status} className={cn('inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-raised px-2 py-1 text-[11px]', STATUS[s.status].text)}>
                <span className={cn('h-1.5 w-1.5 rounded-full', STATUS[s.status].dot)} />
                {STATUS[s.status].label}
                <span className="font-semibold text-gray-700 dark:text-obsidian-fg">{s.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Per-agent rollup */}
      {overview && overview.agents.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted">Agents</h2>
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-obsidian-border">
            <table className="w-full text-[12px]">
              <thead className="bg-gray-50 dark:bg-white/[0.02] text-gray-400 dark:text-obsidian-muted">
                <tr>
                  <Th>Agent</Th><Th right>Runs</Th><Th right>Active</Th><Th right>Failed</Th><Th right>Tokens</Th>
                </tr>
              </thead>
              <tbody>
                {overview.agents.map((a) => (
                  <tr key={a.agentId} className="border-t border-gray-100 dark:border-obsidian-border">
                    <Td><span className="inline-flex items-center gap-1.5 font-medium text-gray-800 dark:text-obsidian-fg"><Bot size={12} className="text-violet-500" />{a.name}</span></Td>
                    <Td right>{a.runs}</Td>
                    <Td right>{a.active > 0 ? <span className="text-blue-600 dark:text-blue-400">{a.active}</span> : '—'}</Td>
                    <Td right>{a.failed > 0 ? <span className="text-rose-600 dark:text-rose-400">{a.failed}</span> : '—'}</Td>
                    <Td right>{a.tokens.toLocaleString()}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recent runs */}
      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted">Recent runs</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as RunStatus | '')}
            className="rounded border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-base px-2 py-1 text-[11px] text-gray-700 dark:text-obsidian-fg focus:outline-none"
          >
            <option value="">All statuses</option>
            {(Object.keys(STATUS) as RunStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </select>
        </div>
        {!runs || runs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-200 dark:border-obsidian-border py-10 text-center text-[12px] text-gray-400 dark:text-obsidian-muted">
            No runs{statusFilter ? ` with status ${STATUS[statusFilter].label}` : ' yet'}.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-obsidian-border">
            <table className="w-full text-[12px]">
              <thead className="bg-gray-50 dark:bg-white/[0.02] text-gray-400 dark:text-obsidian-muted">
                <tr><Th>Status</Th><Th>Task</Th><Th>Agent</Th><Th>Model</Th><Th right>Tokens</Th><Th right>When</Th></tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 dark:border-obsidian-border">
                    <Td>
                      <span className={cn('inline-flex items-center gap-1.5', STATUS[r.status].text)}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', STATUS[r.status].dot)} />{STATUS[r.status].label}
                      </span>
                    </Td>
                    <Td>
                      <Link to={`/projects/${r.task.projectId}/tasks/${r.task.id}`} className="group inline-flex items-center gap-1 text-gray-800 hover:text-violet-600 dark:text-obsidian-fg dark:hover:text-violet-400">
                        <span className="max-w-[180px] truncate">{r.task.title}</span>
                        <ArrowRight size={11} className="opacity-0 transition group-hover:opacity-100" />
                      </Link>
                    </Td>
                    <Td><span className="text-gray-600 dark:text-obsidian-muted">{r.agent.name}</span></Td>
                    <Td><span className="font-mono text-[11px] text-gray-500 dark:text-obsidian-muted">{r.model ?? '—'}</span></Td>
                    <Td right>{r.totalTokens.toLocaleString()}</Td>
                    <Td right><span className="text-gray-400 dark:text-obsidian-muted">{formatRelative(r.createdAt)}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ icon, label, value, accent, loading }: { icon: React.ReactNode; label: string; value: number; accent?: 'violet'; loading?: boolean }) {
  return (
    <div className={cn('rounded-lg border p-3', accent === 'violet' ? 'border-violet-200 dark:border-violet-500/30 bg-violet-50/50 dark:bg-violet-500/[0.06]' : 'border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-raised')}>
      <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-obsidian-muted">{icon}{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-obsidian-fg">{loading ? '—' : value.toLocaleString()}</p>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={cn('px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide', right ? 'text-right' : 'text-left')}>{children}</th>;
}
function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td className={cn('px-3 py-2', right ? 'text-right tabular-nums' : 'text-left')}>{children}</td>;
}
