import { cn } from '@/lib/cn';
import { formatDate, isOverdue } from '@/lib/formatters';
import { PRIORITY_COLORS, PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_TYPE_LABELS, TASK_TYPE_COLORS } from '@/lib/constants';
import { getAcceptanceCriterionStatus } from '@/lib/acceptanceCriteria';
import { useAuthStore } from '@/stores/authStore';

/**
 * 2026-05-22 Pankaj policy: CLIENT viewers don't see the identity of
 * AGENT users (e.g. Manjari). Masking lives here, at the rendering
 * boundary, so every consumer of UnifiedTaskCard gets the policy
 * applied without having to remember it.
 *
 * Returns the assignee as the renderer should display it:
 *   - HUMAN assignee, any viewer  → pass-through (real name)
 *   - AGENT assignee, CLIENT viewer → masked to "Internal team"
 *   - AGENT assignee, non-client  → pass-through (full transparency
 *     for the team; agents are normal teammates internally)
 *
 * The `isAnonymous` flag lets the rendering code drop the avatar
 * initial in favor of a generic icon when masked.
 */
function displayAssignee(assignee: any, viewerRole: string | null): { name: string; isAnonymous: boolean } | null {
  if (!assignee?.name) return null;
  if (viewerRole === 'CLIENT' && assignee.userType === 'AGENT') {
    return { name: 'Internal team', isAnonymous: true };
  }
  return { name: assignee.name, isAnonymous: false };
}

interface UnifiedTaskCardProps {
  task: any;
  variant?: 'kanban' | 'list' | 'compact';
  /**
   * Within the `kanban` variant, choose a visual style:
   *   - `compact` (default): white card on neutral bg, info-dense
   *     padded card. Multi-line.
   *   - `sticky`:  column-tinted gradient, slight rotation, dot
   *     indicator — the "wall of sticky notes" look (refreshed
   *     2026-05-22 with a classic Post-it palette + heavier paper-
   *     on-cork shadow + folded-corner detail).
   *   - `dense`:   single-line row (~32px tall) — status dot, ID,
   *     title, priority pill, assignee avatar. Designed for
   *     dashboards-of-tasks where you want to see 25+ items per
   *     column without scrolling. Pankaj 2026-05-22 ask: "make
   *     compact actually compact".
   *
   * The board-level toggle picks per-user; ignored on `list` and `compact` variants.
   */
  cardStyle?: 'compact' | 'sticky' | 'dense';
  showProject?: boolean;
  isDone?: boolean;
  className?: string;
}

/**
 * Per-column tints for the sticky variant. Light/dark pairs match the rest of
 * the app's tokens — coral/peach for unstarted work, teal for active, slate
 * for review, mint for done. The gradients are subtle so the title text
 * stays readable on light AND dark mode without per-column text-color
 * gymnastics.
 */
/**
 * 2026-05-22 sticky-note refresh (Pankaj: "doesn't feel like a real sticky").
 *
 * Switched to a classic Post-it palette — saturated enough that each
 * column reads as a DIFFERENT COLOR of paper at a glance, not just a
 * subtle tint.
 *
 *   BACKLOG     → slate paper      (gray, "to be filed")
 *   TODO        → classic yellow   (canonical Post-it)
 *   IN_PROGRESS → sky blue         (active / in motion)
 *   IN_REVIEW   → coral peach      (attention / waiting)
 *   DONE        → mint green       (completed)
 *
 * Dark-mode opacity bumped from ~0.18 → ~0.32. The old values were so
 * faint the dark cards looked like uniformly-tinted dark panels. The
 * new values keep contrast for readable text while letting the color
 * actually read as paper.
 *
 * `paperShadow` adds an asymmetric drop shadow (down + slightly right)
 * so each sticky reads as "lifted off the board" — that's the
 * paper-on-cork cue your eye actually catches, more than the gradient.
 */
