import { useState, useRef, useEffect } from 'react';
import { User, UserX, AlertOctagon, Filter, X, Users, Check, Search, Bot } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useProjectMembers } from '@/hooks/useProjects';
import { useAuthStore } from '@/stores/authStore';

export interface KanbanFilters {
  mine: boolean;
  unassigned: boolean;
  p0: boolean;
  p1: boolean;
  blocked: boolean;
  /**
   * Pin to a specific teammate's tasks. Mutually exclusive with `mine`
   * + `unassigned` at the UX level — the picker clears those when set,
   * and the chips clear this when toggled. Stored as a userId (not a
   * name) so a rename doesn't drift the filter.
   *
   * 2026-05-21 Pankaj feedback: scrolling 20 tasks across columns to
   * find someone's queue is painful. This picker turns it into one
   * click.
   */
  assigneeId?: string | null;
  /**
   * Show only tasks assigned to AGENT users (e.g. Manjari). Useful
   * for "what's the agent runtime doing right now?" queries. Hidden
   * from the chip row when the viewer is a CLIENT (clients don't see
   * agent activity by design — Pankaj 2026-05-22 policy).
   */
  agentsOnly?: boolean;
}

export const EMPTY_FILTERS: KanbanFilters = {
  mine: false,
  unassigned: false,
  p0: false,
  p1: false,
  blocked: false,
  assigneeId: null,
  agentsOnly: false,
};

export function isAnyFilterActive(f: KanbanFilters): boolean {
  return f.mine || f.unassigned || f.p0 || f.p1 || f.blocked || !!f.assigneeId || !!f.agentsOnly;
}

/**
 * Returns true if the task should remain visible under the current filter
 * combination. AND across categories of filters that are mutually
 * non-orthogonal (mine vs unassigned), OR within a category (P0 + P1).
 *
 * `assigneeId` (the picker) takes precedence over `mine` / `unassigned`
 * when set — the UX clears those when the picker fires, but defensive
 * here so a stale combination still resolves to "scoped to that user".
 *
 * DONE-exclusion rule (Pankaj 2026-05-22 bug report): when ANY
 * assignee-axis filter is active (mine / unassigned / assigneeId), we
 * hide DONE tasks. Rationale: those filters express "what is this
 * person / this queue working on next?" — a closed-out done task isn't
 * triage signal. Priority + blocked filters DON'T trigger this carve-
 * out because they're about classification, not active workload (e.g.
 * "show me all P0 work, including what shipped this sprint" is a
 * legit reporting query).
 *
 * Anti-surprise: if the user wants to see done tasks while filtering
 * by a user, they can drag the Done column open and the unfiltered
 * Done column stays visible. (The column itself isn't hidden — only
 * the filtered tasks inside.)
 */
export function applyKanbanFilters(task: any, filters: KanbanFilters, currentUserId: string | null): boolean {
  const assigneeFilterActive = !!filters.assigneeId || filters.mine || filters.unassigned || !!filters.agentsOnly;

  // Hide DONE when scoped by user. Bug Pankaj reported 2026-05-22:
  // filtering Unassigned was showing completed tasks, which is noise
  // for a triage queue.
  if (assigneeFilterActive && task.status === 'DONE') return false;

  // Agents-only filter (Pankaj 2026-05-22): show tasks assigned to
  // any AGENT user. Requires the task payload to include
  // `assignee.userType` — backend was extended in the same commit
  // to surface it. Tasks without an assignee or with a HUMAN
  // assignee are filtered out.
  if (filters.agentsOnly) {
    if (!task.assignee || task.assignee.userType !== 'AGENT') return false;
  }

  // Specific-assignee filter wins over generic mine/unassigned.
  if (filters.assigneeId) {
    if (task.assigneeId !== filters.assigneeId) return false;
  } else if (filters.mine && filters.unassigned) {
    // "mine OR unassigned" — useful when an admin wants to see their own work
    // PLUS the orphan tasks they need to triage.
    if (task.assigneeId !== currentUserId && task.assigneeId != null) return false;
  } else if (filters.mine) {
    if (task.assigneeId !== currentUserId) return false;
  } else if (filters.unassigned) {
    if (task.assigneeId != null) return false;
  }

  // Priority category — OR
  if (filters.p0 || filters.p1) {
    const matches =
      (filters.p0 && task.priority === 'P0') ||
      (filters.p1 && task.priority === 'P1');
    if (!matches) return false;
  }

  // Blocked
  if (filters.blocked && !task.isBlocked) return false;

  return true;
}

