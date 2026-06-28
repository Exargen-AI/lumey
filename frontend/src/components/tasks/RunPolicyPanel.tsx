import { ShieldHalf, Ban, Wrench, Coins, Footprints, Cpu } from 'lucide-react';
import { useAgentPolicy } from '@/hooks/useAgentRuns';
import type { EffectivePolicy } from '@/api/agentPolicy';

/**
 * The governance policy in force for this run's agent — least-privilege made
 * visible. The receipt proves what a run *did*; this shows what the agent is
 * *allowed* to do: a kill-switch, a tool allowlist, and per-run token/step
 * ceilings. Self-hides when the agent is unrestricted (no policy to show).
 */
export function RunPolicyPanel({ agentId, enabled }: { agentId: string; enabled: boolean }) {
  const { data: policy } = useAgentPolicy(agentId, { enabled });
  if (!policy || !isRestricted(policy)) return null;

  return (
    <div className="mt-2 rounded-md border border-sky-300/60 dark:border-sky-500/30 bg-sky-50/50 dark:bg-sky-500/[0.06] p-2.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-sky-700 dark:text-sky-400">
        <ShieldHalf size={11} />
        Governed by policy
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {!policy.enabled && (
          <Chip tone="rose" Icon={Ban}>Disabled</Chip>
        )}
        {policy.allowedTools && (
          <Chip Icon={Wrench} title={policy.allowedTools.join(', ')}>
            {policy.allowedTools.length} tool{policy.allowedTools.length === 1 ? '' : 's'}
          </Chip>
        )}
        {policy.maxRunTokens != null && (
          <Chip Icon={Coins}>{policy.maxRunTokens.toLocaleString()} token cap</Chip>
        )}
        {policy.maxRunSteps != null && (
          <Chip Icon={Footprints}>{policy.maxRunSteps} step cap</Chip>
        )}
        {policy.model && (
          <Chip Icon={Cpu}>{policy.model}</Chip>
        )}
      </div>
      {policy.allowedTools && (
        <p className="mt-1.5 truncate text-[10px] text-gray-400 dark:text-obsidian-muted" title={policy.allowedTools.join(', ')}>
          Allowed: {policy.allowedTools.join(' · ')}
        </p>
      )}
    </div>
  );
}

function isRestricted(p: EffectivePolicy): boolean {
  return !p.enabled || p.allowedTools !== null || p.maxRunTokens != null || p.maxRunSteps != null || p.model != null;
}

function Chip({ Icon, children, tone = 'sky', title }: { Icon: typeof Wrench; children: React.ReactNode; tone?: 'sky' | 'rose'; title?: string }) {
  const tones = {
    sky: 'border-sky-200 dark:border-sky-500/30 bg-white dark:bg-obsidian-raised text-sky-700 dark:text-sky-300',
    rose: 'border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400',
  };
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${tones[tone]}`}>
      <Icon size={11} />
      {children}
    </span>
  );
}
