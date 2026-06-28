import { useState } from 'react';
import {
  Bot,
  Play,
  ChevronRight,
  ChevronDown,
  ListChecks,
  Pencil,
  FlaskConical,
  GitPullRequest,
  Terminal,
  Wrench,
  Radio,
} from 'lucide-react';
import { Button } from '@/components/ui';
import {
  useTaskRuns,
  useTaskRun,
  useStartTaskRun,
  useCancelTaskRun,
} from '@/hooks/useAgentRuns';
import { useRunStream } from '@/hooks/useRunStream';
import type { RunStatus, AgentRunSummary } from '@/api/agentRuns';
import { formatRelative } from '@/lib/formatters';
import { cn } from '@/lib/cn';

const STATUS: Record<RunStatus, { label: string; dot: string; text: string }> = {
  QUEUED: { label: 'Queued', dot: 'bg-gray-400', text: 'text-gray-500 dark:text-obsidian-muted' },
  RUNNING: { label: 'Running', dot: 'bg-blue-500 animate-pulse', text: 'text-blue-600 dark:text-blue-400' },
  AWAITING_REVIEW: { label: 'Awaiting review', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  AWAITING_INPUT: { label: 'Needs input', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  BLOCKED: { label: 'Blocked', dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' },
  SUCCEEDED: { label: 'Succeeded', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  FAILED: { label: 'Failed', dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' },
  CANCELLED: { label: 'Cancelled', dot: 'bg-gray-400', text: 'text-gray-500 dark:text-obsidian-muted' },
};

const STEP_ICON: Record<string, typeof ListChecks> = {
  PLAN: ListChecks,
  EDIT: Pencil,
  TEST: FlaskConical,
  REVIEW_REQUEST: GitPullRequest,
  COMMAND: Terminal,
  TOOL_CALL: Wrench,
};

const TERMINAL: RunStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELLED'];

function StatusPill({ status }: { status: RunStatus }) {
  const s = STATUS[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium', s.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

function RunRow({
  taskId,
  run,
  open,
  onToggle,
}: {
  taskId: string;
  run: AgentRunSummary;
  open: boolean;
  onToggle: () => void;
}) {
  const { data: detail, isLoading } = useTaskRun(taskId, open ? run.id : null);
  const cancel = useCancelTaskRun(taskId);
  const active = !TERMINAL.includes(run.status);

  // Live trace: while this run is open AND still active, stream its facts. The
  // stream invalidates the queries above (so steps/status refetch live) and
  // surfaces the newest status instantly for the pill.
  const { connected, liveStatus } = useRunStream(taskId, run.id, { enabled: open && active });
  const shownStatus = liveStatus ?? run.status;

  return (
    <div className="rounded-md border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-raised">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-white/[0.02] rounded-md"
      >
        {open ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
        <StatusPill status={shownStatus} />
        {open && connected && active && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-500" title="Streaming live">
            <Radio size={10} className="animate-pulse" /> live
          </span>
        )}
        <span className="ml-auto text-[11px] text-gray-400 dark:text-obsidian-muted">
          {formatRelative(run.createdAt)}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-100 dark:border-obsidian-border">
          {isLoading ? (
            <div className="h-4 mt-2 w-32 bg-gray-100 dark:bg-white/[0.04] rounded animate-pulse" />
          ) : detail ? (
            <>
              <ol className="mt-2 space-y-1.5">
                {detail.steps.map((step) => {
                  const Icon = STEP_ICON[step.type] ?? Wrench;
                  return (
                    <li key={step.id} className="flex items-start gap-2 text-[12px]">
                      <Icon size={13} className="mt-0.5 shrink-0 text-gray-400 dark:text-obsidian-muted" />
                      <div className="min-w-0">
                        <span className="text-gray-800 dark:text-obsidian-fg">{step.title}</span>
                        {step.detail && (
                          <span className="block text-[11px] text-gray-400 dark:text-obsidian-muted">
                            {step.detail}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {detail.summary && (
                <p className="mt-2 text-[11px] italic text-gray-500 dark:text-obsidian-muted">
                  {detail.summary}
                </p>
              )}
              {active && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="mt-2"
                  loading={cancel.isPending}
                  onClick={() => cancel.mutate(run.id)}
                >
                  Cancel run
                </Button>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * Agent runs for a task — dispatch an agent and watch its run trace (plan,
 * edits, tests, PR/review). Today the run executes via the reference runtime
 * (a deterministic simulator); the in-house runtime slots in behind the same
 * API as it lands.
 */
export function RunsSection({ taskId }: { taskId: string }) {
  const { data: runs, isLoading } = useTaskRuns(taskId);
  const start = useStartTaskRun(taskId);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  const startError =
    start.isError && ((start.error as { response?: { data?: { error?: { message?: string } } } })
      ?.response?.data?.error?.message ?? 'Failed to start run');

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted">
          <Bot size={11} />
          Agent runs
        </h3>
        <Button
          variant="secondary"
          size="xs"
          leadingIcon={<Play size={12} />}
          loading={start.isPending}
          onClick={() => start.mutate(undefined, { onSuccess: (run) => setOpenRunId(run.id) })}
        >
          Run with agent
        </Button>
      </div>

      {startError && <p className="mb-2 text-[11px] text-rose-500">{startError}</p>}

      {isLoading ? (
        <div className="h-9 bg-gray-100 dark:bg-obsidian-raised rounded animate-pulse" />
      ) : !runs || runs.length === 0 ? (
        <p className="text-[12px] text-gray-400 dark:text-obsidian-muted">
          No runs yet. Dispatch an agent to start one.
        </p>
      ) : (
        <div className="space-y-1.5">
          {runs.map((run) => (
            <RunRow
              key={run.id}
              taskId={taskId}
              run={run}
              open={openRunId === run.id}
              onToggle={() => setOpenRunId(openRunId === run.id ? null : run.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