const STICKY_TINT: Record<string, { lightBg: string; darkBg: string; ring: string; dot: string }> = {
  BACKLOG: {
    lightBg: 'bg-gradient-to-br from-slate-200 via-slate-100 to-slate-50',
    darkBg:  'dark:bg-gradient-to-br dark:from-slate-400/[0.30] dark:via-slate-400/[0.22] dark:to-slate-500/[0.18]',
    ring:    'ring-1 ring-slate-400/40 dark:ring-slate-300/30',
    dot:     'bg-slate-500 shadow-[0_0_0_2px_rgba(255,255,255,0.75)] dark:shadow-[0_0_0_2px_rgba(20,20,20,0.7)]',
  },
  TODO: {
    // The canonical yellow Post-it.
    lightBg: 'bg-gradient-to-br from-yellow-200 via-yellow-100 to-amber-100',
    darkBg:  'dark:bg-gradient-to-br dark:from-yellow-400/[0.32] dark:via-yellow-300/[0.24] dark:to-amber-400/[0.20]',
    ring:    'ring-1 ring-yellow-400/50 dark:ring-yellow-300/30',
    dot:     'bg-yellow-500 shadow-[0_0_0_2px_rgba(255,255,255,0.75)] dark:shadow-[0_0_0_2px_rgba(20,20,20,0.7)]',
  },
  IN_PROGRESS: {
    lightBg: 'bg-gradient-to-br from-sky-200 via-sky-100 to-blue-100',
    darkBg:  'dark:bg-gradient-to-br dark:from-sky-400/[0.32] dark:via-sky-300/[0.24] dark:to-blue-400/[0.20]',
    ring:    'ring-1 ring-sky-400/50 dark:ring-sky-300/30',
    dot:     'bg-sky-500 shadow-[0_0_0_2px_rgba(255,255,255,0.75)] dark:shadow-[0_0_0_2px_rgba(20,20,20,0.7)]',
  },
  IN_REVIEW: {
    // Peach/coral — "warm and waiting on you."
    lightBg: 'bg-gradient-to-br from-orange-200 via-amber-100 to-orange-100',
    darkBg:  'dark:bg-gradient-to-br dark:from-orange-400/[0.32] dark:via-amber-300/[0.24] dark:to-orange-400/[0.20]',
    ring:    'ring-1 ring-orange-400/50 dark:ring-orange-300/30',
    dot:     'bg-amber-500 shadow-[0_0_0_2px_rgba(255,255,255,0.75)] dark:shadow-[0_0_0_2px_rgba(20,20,20,0.7)]',
  },
  DONE: {
    lightBg: 'bg-gradient-to-br from-emerald-200 via-green-100 to-lime-100',
    darkBg:  'dark:bg-gradient-to-br dark:from-emerald-400/[0.30] dark:via-green-300/[0.22] dark:to-lime-400/[0.18]',
    ring:    'ring-1 ring-emerald-400/50 dark:ring-emerald-300/30',
    dot:     'bg-emerald-500 shadow-[0_0_0_2px_rgba(255,255,255,0.75)] dark:shadow-[0_0_0_2px_rgba(20,20,20,0.7)]',
  },
};

/**
 * Asymmetric drop shadow shared by every sticky. Heavier than the
 * default `shadow-lift` and offset down-right so the card reads as
 * paper sitting on a board, not a UI panel. Pulled into a single
 * constant so the hover state can grow it consistently.
 */
const STICKY_PAPER_SHADOW =
  'shadow-[0_2px_3px_-1px_rgba(15,23,42,0.12),0_6px_12px_-3px_rgba(15,23,42,0.14),0_18px_28px_-12px_rgba(15,23,42,0.18)]';
const STICKY_PAPER_SHADOW_HOVER =
  'hover:shadow-[0_4px_6px_-1px_rgba(15,23,42,0.16),0_12px_22px_-5px_rgba(15,23,42,0.20),0_28px_44px_-16px_rgba(15,23,42,0.26)]';
