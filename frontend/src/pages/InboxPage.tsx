import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Inbox as InboxIcon, MessageCircleQuestion, ShieldAlert, Check, X, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui';
import { useInbox } from '@/hooks/useInbox';
import type { InboxItem } from '@/api/inbox';
import { answerClarification, decideRunApproval } from '@/api/agentRuns';
import { formatRelative } from '@/lib/formatters';

/**
 * The HITL inbox — every run waiting on a human, across all tasks, in one place.
 * Each card carries enough context (project · task · what the agent wants) to
 * decide inline: answer a question, or approve/reject an action. Acting resumes
 * the run and drops the item from the list.
 */
export function InboxPage() {
  const { data: items, isLoading } = useInbox();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-obsidian-fg">
          <InboxIcon size={20} className="text-violet-500" />
          Inbox
        </h1>
        <p className="mt-1 text-[13px] text-gray-500 dark:text-obsidian-muted">
          Runs waiting on a human — answer questions and approve actions to unblock your agents.
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-gray-100 dark:bg-obsidian-raised" />
          ))}
        </div>
      ) : !items || items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 dark:border-obsidian-border py-16 text-center">
          <InboxIcon size={28} className="mx-auto text-gray-300 dark:text-obsidian-muted" />
          <p className="mt-3 text-[14px] font-medium text-gray-700 dark:text-obsidian-fg">You're all caught up</p>
          <p className="mt-1 text-[12px] text-gray-400 dark:text-obsidian-muted">No runs are waiting on a human right now.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <InboxCard key={`${item.kind}:${item.id}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function InboxCard({ item }: { item: InboxItem }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['inbox'] });

  const answer = useMutation({
    mutationFn: () => answerClarification(item.taskId, item.runId, item.id, text.trim()),
    onSuccess: refresh,
  });
  const decide = useMutation({
    mutationFn: (approved: boolean) => decideRunApproval(item.taskId, item.runId, item.id, approved, text.trim() || undefined),
    onSuccess: refresh,
  });

  const isClarification = item.kind === 'clarification';
  const accent = isClarification
    ? 'border-amber-300/70 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/[0.06]'
    : 'border-violet-300/70 dark:border-violet-500/30 bg-violet-50/60 dark:bg-violet-500/[0.06]';

  return (
    <div className={`rounded-lg border ${accent} p-4`}>
      <div className="flex items-start gap-3">
        {isClarification ? (
          <MessageCircleQuestion size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-violet-600 dark:text-violet-400" />
        )}
        <div className="min-w-0 flex-1">
          {/* Context: project · task number · title (clickable) */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500 dark:text-obsidian-muted">
            <span className="font-medium uppercase tracking-wide">{item.projectName}</span>
            <span>·</span>
            <span className="font-mono">{item.projectSlug.toUpperCase()}-{item.taskNumber}</span>
            <span>·</span>
            <span>waiting {formatRelative(item.waitingSince)}</span>
          </div>
          <Link
            to={`/projects/${item.projectId}/tasks/${item.taskId}`}
            className="group mt-0.5 inline-flex items-center gap-1 text-[13px] font-medium text-gray-900 dark:text-obsidian-fg hover:text-violet-600 dark:hover:text-violet-400"
          >
            {item.taskTitle}
            <ArrowRight size={12} className="opacity-0 transition group-hover:opacity-100" />
          </Link>

          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-obsidian-muted">
            {isClarification ? 'Agent needs your input' : `Approval needed${item.action ? ` · ${item.action}` : ''}`}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-gray-800 dark:text-obsidian-fg">{item.prompt}</p>
          {item.detail && (
            <p className="mt-1 text-[12px] text-gray-500 dark:text-obsidian-muted">{item.detail}</p>
          )}

          {/* Inline action */}
          {isClarification ? (
            <div className="mt-2.5">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                placeholder="Type your answer…"
                className="w-full resize-y rounded border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-base px-2 py-1.5 text-[13px] text-gray-800 dark:text-obsidian-fg placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
              <div className="mt-1.5 flex justify-end">
                <Button size="sm" variant="primary" loading={answer.isPending} disabled={!text.trim()} onClick={() => answer.mutate()}>
                  Send answer
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2.5">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Reason (optional; sent to the agent on reject)"
                className="w-full rounded border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-base px-2 py-1.5 text-[13px] text-gray-800 dark:text-obsidian-fg placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
              <div className="mt-1.5 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  leadingIcon={<X size={13} />}
                  loading={decide.isPending && decide.variables === false}
                  onClick={() => decide.mutate(false)}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  leadingIcon={<Check size={13} />}
                  loading={decide.isPending && decide.variables === true}
                  onClick={() => decide.mutate(true)}
                >
                  Approve
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