interface KanbanFilterChipsProps {
  filters: KanbanFilters;
  onChange: (next: KanbanFilters) => void;
  /** Visible task counts to show on chips that affect a small subset. */
  counts?: {
    mine?: number;
    unassigned?: number;
    p0?: number;
    p1?: number;
    blocked?: number;
  };
  /**
   * The project the board is scoped to. Used to fetch the member list
   * for the assignee picker. Optional so the chips render even on
   * cross-project boards (e.g. the personal "My Tasks" page) — the
   * picker just hides when there's no project context.
   */
  projectId?: string;
  /**
   * Client portal board. When true, agent chrome (the "Agents" filter chip
   * and agent entries in the assignee picker) is suppressed UNCONDITIONALLY —
   * agents are internal and must never surface on the client surface, even
   * when a SUPER_ADMIN is previewing the client portal. A real client is
   * already covered by the role/canViewAgents gate + backend filtering; this
   * makes the preview faithful and is defense-in-depth.
   */
  clientView?: boolean;
}

/**
 * Quick-filter chips for the kanban. Click toggles each. Cleared via the
 * trailing X. Designed to be cheap and reversible — never destructive.
 *
 * 2026-05-21 additions:
 *   - Assignee picker chip (the Pankaj ask). Member dropdown with a
 *     quick filter input; selecting a user pins the board to their
 *     queue. Mutually exclusive with mine/unassigned at the UX level.
 */
export function KanbanFilterChips({ filters, onChange, counts, projectId, clientView = false }: KanbanFilterChipsProps) {
  const active = isAnyFilterActive(filters);
  const set = (patch: Partial<KanbanFilters>) => onChange({ ...filters, ...patch });

  // 2026-06-01 agent-visibility lockdown (supersedes the 2026-05-22
  // CLIENT-only policy): AI agents are visible only to SUPER_ADMIN and
  // users on the allowlist (`canViewAgents`). Everyone else doesn't get
  // the "Agents only" chip and the assignee picker hides agents. This
  // is UI defense-in-depth; the backend already filters agent data out
  // of every response for unauthorised viewers.
  //
  // On the client portal board (`clientView`) we go further and suppress
  // agent chrome for EVERYONE — including a previewing SUPER_ADMIN — so the
  // client surface never exposes the existence of AI agents.
  const viewer = useAuthStore((s) => s.user);
  const canSeeAgents = !clientView && (viewer?.role === 'SUPER_ADMIN' || viewer?.canViewAgents === true);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-faded mr-1">
        <Filter size={10} /> Filters
      </span>
      <Chip
        label="My issues"
        icon={<User size={11} />}
        active={filters.mine}
        count={counts?.mine}
        onClick={() => set({ mine: !filters.mine, assigneeId: null })}
        tone="brand"
      />
      <Chip
        label="Unassigned"
        icon={<UserX size={11} />}
        active={filters.unassigned}
        count={counts?.unassigned}
        onClick={() => set({ unassigned: !filters.unassigned, assigneeId: null })}
        tone="amber"
      />
      {projectId && (
        <AssigneeChip
          projectId={projectId}
          selected={filters.assigneeId ?? null}
          hideAgents={!canSeeAgents}
          onSelect={(userId) => set({
            assigneeId: userId,
            // Clearing mine/unassigned makes the chips align with the
            // picker — visually obvious which axis is active.
            mine: userId ? false : filters.mine,
            unassigned: userId ? false : filters.unassigned,
          })}
        />
      )}
      {/* "Agents only" chip — hidden for CLIENT users by policy.
          Shows tasks assigned to any AGENT (e.g. Manjari). Useful
          for triaging "what is the agent runtime working on?". */}
      {canSeeAgents && (
        <Chip
          label="Agents"
          icon={<Bot size={11} />}
          active={!!filters.agentsOnly}
          onClick={() => set({ agentsOnly: !filters.agentsOnly })}
          tone="brand"
        />
      )}
      <Chip
        label="P0"
        active={filters.p0}
        count={counts?.p0}
        onClick={() => set({ p0: !filters.p0 })}
        tone="rose"
        dotClassName="bg-rose-500"
      />
      <Chip
        label="P1"
        active={filters.p1}
        count={counts?.p1}
        onClick={() => set({ p1: !filters.p1 })}
        tone="orange"
        dotClassName="bg-orange-500"
      />
      <Chip
        label="Blocked"
        icon={<AlertOctagon size={10} strokeWidth={2.5} />}
        active={filters.blocked}
        count={counts?.blocked}
        onClick={() => set({ blocked: !filters.blocked })}
        tone="rose"
      />
      {active && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-gray-500 dark:text-obsidian-faded hover:text-gray-800 dark:hover:text-obsidian-fg transition-colors"
        >
          <X size={10} /> Clear
        </button>
      )}
    </div>
  );
}