const STICKY_PAPER_SHADOW_DARK =
  'dark:shadow-[0_2px_3px_-1px_rgba(0,0,0,0.45),0_8px_18px_-4px_rgba(0,0,0,0.55),0_20px_36px_-12px_rgba(0,0,0,0.65)]';
const STICKY_PAPER_SHADOW_HOVER_DARK =
  'dark:hover:shadow-[0_6px_8px_-1px_rgba(0,0,0,0.55),0_16px_28px_-6px_rgba(0,0,0,0.62),0_32px_50px_-16px_rgba(0,0,0,0.75)]';

/**
 * Deterministic small rotation per task. Same input → same output, so cards
 * don't visually re-shuffle on every re-render. Range: -1.4° to +1.4°.
 * Hash on the task id (uuid → first 4 hex chars are random enough for the
 * spread we want).
 */
function stickyRotation(taskId: string | undefined): string {
  if (!taskId) return '0deg';
  // Sum the first 4 hex chars to get a number in [0, 60].
  const slice = taskId.replace(/-/g, '').slice(0, 4);
  let n = 0;
  for (const ch of slice) n += parseInt(ch, 16) || 0;
  const angle = ((n % 29) - 14) / 10; // -1.4 .. +1.4
  return `${angle}deg`;
}

// Status → tone for the small status pill in the list variant. Brand violet for
// active work, amber for review, emerald for done — matches the Kanban column dots.
const STATUS_PILL: Record<string, string> = {
  TODO:        'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  IN_PROGRESS: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
  IN_REVIEW:   'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  DONE:        'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  BACKLOG:     'bg-gray-100 text-gray-600 dark:bg-obsidian-raised dark:text-obsidian-muted',
};

