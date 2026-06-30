import { useQuery } from '@tanstack/react-query';
import { Cpu, Server, Cloud, CheckCircle2, CircleDashed, KeyRound, Star } from 'lucide-react';
import { listModelProviders, type ModelProvider, type ModelProviderKind } from '@/api/models';
import { cn } from '@/lib/cn';

/**
 * Models — the sovereign, three-option model strategy made visible. Lumey routes
 * every run through one `ModelClient` seam over three tiers, in priority order:
 * local (air-gap, zero cost) → self-hosted OSS → frontier (controlled). An
 * agent's policy model overrides; the default tier handles everything else.
 */
export function ModelsPage() {
  const { data: providers, isLoading } = useQuery({ queryKey: ['model-providers'], queryFn: listModelProviders });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-1 flex items-center gap-2">
        <Cpu size={20} className="text-violet-500" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-obsidian-fg">Models</h1>
      </header>
      <p className="mb-5 text-[13px] text-gray-500 dark:text-obsidian-muted">
        One <span className="font-medium">ModelClient</span> seam, three tiers — routed
        <span className="font-medium"> local → self-hosted → frontier</span> (sovereign first). An agent's
        policy model overrides the default; the rest fall through this order.
      </p>

      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-100 dark:bg-obsidian-raised" />)}</div>
      ) : (
        <div className="space-y-3">
          {providers?.map((p) => <ProviderCard key={p.id} provider={p} />)}
        </div>
      )}
    </div>
  );
}

const KIND_ICON: Record<ModelProviderKind, typeof Cpu> = { LOCAL: Cpu, SELF_HOSTED: Server, FRONTIER: Cloud };

function ProviderCard({ provider }: { provider: ModelProvider }) {
  const Icon = KIND_ICON[provider.kind];
  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        provider.configured
          ? 'border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-raised'
          : 'border-dashed border-gray-200 dark:border-obsidian-border bg-gray-50/50 dark:bg-white/[0.015]',
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5 rounded-md p-1.5', provider.configured ? 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' : 'bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-obsidian-muted')}>
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-gray-900 dark:text-obsidian-fg">{provider.label}</span>
            {provider.isDefault && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                <Star size={10} /> default
              </span>
            )}
            {provider.requiresKey && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/5 dark:text-obsidian-muted" title="Authenticates with an API key">
                <KeyRound size={10} /> key
              </span>
            )}
            <span className="ml-auto">
              {provider.configured ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={12} /> configured
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 dark:text-obsidian-muted">
                  <CircleDashed size={12} /> not configured
                </span>
              )}
            </span>
          </div>

          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
            <dt className="text-gray-400 dark:text-obsidian-muted">Model</dt>
            <dd className="font-mono text-gray-800 dark:text-obsidian-fg">{provider.model ?? '—'}</dd>
            <dt className="text-gray-400 dark:text-obsidian-muted">Endpoint</dt>
            <dd className="truncate font-mono text-gray-600 dark:text-obsidian-muted">{provider.endpoint ?? '—'}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}