const TONE_CHIP: Record<'brand' | 'amber' | 'rose' | 'orange', { active: string; idle: string }> = {
  brand:  { active: 'border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-200',
            idle:   'text-gray-600 dark:text-obsidian-muted hover:border-brand-300 dark:hover:border-brand-500/40 hover:text-brand-700 dark:hover:text-brand-300' },
  amber:  { active: 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300',
            idle:   'text-gray-600 dark:text-obsidian-muted hover:border-amber-300 dark:hover:border-amber-500/40 hover:text-amber-700 dark:hover:text-amber-300' },
  rose:   { active: 'border-rose-500/60 bg-rose-500/10 text-rose-700 dark:text-rose-300',
            idle:   'text-gray-600 dark:text-obsidian-muted hover:border-rose-300 dark:hover:border-rose-500/40 hover:text-rose-700 dark:hover:text-rose-300' },
  orange: { active: 'border-orange-500/60 bg-orange-500/10 text-orange-700 dark:text-orange-300',
            idle:   'text-gray-600 dark:text-obsidian-muted hover:border-orange-300 dark:hover:border-orange-500/40 hover:text-orange-700 dark:hover:text-orange-300' },
};

function Chip({
  label, icon, active, count, onClick, tone, dotClassName,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  count?: number;
  onClick: () => void;
  tone: 'brand' | 'amber' | 'rose' | 'orange';
  dotClassName?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
        active ? TONE_CHIP[tone].active : cn('border-gray-200 dark:border-obsidian-border', TONE_CHIP[tone].idle),
      )}
    >
      {dotClassName ? <span className={cn('w-1.5 h-1.5 rounded-full', dotClassName)} /> : icon}
      {label}
      {count != null && count > 0 && (
        <span className="text-[10px] tabular-nums opacity-60">{count}</span>
      )}
    </button>
  );
}

/* ─── Assignee picker chip ─────────────────────────────────────────────
 * Closed: shows "Assignee" (idle) or "Assignee: Name [×]" (active).
 * Open:   popover with a search input + member list. Click clears the
 *         selection; clicking the same name un-pins.
 *
 * Behavior:
 *   - Click outside to close (no focus trap; this is a transient picker).
 *   - Esc closes.
 *   - The selected user's chip carries a brand-tinted background so it
 *     visually matches the other "active filter" chips.
 *   - The trailing X clears the selection without reopening the popover.
 */
