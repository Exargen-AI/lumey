import { useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Sunrise, CheckSquare, MoreHorizontal,
  LayoutGrid, KanbanSquare, FileText, GanttChart, Package, Lightbulb,
  BarChart3, ShieldCheck, Activity, Boxes, FolderKanban, Inbox, Sun,
  Users, ClipboardCheck, UsersRound, BookOpen, CalendarClock,
  Shield, Settings, CalendarRange,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { UserRole } from '@exargen/shared';
import { MobileMoreSheet, type MoreSheetItem } from './MobileMoreSheet';
import { cn } from '@/lib/cn';

/**
 * Mobile bottom navigation. Fixed to the viewport bottom on screens
 * below the `lg:` breakpoint, hidden above (the desktop sidebar takes
 * over). Renders exactly four slots: three primary destinations
 * (role-tuned) + a More button that opens a bottom sheet with the
 * rest of the nav surface.
 *
 * Slot rationale per role:
 *   - INTERNAL (admin/PM/engineer): Dashboard / Today / My Tasks. These
 *     are the daily-driver screens; every role's existing sidebar lists
 *     them at the top.
 *   - CLIENT (in a project): Overview / Board / Documents. The three
 *     things a stakeholder reaches for from a phone — status check,
 *     submitting bugs from the board, and pulling specs/designs from
 *     docs. The remaining seven sections live behind More.
 *   - CLIENT (off project, multi-project landing): the bottom nav
 *     hides entirely. The page is a one-screen project chooser; a
 *     persistent bottom bar would steal real estate for no gain.
 *
 * Active-state matching uses NavLink's `end` strictly for the leaf
 * routes (Dashboard, Today, etc.) so deep child URLs don't light up
 * the wrong tab. The Overview slot uses end-match too because every
 * other client section sits at a sub-path.
 */
export function MobileBottomNav() {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const darkMode = useUIStore((s) => s.darkMode);
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  // The dark-mode flag is read here only so the hook stays subscribed —
  // the bar's appearance picks up `dark:` Tailwind utilities through
  // the html-level class flip. Without this subscription, the bar
  // wouldn't re-render when the user toggles dark mode somewhere else
  // (rare, but possible). Read-only access; no side effect.
  void darkMode;

  // Build the slot list + More-sheet items based on who's looking.
  const { primary, more, hidden } = useMemo(
    () => buildNav(user?.role, location.pathname, permissions),
    [user?.role, location.pathname, permissions],
  );

  if (!user || hidden) return null;

  return (
    <>
      <nav
        aria-label="Primary"
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 lg:hidden',
          'bg-white/95 dark:bg-obsidian-panel/95 backdrop-blur',
          'border-t border-gray-200 dark:border-obsidian-border',
          // Safe-area-inset for iPhones with a home indicator. The
          // h-14 slot accounts for the bar; this adds the indicator
          // clearance below it.
          'pb-[env(safe-area-inset-bottom)]',
        )}
      >
        <ul className="flex items-stretch justify-around h-14">
          {primary.map((item) => (
            <li key={item.path} className="flex-1">
              <NavLink
                to={item.path}
                end={item.exact ?? false}
                className={({ isActive }) => cn(
                  'flex flex-col items-center justify-center gap-0.5 h-full min-h-[44px]',
                  'text-[10px] font-medium transition-colors',
                  isActive
                    ? 'text-brand-600 dark:text-brand-300'
                    : 'text-gray-500 dark:text-obsidian-muted hover:text-gray-800 dark:hover:text-obsidian-fg',
                )}
                aria-label={item.label}
              >
                {({ isActive }) => (
                  <>
                    {/* Active-state hint: brand-tinted background pill
                        behind the icon. Subtle but readable on both light
                        and dark canvases. */}
                    <span className={cn(
                      'inline-flex items-center justify-center w-9 h-7 rounded-md transition-colors',
                      isActive
                        ? 'bg-brand-50 dark:bg-brand-500/15'
                        : 'bg-transparent',
                    )}>
                      <item.Icon size={18} aria-hidden />
                    </span>
                    <span className="truncate max-w-full px-1">{item.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}

          {/* More slot — opens the bottom sheet. */}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={cn(
                'w-full h-full flex flex-col items-center justify-center gap-0.5 min-h-[44px]',
                'text-[10px] font-medium transition-colors',
                moreOpen
                  ? 'text-brand-600 dark:text-brand-300'
                  : 'text-gray-500 dark:text-obsidian-muted hover:text-gray-800 dark:hover:text-obsidian-fg',
              )}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              aria-label="More"
            >
              <span className={cn(
                'inline-flex items-center justify-center w-9 h-7 rounded-md transition-colors',
                moreOpen ? 'bg-brand-50 dark:bg-brand-500/15' : 'bg-transparent',
              )}>
                <MoreHorizontal size={18} aria-hidden />
              </span>
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>

      <MobileMoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        items={more}
      />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Navigation source-of-truth for the mobile bottom bar.

   For internal roles, the same 3 primaries apply across admin / PM /
   engineer — only the route prefix changes (e.g. `/dashboard` vs
   `/pm/dashboard` vs `/eng/dashboard`). For clients, the primaries
   change between "off-project" (rare) and "in-project" (common).
   ───────────────────────────────────────────────────────────────────── */

interface PrimaryItem {
  label: string;
  path: string;
  /** Lucide icon component. Typed `any` because lucide-react's icon type
   *  (ForwardRefExoticComponent<LucideProps>) is narrower than a plain
   *  ComponentType<{size, className}> — assigning a lucide icon to the
   *  narrow shape fails strict TS. Mirrors the admin Sidebar pattern. */
  Icon: React.ComponentType<any>;
  exact?: boolean;
}

interface NavBuild {
  primary: PrimaryItem[];
  more: MoreSheetItem[];
  /** When true, skip rendering the bottom bar entirely. */
  hidden: boolean;
}

function buildNav(
  role: string | undefined,
  pathname: string,
  permissions: string[],
): NavBuild {
  if (!role) return { primary: [], more: [], hidden: true };

  // ── CLIENT ──────────────────────────────────────────────────────
  // Clients always live in the `/client/...` portal. (Elevated visibility
  // is granted per-project now and surfaces inside the portal, so there's
  // no longer a routing flip that sends any client to the internal team UI.)
  if (role === UserRole.CLIENT) {
    const projectMatch = pathname.match(/^\/client\/projects\/([^/]+)/);
    if (!projectMatch) {
      // Off-project — multi-project landing. Don't render the bar at
      // all; the page is a one-screen chooser and a persistent bar
      // would only steal real estate.
      return { primary: [], more: [], hidden: true };
    }
    const projectId = projectMatch[1];
    const base = `/client/projects/${projectId}`;
    return {
      primary: [
        { label: 'Overview',  path: base,                Icon: LayoutGrid,    exact: true },
        { label: 'Board',     path: `${base}/board`,     Icon: KanbanSquare },
        { label: 'Documents', path: `${base}/documents`, Icon: FileText },
      ],
      more: [
        // Remaining sections, in the same order the desktop sidebar
        // shows them. "All projects" lives at the top so a multi-
        // project client can switch without breadcrumb hunting.
        { label: 'All projects',    path: '/client/dashboard',       Icon: FolderKanban,    group: 'Switch' },
        { label: 'Products',        path: `${base}/products`,        Icon: Boxes,           group: 'This project' },
        { label: 'Sprints',         path: `${base}/sprints`,         Icon: GanttChart },
        { label: 'Timeline',        path: `${base}/timeline`,        Icon: CalendarRange },
        { label: 'Deliverables',    path: `${base}/deliverables`,    Icon: Package },
        { label: 'Decisions',       path: `${base}/decisions`,       Icon: Lightbulb },
        { label: 'Insights',        path: `${base}/insights`,        Icon: BarChart3 },
        { label: 'Compliance',      path: `${base}/compliance`,      Icon: ShieldCheck },
        // URL stays `/activity` (no broken bookmarks); label flips to
        // "Today" to match the sidebar after the Today + Activity merge.
        { label: 'Today',           path: `${base}/activity`,        Icon: Activity },
      ],
      hidden: false,
    };
  }

  // ── INTERNAL (admin / PM / engineer / super_admin) ──────────────
  // Per-role default landing route + scoped /my-tasks path. We rely on
  // the existing desktop sidebar's route definitions so any deep-link
  // tweak there (e.g. /eng/my-tasks vs /my-tasks) stays in sync via
  // one place.
  const dashboardPath =
    role === UserRole.PRODUCT_MANAGER ? '/pm/dashboard'
    : role === UserRole.ENGINEER       ? '/eng/dashboard'
    : '/dashboard';
  const myTasksPath =
    role === UserRole.PRODUCT_MANAGER ? '/pm/my-tasks'
    : role === UserRole.ENGINEER       ? '/eng/my-tasks'
    : '/my-tasks';

  const primary: PrimaryItem[] = [
    { label: 'Home',     path: dashboardPath, Icon: LayoutDashboard, exact: true },
    { label: 'Today',    path: '/today',      Icon: Sunrise },
    { label: 'My Tasks', path: myTasksPath,   Icon: CheckSquare },
  ];

  // Everything else from the role's sidebar nav lands in More. We don't
  // re-implement the permission filter here — pass `permissions` and
  // strip items the user can't actually reach. Keeping the order from
  // the desktop sidebar so muscle-memory transfers across devices.
  const hasAny = (...keys: string[]) => keys.some((k) => permissions.includes(k));
  const moreItems: MoreSheetItem[] = [];

  // Role-specific "more" content. Hand-curated rather than scraping
  // the constants list because the bottom-sheet groupings are
  // tighter than the desktop's flat list.
  if (role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN || role === UserRole.TESTING) {
    if (hasAny('analytics.view_portfolio')) {
      moreItems.push({ label: 'Triage',    path: '/inbox',    Icon: Inbox,   group: 'Workspace' });
    }
    moreItems.push({ label: 'Projects', path: '/projects',   Icon: FolderKanban, group: 'Workspace' });
    if (hasAny('analytics.view_team')) {
      moreItems.push({ label: 'Standup',  path: '/standup',  Icon: Sun });
    }
    // "Activity" entry dropped — Today (primary slot) is the
    // canonical "what's happening" surface after the consolidation.
    if (hasAny('project.view_all', 'project.view_assigned')) {
      moreItems.push({ label: 'Timeline', path: '/timeline', Icon: GanttChart });
    }
    if (hasAny('analytics.view_team')) {
      moreItems.push({ label: 'Team',       path: '/team',      Icon: Users });
      moreItems.push({ label: 'Approvals',  path: '/approvals', Icon: ClipboardCheck });
    }
    if (hasAny('analytics.view_portfolio', 'analytics.view_project', 'analytics.view_team')) {
      moreItems.push({ label: 'Analytics', path: '/analytics', Icon: BarChart3 });
    }
    if (hasAny('user.view')) {
      moreItems.push({ label: 'People', path: '/users', Icon: UsersRound });
    }
    moreItems.push({ label: 'Compliance',        path: '/compliance/courses',     Icon: ShieldCheck,    group: 'Compliance' });
    moreItems.push({ label: 'Onboarding Status', path: '/compliance/enrollments', Icon: ClipboardCheck });
    moreItems.push({ label: 'Content', path: '/cms', Icon: BookOpen, group: 'Content' });
    moreItems.push({ label: 'My Time', path: '/my-time', Icon: CalendarClock, group: 'Personal' });
    if (role === UserRole.SUPER_ADMIN || role === UserRole.TESTING) {
      if (hasAny('rbac.manage')) moreItems.push({ label: 'Access', path: '/rbac', Icon: Shield, group: 'Founder' });
      moreItems.push({ label: 'System', path: '/settings', Icon: Settings, group: 'Founder' });
    }
  } else if (role === UserRole.PRODUCT_MANAGER) {
    moreItems.push({ label: 'Projects', path: '/pm/projects', Icon: FolderKanban, group: 'Workspace' });
    if (hasAny('analytics.view_team')) {
      moreItems.push({ label: 'Standup',  path: '/pm/standup',  Icon: Sun });
    }
    // Activity entry dropped — see admin block. Today primary slot
    // serves the same purpose now.
    if (hasAny('analytics.view_team')) {
      moreItems.push({ label: 'Team',      path: '/pm/team',      Icon: Users });
      moreItems.push({ label: 'Approvals', path: '/approvals',    Icon: ClipboardCheck });
    }
    if (hasAny('analytics.view_portfolio', 'analytics.view_project', 'analytics.view_team')) {
      moreItems.push({ label: 'Analytics', path: '/pm/analytics', Icon: BarChart3 });
    }
    moreItems.push({ label: 'Content', path: '/cms', Icon: BookOpen, group: 'Content' });
    moreItems.push({ label: 'My Time', path: '/my-time', Icon: CalendarClock, group: 'Personal' });
  } else if (role === UserRole.ENGINEER) {
    moreItems.push({ label: 'Projects', path: '/projects', Icon: FolderKanban, group: 'Workspace' });
    // Activity entry dropped — see admin block.
    if (hasAny('analytics.view_project')) {
      moreItems.push({ label: 'Analytics', path: '/analytics', Icon: BarChart3 });
    }
    if (hasAny('analytics.view_team')) {
      moreItems.push({ label: 'Standup',   path: '/standup',   Icon: Sun });
      moreItems.push({ label: 'Team',      path: '/team',      Icon: Users });
      moreItems.push({ label: 'Approvals', path: '/approvals', Icon: ClipboardCheck });
    }
    moreItems.push({ label: 'Content', path: '/cms', Icon: BookOpen, group: 'Content' });
    moreItems.push({ label: 'My Time', path: '/my-time', Icon: CalendarClock, group: 'Personal' });
  }

  return { primary, more: moreItems, hidden: false };
}
