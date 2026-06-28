import { useState } from 'react';
import { ShieldCheck, ShieldAlert, Copy, Check, GitPullRequest } from 'lucide-react';
import { useRunReceipt } from '@/hooks/useAgentRuns';
import type { RunReceipt } from '@/api/agentRuns';
import { formatRelative } from '@/lib/formatters';
import { cn } from '@/lib/cn';

/**
 * The run receipt — a tamper-evident governance record of what the run did. It
 * reads like a certificate: the integrity badge (the server recomputes the
 * digest over the stored snapshot, so "Verified" means it hasn't been altered),
 * the key facts (model, outcome, tokens, work), and the digest itself. Renders
 * only once the run has come to rest and a receipt exists.
 */
export function RunReceiptPanel({ taskId, runId, enabled }: { taskId: string; runId: string; enabled: boolean }) {
  const { data: receipt } = useRunReceipt(taskId, runId, { enabled });
  if (!receipt) return null;
  return <ReceiptCard receipt={receipt} />;
}

function ReceiptCard({ receipt }: { receipt: RunReceipt }) {
  const [copied, setCopied] = useState(false);
  const { content, verified, digest, algo } = receipt;
  const { usage, work } = content;

  const copy = () => {
    void navigator.clipboard?.writeText(digest).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="mt-2 rounded-md border border-gray-200 dark:border-obsidian-border bg-gray-50/60 dark:bg-white/[0.02] p-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted">
          Run receipt
        </p>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
            verified
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
              : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
          )}
          title={verified ? 'The stored snapshot matches its digest.' : 'The stored snapshot does not match its digest.'}
        >
          {verified ? <ShieldCheck size={11} /> : <ShieldAlert size={11} />}
          {verified ? 'Verified' : 'Tampered'}
          <span className="font-mono opacity-60">· {algo}</span>
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <Row label="Model">{content.run.model ?? '—'}</Row>
        <Row label="Tokens">
          {usage.totalTokens.toLocaleString()}
          <span className="text-gray-400 dark:text-obsidian-muted"> ({usage.inputTokens.toLocaleString()} in · {usage.outputTokens.toLocaleString()} out)</span>
        </Row>
        <Row label="Duration">{formatDuration(content.timing.durationMs)}</Row>
        <Row label="Work">
          {work.steps} step{work.steps === 1 ? '' : 's'} · {work.commits} commit{work.commits === 1 ? '' : 's'}
          {work.pullRequest && (
            <a
              href={work.pullRequest.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 inline-flex items-center gap-0.5 text-violet-600 hover:underline dark:text-violet-400"
            >
              <GitPullRequest size={11} /> {work.pullRequest.number ? `PR #${work.pullRequest.number}` : 'PR'}
            </a>
          )}
          {work.checks.total > 0 && (
            <span className="text-gray-400 dark:text-obsidian-muted"> · checks {work.checks.passed}✓ {work.checks.failed}✗</span>
          )}
        </Row>
        <Row label="Digest">
          <button onClick={copy} className="group inline-flex items-center gap-1 font-mono text-[10px] text-gray-600 hover:text-gray-900 dark:text-obsidian-muted dark:hover:text-obsidian-fg" title="Copy full digest">
            {digest.slice(0, 12)}…{digest.slice(-6)}
            {copied ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} className="opacity-0 transition group-hover:opacity-100" />}
          </button>
        </Row>
        <Row label="Issued">{formatRelative(receipt.issuedAt)}</Row>
      </dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-gray-400 dark:text-obsidian-muted">{label}</dt>
      <dd className="min-w-0 text-gray-800 dark:text-obsidian-fg">{children}</dd>
    </>
  );
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}