export function UnifiedTaskCard({ task, variant = 'kanban', cardStyle = 'compact', showProject = true, isDone, className }: UnifiedTaskCardProps) {
  const priorityColor = PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS] || '#6b7280';
  const typeColor = TASK_TYPE_COLORS[task.taskType as keyof typeof TASK_TYPE_COLORS] || '#6b7280';
  const projectSlug = task.project?.slug || '';
  const taskId = task.taskNumber > 0 ? `${projectSlug.toUpperCase()}-${task.taskNumber}` : null;
  const done = isDone || task.status === 'DONE';
  // 2026-05-22 Pankaj policy: mask agent identities for CLIENT viewers.
  // `viewerRole` is read once at the top; the helper handles the
  // "Internal team" substitution. Every assignee-rendering branch
  // below uses `displayedAssignee` instead of `task.assignee`.
  const viewerRole = useAuthStore((s) => s.user?.role ?? null);
  const displayedAssignee = displayAssignee(task.assignee, viewerRole);

  const subtasks = task.subtasks || [];
  const subtasksDone = subtasks.filter((s: any) => s.done).length;
  const subtaskTotal = subtasks.length;

  // Acceptance criteria — surfaced on the card so users see the Done-gate
  // state BEFORE they try to drag. Without this, dragging to Done on a
  // task with unchecked AC silently fails (the toast tells you AFTER
  // the fact). Logic lives in `lib/acceptanceCriteria.ts` so it can be
  // unit-tested independently from this 600-line component, and reused
  // by any future surface that wants to render the same state.
  const acStatus = getAcceptanceCriterionStatus(task);
  const { done: acDone, total: acTotal, allChecked: acAllChecked, blocksDoneFromHere: acGateBlocksDone } = acStatus;

  // ─── Compact: single-line row, ID + title + priority ───
  if (variant === 'compact') {
    return (
      <div className={cn('flex items-center gap-3 py-2', className)}>
        {taskId && <span className="text-[10px] font-mono text-gray-400 dark:text-obsidian-faded w-14 shrink-0">{taskId}</span>}
        <span className={cn(
          'text-sm flex-1 truncate',
          done ? 'text-gray-400 dark:text-obsidian-faded line-through' : 'text-gray-900 dark:text-obsidian-fg',
        )}>{task.title}</span>
        <span className="text-[10px] font-semibold rounded px-1.5 py-0.5" style={{ backgroundColor: priorityColor + '15', color: priorityColor }}>
          {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
        </span>
      </div>
    );
  }

  // ─── List: dense row used in tables / queues ───
  if (variant === 'list') {
    return (
      <div className={cn(
        'flex items-center gap-3 px-4 py-3 transition-colors',
        'hover:bg-gray-50 dark:hover:bg-obsidian-raised',
        task.isBlocked && 'bg-rose-50/60 dark:bg-rose-500/[0.06]',
        className,
      )}>
        {taskId && <span className="text-[10px] font-mono text-gray-400 dark:text-obsidian-faded w-16 shrink-0">{taskId}</span>}
        <span className="w-6 h-5 text-[9px] font-bold rounded flex items-center justify-center shrink-0" style={{ backgroundColor: priorityColor + '15', color: priorityColor }}>
          {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
        </span>
        {task.taskType && task.taskType !== 'FEATURE' && (
          <span className="text-[9px] font-semibold rounded px-1 py-0.5 shrink-0" style={{ backgroundColor: typeColor + '15', color: typeColor }}>
            {TASK_TYPE_LABELS[task.taskType as keyof typeof TASK_TYPE_LABELS]}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-sm font-medium truncate',
            done ? 'text-gray-400 dark:text-obsidian-faded line-through' : 'text-gray-900 dark:text-obsidian-fg',
          )}>{task.title}</p>
          {showProject && <p className="text-[10px] text-gray-400 dark:text-obsidian-faded">{task.project?.name}</p>}
        </div>
        {task.storyPoints && (
          <span className="text-[10px] font-bold text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-500/15 rounded-full px-1.5 py-0.5 shrink-0">
            {task.storyPoints}pt
          </span>
        )}
        {task.isBlocked && (
          <span className="text-[10px] font-semibold bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 rounded px-1.5 py-0.5 shrink-0">
            Blocked
          </span>
        )}
        <span className={cn('text-[10px] font-medium rounded-full px-2 py-0.5 shrink-0', STATUS_PILL[task.status] || STATUS_PILL.BACKLOG)}>
          {TASK_STATUS_LABELS[task.status as keyof typeof TASK_STATUS_LABELS]}
        </span>
      </div>
    );
  }

  // ─── Dense: single-line row (Pankaj 2026-05-22) ───
  //
  // ~36px tall, one row per task. Status dot · ID · title · assignee
  // name + avatar · priority pill. Designed for boards where you want
  // 25+ tasks visible without scrolling.
  //
  // 2026-05-22 polish (Pankaj follow-up): title bumped to text-[13px]
  // and the assignee NAME is shown next to the avatar (not just the
  // initial letter) so you can see WHO has the task at a glance, not
  // just the color of an avatar circle. The whole row reads:
  //
  //   ● FURIX-AI-25  vector.dev C3 development         Pankaj Kumar ⓟ  [P0]
  //
  // On narrow widths the name truncates first; the title still wraps
  // visible because it's the flex-1 element.
  if (cardStyle === 'dense' && variant === 'kanban') {
    const denseTint = STICKY_TINT[task.status] ?? STICKY_TINT.BACKLOG;
    // Pankaj 2026-05-22 bug: dense rows were overflowing the column on
    // narrow widths (min-w-[176px]). The full slug-prefixed task ID +
    // assignee name were too wide together → row clipped to the right
    // of the column → cards looked truncated on the LEFT edge of the
    // visible area (e.g. "FURIX-AI-1" displayed as "N-1").
    //
    // Fix: use a SHORT id format in dense mode (#25 instead of
    // FURIX-AI-25), make assignee name responsive (hidden on narrow
    // columns, visible on wide ones), and add `overflow-hidden` to
    // the row container so any residual overflow clips cleanly
    // INSIDE the card rather than leaking out across columns.
    const shortId = typeof task.taskNumber === 'number' && task.taskNumber > 0
      ? `#${task.taskNumber}`
      : null;
    return (
      <div
        className={cn(
          'group/dense relative flex items-center gap-2 px-2 py-1.5 min-w-0 overflow-hidden',
          'rounded-md border transition-colors',
          'bg-white dark:bg-obsidian-panel',
          task.isBlocked
            ? 'border-rose-200 dark:border-rose-500/30 bg-rose-50/40 dark:bg-rose-500/[0.04]'
            : 'border-gray-200 dark:border-obsidian-border',
          'hover:border-brand-300 dark:hover:border-brand-500/40',
          'hover:bg-gray-50/80 dark:hover:bg-obsidian-raised/60',
          className,
        )}
        title={taskId ? `${taskId} — ${task.title}` : task.title}
      >
        {/* Status dot — the one consistent left-anchor */}
        <span className={cn('w-2 h-2 rounded-full shrink-0', denseTint.dot)} aria-hidden />

        {/* Short ID: #25 instead of FURIX-AI-25. The full id is on the
            row tooltip if anyone needs it. Tiny + tabular-nums so
            column alignment stays readable across rows. */}
        {shortId && (
          <span className="text-[10.5px] font-mono text-gray-400 dark:text-obsidian-faded shrink-0 tabular-nums">
            {shortId}
          </span>
        )}

        {/* Title — flex-1, truncated. Primary content of the row. */}
        <span
          className={cn(
            'flex-1 min-w-0 truncate text-[13px] font-medium leading-tight',
            done
              ? 'text-gray-400 dark:text-obsidian-faded line-through'
              : 'text-gray-800 dark:text-obsidian-fg',
          )}
        >
          {task.title}
        </span>

        {/* AC dot — single-pixel signal that the Done-gate would block.
            Dense view is too tight for a full "AC 1/3" chip, so we just
            show a small dot when the gate is currently blocking + a
            tooltip with the count. Quiet for tasks with no AC or all
            ACs checked. Green if everything is checked (positive signal
            that this card is ready to ship). */}
        {acTotal > 0 && (
          <span
            className={cn(
              'shrink-0 w-1.5 h-1.5 rounded-full',
              acAllChecked
                ? 'bg-emerald-500'
                : acGateBlocksDone
                ? 'bg-amber-500'
                : 'bg-gray-300 dark:bg-obsidian-faded',
            )}
            title={
              acAllChecked
                ? `All ${acTotal} acceptance criteria checked — ready for Done`
                : `${acDone}/${acTotal} acceptance criteria checked. ${acTotal - acDone} still ${acTotal - acDone === 1 ? 'needs' : 'need'} ticking before this can move to Done.`
            }
            aria-label={`Acceptance criteria ${acDone} of ${acTotal} complete`}
          />
        )}

        {/* Assignee — avatar always shows; name appears only when the
            column has room (`@xs/dense:` query). Below ~260px column
            width the name hides but the avatar + tooltip preserve
            "who". Agent identity masked for client viewers. */}
        {displayedAssignee ? (
          <span className="flex items-center gap-1 shrink-0 min-w-0" title={displayedAssignee.name}>
            {/* Name hidden in dense mode — the avatar + tooltip on the
                row preserve "who" without eating column width. Avoiding
                an explicit container-query here because the project
                doesn't have @tailwindcss/container-queries configured. */}
            <span
              className={cn(
                'inline-flex w-4.5 h-4.5 rounded-full items-center justify-center text-[9.5px] font-semibold text-white shrink-0',
                displayedAssignee.isAnonymous
                  ? 'bg-gradient-to-br from-slate-400 to-slate-600'
                  : 'bg-gradient-to-br from-brand-400 to-brand-600',
              )}
              style={{ width: '18px', height: '18px' }}
            >
              {displayedAssignee.isAnonymous ? '∗' : displayedAssignee.name.charAt(0).toUpperCase()}
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-1 shrink-0" title="Unassigned">
            <span
              className="inline-flex rounded-full border border-dashed border-gray-300 dark:border-obsidian-border items-center justify-center text-[9.5px] text-gray-400 dark:text-obsidian-faded shrink-0"
              style={{ width: '18px', height: '18px' }}
            >
              ?
            </span>
          </span>
        )}

        {/* Blocked + priority — trailing badges */}
        {task.isBlocked && (
          <span
            className="text-[9px] font-bold rounded px-1 py-0 bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 shrink-0"
            title="Blocked"
          >
            !
          </span>
        )}
        <span
          className="text-[9.5px] font-bold rounded px-1 py-0.5 shrink-0 tabular-nums"
          style={{ backgroundColor: priorityColor + '15', color: priorityColor }}
          title={`Priority ${PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}`}
        >
          {task.priority}
        </span>
      </div>
    );
  }

  // ─── Default: Kanban variant ───
  // Sticky vs compact branch off here. Same content rendered inside; just a
  // different shell + a corner indicator dot in sticky.
  const isSticky = cardStyle === 'sticky';
  const tint = isSticky ? (STICKY_TINT[task.status] ?? STICKY_TINT.BACKLOG) : null;
  const stickyStyle = isSticky
    ? { transform: `rotate(${stickyRotation(task.id)})` }
    : undefined;

  return (
    <div
      className={cn(
        // 2026-05-22 sticky tightening (Pankaj): the sticky was carrying
        // p-3 (12px each side) which made each card noticeably bulkier
        // than compact. New treatment: px-3 py-2.5 keeps the horizontal
        // breathing room (titles read better with space on the sides)
        // but trims 2-3px of vertical chrome. Combined with the tighter
        // internal margins below this knocks ~10px off each sticky.
        isSticky ? 'px-3 py-2.5 relative' : 'px-2.5 py-2 relative',
        isSticky
          ? cn(
              'rounded-lg',
              tint!.lightBg,
              tint!.darkBg,
              tint!.ring,
              // 2026-05-22 sticky refresh: heavier, asymmetric paper-on-cork
              // shadow + larger hover lift. The new shadows are inline
              // arbitrary values (Tailwind utilities can't express the
              // offset + spread combo we need) — shared as constants at
              // the top of the file so every sticky uses the same recipe.
              STICKY_PAPER_SHADOW,
              STICKY_PAPER_SHADOW_DARK,
              STICKY_PAPER_SHADOW_HOVER,
              STICKY_PAPER_SHADOW_HOVER_DARK,
              'transition-[box-shadow] duration-200',
              // Note: we DON'T add a hover translate here. The base
              // sticky already carries an inline `transform: rotate(...)`
              // and stacking Tailwind's translate utilities would
              // overwrite it (loses the per-task tilt on hover). The
              // larger hover shadow already creates the "press up"
              // illusion the eye reads.
              task.isBlocked && 'ring-2 ring-rose-400/60 dark:ring-rose-400/40',
            )
          : cn(
              'rounded-xl',
              'bg-white border dark:bg-obsidian-panel',
              'shadow-soft dark:shadow-soft-dark',
              task.isBlocked
                ? 'border-rose-200 dark:border-rose-500/30 bg-rose-50/40 dark:bg-rose-500/[0.04]'
                : 'border-gray-200 dark:border-obsidian-border',
            ),
        className,
      )}
      style={stickyStyle}
    >
      {/* Sticky-only: small dot indicator in the top-left, like the reference
          image. Color tracks the column tone — visual scan tells you what
          column a card belongs to even when it's mid-drag. */}
      {isSticky && (
        <>
          <span
            className={cn('absolute -top-1 -left-1 w-2 h-2 rounded-full', tint!.dot)}
            aria-hidden
          />
          {/* Folded corner — Pankaj 2026-05-22: "the fold in the corner
              is less". Two-layer fold so it reads as a peeled-up edge,
              not just a darker triangle:
                1. Underneath:  a slightly darker triangle in the
                   bottom-right (the back side of the lifted paper
                   visible from below). Same column tone but slightly
                   muted.
                2. On top:      the original sticky color, clipped to
                   exclude that bottom-right triangle. A subtle inset
                   shadow along the diagonal cut completes the
                   "casting a shadow on the page" illusion.
              Larger now (16px vs the old 12px) so the fold reads at
              a glance, not just on close inspection. */}
          <span
            aria-hidden
            className={cn(
              'absolute bottom-0 right-0 w-4 h-4 rounded-br-lg pointer-events-none overflow-hidden',
            )}
          >
            {/* Layer 1: the "back of the page" — a darker patch
                showing through where the corner has lifted. */}
            <span
              className={cn(
                'absolute inset-0',
                'bg-gradient-to-br from-black/25 via-black/15 to-black/30',
                'dark:from-black/55 dark:via-black/45 dark:to-black/60',
              )}
              style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}
            />
            {/* Layer 2: a soft highlight on the diagonal edge where
                the paper is lifting — catches "the light." */}
            <span
              className={cn(
                'absolute inset-0',
                'bg-gradient-to-br from-transparent via-white/20 to-transparent',
                'dark:via-white/15',
              )}
              style={{ clipPath: 'polygon(0 100%, 100% 0, 100% 6%, 6% 100%)' }}
            />
          </span>
        </>
      )}

      {/* Task ID + Epic — slightly tighter spacing for sticky now too. */}
      {(taskId || task.epic) && (
        <div className={cn('flex items-center gap-2 min-w-0', isSticky ? 'mb-1' : 'mb-1')}>
          {taskId && <span className="text-[10px] font-mono text-gray-400 dark:text-obsidian-faded shrink-0">{taskId}</span>}
          {task.epic && (
            <span className="text-[10px] font-medium rounded px-1.5 py-0.5 truncate" style={{ backgroundColor: task.epic.color + '20', color: task.epic.color }}>
              {task.epic.title}
            </span>
          )}
        </div>
      )}

      {/* Title — stickies get a slightly bolder + larger title so the
          card content reads like a hand-written note (the eye is drawn
          to the title first, then the metadata). Compact stays at
          text-[13px] / font-medium since it leans on the badge row to
          carry information density. */}
      <h4 className={cn(
        'leading-snug line-clamp-2',
        isSticky
          ? 'text-[13.5px] font-semibold mb-1.5'
          : 'text-[13px] font-medium mb-1.5',
        done ? 'text-gray-400 dark:text-obsidian-faded line-through' : 'text-gray-900 dark:text-obsidian-fg',
      )}>
        {task.title}
      </h4>

      {/* Badges row — tighter gap + margin on sticky so the card
          doesn't grow vertically just because there are 3 badges. */}
      <div className={cn('flex items-center flex-wrap', isSticky ? 'gap-1 mb-1.5' : 'gap-1.5 mb-1.5')}>
        <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded" style={{ backgroundColor: priorityColor + '15', color: priorityColor }}>
          {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
        </span>
        {task.taskType && task.taskType !== 'FEATURE' && (
          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded" style={{ backgroundColor: typeColor + '15', color: typeColor }}>
            {TASK_TYPE_LABELS[task.taskType as keyof typeof TASK_TYPE_LABELS]}
          </span>
        )}
        {/* Client-request marker — surfaces the provenance of incoming work so
            the triage team can read it at a glance. Visible to everyone, on
            every variant of the card. */}
        {task.clientRequested && (
          <span
            className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300"
            title="Submitted by the client — needs triage"
          >
            Client request
          </span>
        )}
        {/* Reviewer marker — explicit "→ name" arrow makes the handoff
            visible without the user having to open the card. Only shown
            while the task is IN_REVIEW; once a decision lands the reviewer
            field clears server-side. */}
        {task.status === 'IN_REVIEW' && task.reviewer && (
          <span
            className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 inline-flex items-center gap-0.5"
            title={`Awaiting review from ${task.reviewer.name}${task.reviewer.role === 'CLIENT' ? ' (client)' : ''}`}
          >
            <span aria-hidden>→</span>
            <span className="truncate max-w-[8rem]">{task.reviewer.name}</span>
          </span>
        )}
        {task.storyPoints && (
          <span className="px-1.5 py-0.5 text-[10px] font-bold text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-500/15 rounded">
            {task.storyPoints}pt
          </span>
        )}
        {task.isBlocked && (
          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300">
            Blocked
          </span>
        )}
        {task.dueDate && (
          <span className={cn(
            'text-[10px]',
            isOverdue(task.dueDate) && !done
              ? 'text-rose-600 dark:text-rose-400 font-medium'
              : 'text-gray-400 dark:text-obsidian-faded',
          )}>
            {formatDate(task.dueDate)}
          </span>
        )}
      </div>

      {/* Subtask progress bar */}
      {subtaskTotal > 0 && (
        <div className="mb-2">
          <div className="w-full bg-gray-100 dark:bg-obsidian-raised rounded-full h-1 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all duration-500"
              style={{ width: `${(subtasksDone / subtaskTotal) * 100}%` }}
            />
          </div>
          <span className="text-[9px] text-gray-400 dark:text-obsidian-faded mt-1 inline-block tabular-nums">
            {subtasksDone}/{subtaskTotal} subtasks
          </span>
        </div>
      )}

      {/* Acceptance-criteria badge. Surfaces the Done-gate state so the
          user knows BEFORE they drag whether moving to Done will succeed.
          Tone shifts to amber when the gate would block (task in Review
          or In Progress + at least one AC unchecked). Once all AC are
          ticked, the badge turns green — a positive "ready to ship"
          signal mirroring the Sigs N/N chip on the compliance page. */}
      {acTotal > 0 && (
        <div className="mb-2 flex items-center gap-1.5">
          <span
            className={cn(
              'inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-medium tabular-nums',
              acAllChecked
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                : acGateBlocksDone
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                : 'bg-gray-100 text-gray-600 dark:bg-obsidian-raised dark:text-obsidian-muted',
            )}
            title={
              acAllChecked
                ? 'All acceptance criteria checked — ready for Done'
                : `${acTotal - acDone} acceptance ${acTotal - acDone === 1 ? 'criterion is' : 'criteria are'} still unchecked. Open the task to tick them before moving to Done.`
            }
          >
            AC {acDone}/{acTotal}
            {acAllChecked && ' ✓'}
          </span>
        </div>
      )}

      {/* Footer: assignee + sprint. Agent identity masked for clients. */}
      {(displayedAssignee || task.sprint) && (
        <div className="flex items-center justify-between mt-1">
          {displayedAssignee ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <div className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0',
                displayedAssignee.isAnonymous
                  ? 'bg-gradient-to-br from-slate-400 to-slate-600'
                  : 'bg-gradient-to-br from-brand-400 to-brand-600',
              )}>
                {displayedAssignee.isAnonymous ? '∗' : displayedAssignee.name.charAt(0).toUpperCase()}
              </div>
              <span className="text-[10px] text-gray-500 dark:text-obsidian-muted truncate">{displayedAssignee.name}</span>
            </div>
          ) : <span />}
          {task.sprint && (
            <span className="text-[9px] text-gray-400 dark:text-obsidian-faded shrink-0">Sprint {task.sprint.number}</span>
          )}
        </div>
      )}
    </div>
  );
}