function AssigneeChip({
  projectId, selected, onSelect, hideAgents = false,
}: {
  projectId: string;
  selected: string | null;
  onSelect: (userId: string | null) => void;
  /**
   * When true (clients), agent users are filtered out of the dropdown.
   * The selected userId is also cleared if the currently-pinned user
   * happens to be an agent — prevents a stale agent selection
   * lingering when a client opens a board that an admin had filtered.
   */
  hideAgents?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const { data: members } = useProjectMembers(projectId);

  // Close on click-outside or Esc.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selectedMember = members?.find((m: any) => m.userId === selected);
  const active = !!selected;
  // Pankaj 2026-05-22 feedback: "Assignee" was too easy to miss next to
  // the existing boolean chips. Clearer label + the ▾ chevron makes the
  // affordance read as "click me, I open a list."
  const label = selectedMember
    ? selectedMember.user.name
    : 'Pick a teammate';

  const filtered = (members ?? [])
    .filter((m: any) => {
      // Hide agents from clients (Pankaj 2026-05-22 policy). The
      // member API doesn't always surface `userType` (it's a select
      // that varies by endpoint); we err on the side of caution —
      // if a member is missing userType AND hideAgents is true,
      // we still SHOW them (HUMAN-default assumption matches the
      // overwhelmingly common case).
      if (hideAgents && m.user?.userType === 'AGENT') return false;
      if (!search) return true;
      return m.user.name.toLowerCase().includes(search.toLowerCase());
    });

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-pressed={active}
        title={active ? `Filtering to ${selectedMember?.user.name ?? 'a teammate'} — click to change` : 'Filter to one teammate\'s tasks'}
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
          active
            ? 'border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-200'
            : cn(
                // Dashed border on the idle picker chip — visually distinct
                // from the boolean chips (My issues / Unassigned / P0 / P1 /
                // Blocked) so users discover "this one's different — it
                // opens a menu". Pankaj 2026-05-22 feedback: the picker was
                // too easy to miss next to the existing chips.
                'border-dashed border-gray-300 dark:border-obsidian-border',
                'text-gray-600 dark:text-obsidian-muted hover:border-brand-400 dark:hover:border-brand-500/50 hover:text-brand-700 dark:hover:text-brand-300 hover:bg-brand-50/40 dark:hover:bg-brand-500/[0.04]',
              ),
        )}
      >
        {active && selectedMember ? (
          <span className="inline-flex w-3.5 h-3.5 rounded-full bg-brand-100 dark:bg-brand-500/30 items-center justify-center text-[8px] font-semibold text-brand-700 dark:text-brand-200">
            {selectedMember.user.name.charAt(0).toUpperCase()}
          </span>
        ) : (
          <Users size={11} />
        )}
        <span className="max-w-[140px] truncate">{label}</span>
        {/* Idle state: small chevron so the affordance reads as a menu
            opener, not a boolean chip. Active state: clear-X. */}
        {active ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(null);
            }}
            aria-label="Clear assignee filter"
            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-brand-200/60 dark:hover:bg-brand-500/30 -mr-0.5"
          >
            <X size={9} />
          </button>
        ) : (
          <span aria-hidden className="text-gray-400 dark:text-obsidian-faded -mr-0.5 leading-none text-[9px]">
            ▾
          </span>
        )}
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Filter by assignee"
          className={cn(
            'absolute top-full left-0 mt-1.5 z-50 w-60',
            'rounded-lg border shadow-pop dark:shadow-pop-dark',
            'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
            'animate-fade-in-down',
          )}
        >
          <div className="p-2 border-b border-gray-100 dark:border-obsidian-border/50">
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-obsidian-faded" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter members…"
                autoFocus
                className={cn(
                  'w-full pl-6 pr-2 py-1 text-[11.5px] rounded-md outline-none',
                  'bg-gray-50 dark:bg-obsidian-bg',
                  'border border-gray-200 dark:border-obsidian-border',
                  'focus:border-brand-400 dark:focus:border-brand-500/60',
                  'text-gray-900 dark:text-obsidian-fg',
                  'placeholder:text-gray-400 dark:placeholder:text-obsidian-faded',
                )}
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-[11px] text-gray-400 dark:text-obsidian-faded text-center">
                No members match.
              </div>
            ) : (
              filtered.map((m: any) => {
                const isCurrent = selected === m.userId;
                return (
                  <button
                    key={m.userId}
                    type="button"
                    onClick={() => {
                      onSelect(isCurrent ? null : m.userId);
                      setOpen(false);
                      setSearch('');
                    }}
                    role="option"
                    aria-selected={isCurrent}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-left transition-colors',
                      'hover:bg-gray-50 dark:hover:bg-obsidian-raised/60',
                      isCurrent && 'bg-brand-50/60 dark:bg-brand-500/[0.08]',
                    )}
                  >
                    <span className="inline-flex w-5 h-5 rounded-full bg-brand-100 dark:bg-brand-500/20 items-center justify-center text-[10px] font-semibold text-brand-700 dark:text-brand-300 shrink-0">
                      {m.user.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-gray-800 dark:text-obsidian-fg">
                      {m.user.name}
                    </span>
                    <span className="text-[10px] text-gray-400 dark:text-obsidian-faded capitalize shrink-0">
                      {m.role?.toLowerCase().replace('_', ' ')}
                    </span>
                    {isCurrent && (
                      <Check size={12} className="text-brand-600 dark:text-brand-400 shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
