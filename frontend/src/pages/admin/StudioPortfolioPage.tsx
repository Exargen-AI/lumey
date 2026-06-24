import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Users as UsersIcon, FolderKanban, Flame } from 'lucide-react';
import {
  getPortfolioGrid,
  getActiveSprintStream,
  getCapacitySnapshot,
  getAttentionItems,
  getVelocityData,
  getPortfolioAnalytics,
} from '@/api/analytics';
import { getMyProductivityStats } from '@/api/dailyUpdates';
import { useAuthStore } from '@/stores/authStore';
import { ProductHealthGrid } from '@/components/portfolio/ProductHealthGrid';
import { ActiveSprintStream } from '@/components/portfolio/ActiveSprintStream';
import { CapacityVelocityRow } from '@/components/portfolio/CapacityVelocityRow';
import { AttentionList } from '@/components/portfolio/AttentionList';
import { cn } from '@/lib/cn';

/**
 * Studio Portfolio Home — the landing page after a SUPER_ADMIN logs in.
 *
 * Four vertical bands, top to bottom:
 *   1. Product Health Grid — at-a-glance card per product
 *   2. Cross-product Sprint Stream — every active task, grouped by status
 *   3. Capacity / Velocity / My-time — three compact charts side-by-side
 *   4. Attention List — auto-generated alerts that need a routing decision
 *
 * Data is fetched via individual queries (not a single bundled endpoint) so
 * any one band's slow service can't block the others, and React Query can
 * stagger renders. Each query refreshes itself every 60s.
 */
