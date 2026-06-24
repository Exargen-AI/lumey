/* eslint-disable no-alert -- Phase 4 migration target: replace
   `window.prompt` clipboard fallback with a toast + secondary copy button. */

import { useState } from 'react';
import { Check, Copy, ExternalLink, Github, Loader2, AlertTriangle, Trash2 } from 'lucide-react';
import { useGitHubIntegration, useConnectGitHub, useDisconnectGitHub } from '@/hooks/useGitHubIntegration';
import type { GitHubConnectResponse } from '@/api/githubIntegration';
import { Button, Field, Input, useConfirm } from '@/components/ui';
import { formatRelative } from '@/lib/formatters';
import { cn } from '@/lib/cn';

interface Props {
  projectId: string;
}

/**
 * Settings card for the per-project GitHub integration. Three states:
 *  - Disconnected → form for repo owner / name + auto-close toggle.
 *  - Just connected → big "copy these into GitHub" panel with the secret
 *    (shown ONCE — server never echoes it back).
 *  - Connected → status pill, last-webhook-at health, disconnect button.
 *
 * The secret is intentionally not stored anywhere persistent client-side.
 * If the admin closes the panel before pasting it into GitHub, they have
 * to disconnect + reconnect (which mints a fresh secret).
 */
export function GitHubIntegrationCard({ projectId }: Props) {
  const { data: integration, isLoading } = useGitHubIntegration(projectId);
  const connectMut = useConnectGitHub(projectId);
  const disconnectMut = useDisconnectGitHub(projectId);
  const confirm = useConfirm();

  // Form state
  const [repoOwner, setRepoOwner] = useState('');
  const [repoName, setRepoName] = useState('');
  const [autoClose, setAutoClose] = useState(false);
  // The connect response is held in component state so the secret/url panel
  // survives until the admin clicks "I've copied it".
  const [justConnected, setJustConnected] = useState<GitHubConnectResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!repoOwner.trim() || !repoName.trim()) {
      setError('Both repo owner and name are required.');
      return;
    }
    try {
      const result = await connectMut.mutateAsync({
        repoOwner: repoOwner.trim(),
        repoName: repoName.trim(),
        autoCloseOnMerge: autoClose,
      });
      setJustConnected(result);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Failed to connect.');
    }
  };

  const handleDisconnect = async () => {
    if (await confirm({
      title: 'Disconnect GitHub?',
      body: 'New PRs from this repo will stop linking to tasks. Existing links stay. Reconnecting later mints a new webhook secret.',
      confirmLabel: 'Disconnect',
      tone: 'warning',
    })) {
      await disconnectMut.mutateAsync();
      setJustConnected(null);
      setRepoOwner('');
      setRepoName('');
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-obsidian-border p-5 bg-white dark:bg-obsidian-bg animate-pulse">
        <div className="h-4 w-32 bg-gray-200 dark:bg-obsidian-raised rounded mb-3" />
        <div className="h-3 w-64 bg-gray-200 dark:bg-obsidian-raised rounded" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-bg p-5">
      <header className="flex items-center gap-2.5 mb-4">
        <Github size={18} className="text-gray-700 dark:text-obsidian-fg" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-obsidian-fg">GitHub PR linking</h3>
        {integration && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 rounded-full px-2 py-0.5">
            <Check size={11} /> Connected
          </span>
        )}
      </header>

      {/* Connected card */}
      {integration && !justConnected && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-[12.5px]">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-obsidian-muted mb-0.5">Repository</div>
              <a
                href={`https://github.com/${integration.repoOwner}/${integration.repoName}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 dark:text-brand-300 hover:underline inline-flex items-center gap-1"
              >
                {integration.repoOwner}/{integration.repoName}
                <ExternalLink size={11} />
              </a>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-obsidian-muted mb-0.5">Auto-close on merge</div>
              <span className="text-gray-700 dark:text-obsidian-fg">{integration.autoCloseOnMerge ? 'On' : 'Off'}</span>
            </div>
            <div className="col-span-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-obsidian-muted mb-0.5">Last webhook</div>
              <span className="text-gray-700 dark:text-obsidian-fg">
                {integration.lastWebhookAt ? formatRelative(integration.lastWebhookAt) : 'Never received — check GitHub webhook setup'}
              </span>
            </div>
            {/* Webhook health pill — yellow/red when the most recent activity
                was an error. We compare timestamps rather than just the
                error fields' presence so a single transient failure clears
                the moment the next success lands (Round 2 #11). */}
            {integration.lastWebhookErrorAt &&
              (!integration.lastWebhookAt ||
                new Date(integration.lastWebhookErrorAt) > new Date(integration.lastWebhookAt)) && (
              <div className="col-span-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/[0.08] px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-0.5">
                  Last webhook failed · {formatRelative(integration.lastWebhookErrorAt)}
                </div>
                {integration.lastWebhookError && (
                  <div className="text-[11px] text-amber-800 dark:text-amber-300 break-words">
                    {integration.lastWebhookError}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex justify-end pt-1">
            <Button variant="ghost" size="sm" onClick={handleDisconnect} leadingIcon={<Trash2 size={13} />}>
              Disconnect
            </Button>
          </div>
        </div>
      )}

      {/* Just connected — show the one-time secret + setup instructions */}
      {justConnected && (
        <ConnectedSuccessPanel data={justConnected} onDone={() => setJustConnected(null)} />
      )}

      {/* Disconnected — connect form. Team feedback #5: the previous one-
          liner explainer was too thin; users tried to fill the form without
          knowing they'd need to also visit GitHub afterward. We now show
          the full 3-step flow upfront so the user knows what they're
          signing up for before they click Connect. */}
      {!integration && !justConnected && (
        <form onSubmit={handleConnect} className="space-y-4">
          {/* What this does */}
          <div className="rounded-md bg-brand-50 dark:bg-brand-500/[0.06] border border-brand-200/60 dark:border-brand-500/20 p-3 text-[12.5px] text-gray-700 dark:text-obsidian-fg leading-relaxed">
            <p className="font-medium mb-1.5">How GitHub PR linking works</p>
            <p className="text-gray-600 dark:text-obsidian-muted">
              Once connected, mention a task ID (e.g. <code className="text-[11px] bg-white dark:bg-obsidian-bg px-1 py-0.5 rounded border border-brand-200/40">FURIX-7</code>) in any PR title or body and it shows up on that task automatically. Use <code className="text-[11px] bg-white dark:bg-obsidian-bg px-1 py-0.5 rounded border border-brand-200/40">Closes FURIX-7</code> to auto-move the task to Done when the PR merges.
            </p>
          </div>

          {/* Step preview — sets expectations before they start filling. */}
          <div className="rounded-md bg-gray-50 dark:bg-obsidian-raised/40 border border-gray-200 dark:border-obsidian-border p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-600 dark:text-obsidian-muted mb-2">Setup — about 2 minutes</p>
            <ol className="space-y-1.5 text-[12.5px] text-gray-700 dark:text-obsidian-fg">
              <li className="flex gap-2"><span className="text-brand-600 dark:text-brand-400 font-semibold">1.</span><span>Enter your GitHub repo's owner and name below, then click <strong>Connect GitHub</strong>.</span></li>
              <li className="flex gap-2"><span className="text-brand-600 dark:text-brand-400 font-semibold">2.</span><span>We generate a webhook URL + secret. Copy both — the secret is shown <strong>only once</strong>.</span></li>
              <li className="flex gap-2"><span className="text-brand-600 dark:text-brand-400 font-semibold">3.</span><span>In GitHub: <em>Repo Settings → Webhooks → Add webhook</em>. Paste the URL + secret, set Content type to <code className="text-[11px] bg-white dark:bg-obsidian-bg px-1 py-0.5 rounded">application/json</code>, choose "Pull requests" events.</span></li>
            </ol>
            <p className="text-[11.5px] text-gray-500 dark:text-obsidian-muted mt-2">
              You'll need admin access to the GitHub repo (the "Settings" tab is admin-only).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Repo owner" hint="The username or organisation that owns the repo">
              <Input value={repoOwner} onChange={(e) => setRepoOwner(e.target.value)} placeholder="exargen" autoFocus />
            </Field>
            <Field label="Repo name" hint="Just the repo name, no slashes">
              <Input value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="furix" />
            </Field>
          </div>
          <p className="text-[11.5px] text-gray-500 dark:text-obsidian-muted -mt-1">
            For <code className="text-[11px] bg-gray-100 dark:bg-obsidian-raised px-1 py-0.5 rounded">github.com/exargen/furix</code> the owner is <code className="text-[11px] bg-gray-100 dark:bg-obsidian-raised px-1 py-0.5 rounded">exargen</code> and the name is <code className="text-[11px] bg-gray-100 dark:bg-obsidian-raised px-1 py-0.5 rounded">furix</code>.
          </p>
          <label className="flex items-center gap-2 cursor-pointer text-[12.5px] text-gray-700 dark:text-obsidian-fg select-none">
            <input
              type="checkbox"
              checked={autoClose}
              onChange={(e) => setAutoClose(e.target.checked)}
              className="w-4 h-4 rounded text-brand-600 accent-brand-600"
            />
            Auto-close tasks when their PR merges (only if PR uses "Closes &lt;ID&gt;" keyword)
          </label>
          {error && (
            <p className="text-[12px] text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
              <AlertTriangle size={13} /> {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="sm" disabled={connectMut.isPending}>
              {connectMut.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Connecting…
                </>
              ) : (
                'Connect GitHub'
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function ConnectedSuccessPanel({ data, onDone }: { data: GitHubConnectResponse; onDone: () => void }) {
  const [copied, setCopied] = useState<'url' | 'secret' | null>(null);

  const copy = async (kind: 'url' | 'secret', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard write can fail in some embedding contexts. Surface a hint
      // rather than silently swallow.
      window.prompt('Copy this manually:', value);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 p-3">
        <p className="text-[12.5px] text-emerald-800 dark:text-emerald-200 font-medium leading-snug">
          Connected. <span className="font-normal">Add a webhook in GitHub now — the secret below is shown ONCE and won't be retrievable later.</span>
        </p>
      </div>

      <CopyRow label="Payload URL" value={data.webhookUrl} kind="url" copied={copied} onCopy={copy} />
      <CopyRow label="Secret" value={data.webhookSecret} kind="secret" copied={copied} onCopy={copy} mono />

      <div className="text-[11.5px] text-gray-600 dark:text-obsidian-muted leading-relaxed bg-gray-50 dark:bg-obsidian-raised/40 rounded-md p-3">
        <p className="font-semibold mb-1.5 text-gray-700 dark:text-obsidian-fg">In GitHub: Settings → Webhooks → Add webhook</p>
        <ul className="list-disc pl-4 space-y-0.5">
          <li>Paste both values above.</li>
          <li>Content type: <code className="text-[11px] bg-white dark:bg-obsidian-bg px-1 rounded">application/json</code></li>
          <li>Events: <span className="font-medium">Pull requests</span> only.</li>
          <li>Active: ✓</li>
        </ul>
      </div>

      <div className="flex justify-end pt-1">
        <Button variant="primary" size="sm" onClick={onDone}>I've copied them</Button>
      </div>
    </div>
  );
}

function CopyRow({
  label, value, kind, copied, onCopy, mono,
}: {
  label: string;
  value: string;
  kind: 'url' | 'secret';
  copied: 'url' | 'secret' | null;
  onCopy: (kind: 'url' | 'secret', value: string) => void;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-obsidian-muted mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <code
          className={cn(
            'flex-1 px-2.5 py-2 rounded-md bg-gray-50 dark:bg-obsidian-raised/60 border border-gray-200 dark:border-obsidian-border text-gray-800 dark:text-obsidian-fg break-all',
            mono ? 'font-mono text-[11.5px]' : 'text-[12.5px]',
          )}
        >
          {value}
        </code>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onCopy(kind, value)}
          leadingIcon={copied === kind ? <Check size={13} /> : <Copy size={13} />}
        >
          {copied === kind ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}