export function StudioPortfolioPage() {
  const user = useAuthStore((s) => s.user);
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const grid       = useQuery({ queryKey: ['portfolio-grid'],    queryFn: getPortfolioGrid,        refetchInterval: 60_000 });
  const stream     = useQuery({ queryKey: ['active-stream'],     queryFn: getActiveSprintStream,   refetchInterval: 60_000 });
  const capacity   = useQuery({ queryKey: ['capacity'],          queryFn: getCapacitySnapshot,     refetchInterval: 60_000 });
  const attention  = useQuery({ queryKey: ['attention'],         queryFn: getAttentionItems,       refetchInterval: 60_000 });
  const velocity   = useQuery({ queryKey: ['velocity', 8],       queryFn: () => getVelocityData(8) });
  const portfolio  = useQuery({ queryKey: ['portfolio-summary'], queryFn: getPortfolioAnalytics });
  const myProductivity = useQuery({
    queryKey: ['my-productivity', 7], queryFn: () => getMyProductivityStats(7),
  });

  // ─── Top-line metrics ───
  // Most of these come pre-aggregated from /analytics/portfolio. Where the
  // shape is missing (active engineers, my-streak), we derive client-side.
  const metrics = useMemo(() => {
    const cards = grid.data ?? [];
    const totalProducts = cards.length;
    const totalActive = cards.filter((c) => c.currentSprint).length;
    const totalBlocked = cards.reduce((s, c) => s + c.blockedCount, 0);
    const totalInFlight = stream.data?.length ?? 0;

    // Engineer count via portfolio summary if loaded
    const teamUtil = portfolio.data?.metrics?.teamUtilization;
    const totalEngineers = teamUtil
      ? teamUtil.overloaded + teamUtil.balanced + teamUtil.available
      : null;

    const myStreak = myProductivity.data?.currentStreak ?? null;

    return {
      totalProducts, totalActive, totalBlocked, totalInFlight, totalEngineers, myStreak,
    };
  }, [grid.data, stream.data, portfolio.data, myProductivity.data]);

  // ─── My time-distribution: derive from my-productivity stats ───
  const myTimeDistribution = useMemo(() => {
    const projects = myProductivity.data?.projectBreakdown as
      | Array<{ projectId: string; projectName: string; tasks: number }>
      | undefined;
    return projects ?? [];
  }, [myProductivity.data]);

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-end justify-between gap-4 animate-fade-in-down">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-400 dark:text-obsidian-faded">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
            {greeting},{' '}
            <span className="bg-gradient-to-r from-brand-500 to-brand-300 bg-clip-text text-transparent">
              {firstName}
            </span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-obsidian-muted mt-1.5">
            Studio portfolio — {metrics.totalActive} of {metrics.totalProducts} products are sprinting today.
          </p>
        </div>

        {/* Right-side metric strip — compact, scannable */}
        <div className="hidden md:flex items-stretch gap-2">
          <Stat icon={<FolderKanban size={13} />} label="Products" value={metrics.totalProducts} />
          <Stat icon={<Activity size={13} />} label="In flight" value={metrics.totalInFlight} />
          <Stat
            icon={<UsersIcon size={13} />}
            label="Team"
            value={metrics.totalEngineers ?? '—'}
          />
          <Stat
            icon={<Flame size={13} className={metrics.myStreak ? 'text-orange-400' : ''} />}
            label="My EOD streak"
            value={metrics.myStreak != null ? `${metrics.myStreak}d` : '—'}
            tone={metrics.myStreak && metrics.myStreak >= 5 ? 'highlight' : 'default'}
          />
        </div>
      </div>

      {/* ─── Band 1: Product Health Grid ─── */}
      <Section
        eyebrow="Portfolio"
        title="Product health"
        subtitle="One card per product — lead, current sprint, blockers, 8-week velocity."
      >
        <ProductHealthGrid cards={grid.data ?? []} isLoading={grid.isLoading} />
      </Section>

      {/* ─── Band 2: Active Sprint Stream ─── */}
      <Section
        eyebrow="Live"
        title="What's happening right now"
        subtitle="Every task in any active sprint, across all products. Filter to focus."
        accent
      >
        <ActiveSprintStream tasks={stream.data ?? []} isLoading={stream.isLoading} />
      </Section>

      {/* ─── Band 3: Capacity / Velocity / My time ─── */}
      <Section
        eyebrow="Trends"
        title="Capacity & velocity"
        subtitle="How loaded each product is, and where its trend is heading."
      >
        <CapacityVelocityRow
          capacity={capacity.data}
          velocityRows={velocity.data ?? []}
          myTimeDistribution={myTimeDistribution}
          isLoading={capacity.isLoading || velocity.isLoading}
        />
      </Section>

      {/* ─── Band 4: Attention List ─── */}
      <Section
        eyebrow="Triage"
        title="Needs attention"
        subtitle="Auto-detected alerts that need a routing decision today."
      >
        <AttentionList items={attention.data ?? []} isLoading={attention.isLoading} />
      </Section>
    </div>
  );
}

function Stat({
  icon, label, value, tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone?: 'default' | 'highlight';
}) {
  return (
    <div className={cn(
      'flex flex-col gap-0.5 px-3 py-2 rounded-lg border min-w-[88px]',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      tone === 'highlight' && 'border-orange-300/40 dark:border-orange-500/25 bg-orange-50/40 dark:bg-orange-500/[0.04]',
    )}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-faded">
        {icon}
        {label}
      </div>
      <div className="text-base font-semibold tabular-nums text-gray-900 dark:text-obsidian-fg">
        {value}
      </div>
    </div>
  );
}

function Section({
  eyebrow, title, subtitle, accent, children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3">
        <span className={cn(
          'inline-block text-[9px] font-bold uppercase tracking-[0.18em] px-1.5 py-0.5 rounded',
          accent
            ? 'text-brand-600 dark:text-brand-300 bg-brand-500/10 ring-1 ring-brand-500/20'
            : 'text-gray-500 dark:text-obsidian-muted bg-gray-100 dark:bg-obsidian-raised',
        )}>
          {eyebrow}
        </span>
        <h2 className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
          {title}
        </h2>
        <span className="text-[11px] text-gray-400 dark:text-obsidian-faded truncate hidden md:inline">
          {subtitle}
        </span>
      </div>
      {children}
    </section>
  );
}
