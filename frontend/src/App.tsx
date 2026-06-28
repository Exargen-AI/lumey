import { Routes, Route, Navigate } from 'react-router-dom';
import { useInitAuth, useAuth } from '@/hooks/useAuth';
import { useInactivityLogout } from '@/hooks/useInactivityLogout';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { RoleRedirect } from '@/components/auth/RoleRedirect';
import { InactivityWarningModal } from '@/components/auth/InactivityWarningModal';
import { ErrorBoundary, ConfirmProvider } from '@/components/ui';
import { reportBoundaryError } from '@/lib/errorReporter';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { LoginPage } from '@/pages/LoginPage';
import { AppShell } from '@/components/layout/AppShell';
import { ClientLayout } from '@/components/layout/ClientLayout';

// Admin pages
import { StudioPortfolioPage } from '@/pages/admin/StudioPortfolioPage';
import { TriageInboxPage } from '@/pages/admin/TriageInboxPage';
import { ProjectListPage } from '@/pages/admin/ProjectListPage';
import { ProjectDetailPage } from '@/pages/admin/ProjectDetailPage';
import { ProjectFormPage } from '@/pages/admin/ProjectFormPage';
import { ProductDetailPage } from '@/pages/admin/ProductDetailPage';
import { TimelinePage } from '@/pages/admin/TimelinePage';
import { TeamPage } from '@/pages/admin/TeamPage';
import { AnalyticsPage } from '@/pages/admin/AnalyticsPage';
import { UserManagementPage } from '@/pages/admin/UserManagementPage';
import { RBACPage } from '@/pages/admin/RBACPage';
import { SystemSettingsPage } from '@/pages/admin/SystemSettingsPage';
import { StandupViewPage } from '@/pages/admin/StandupViewPage';
import { InboxPage } from '@/pages/InboxPage';

// PM pages
import { PMDashboardPage } from '@/pages/pm/DashboardPage';
import { PMProjectDetailPage } from '@/pages/pm/ProjectDetailPage';

// Engineer pages
import { EngDashboardPage } from '@/pages/engineer/DashboardPage';
import { MyTasksPage } from '@/pages/engineer/MyTasksPage';
import { EngProjectBoardPage } from '@/pages/engineer/ProjectBoardPage';
import { EODUpdatePage } from '@/pages/engineer/EODUpdatePage';

// Client pages
import { ClientDashboardPage } from '@/pages/client/DashboardPage';
import { ClientProjectStatusPage } from '@/pages/client/ProjectStatusPage';
// Client portal section skeletons (Phase 1 — placeholders; Phase 2 fills them).
import { ClientRoadmapPage } from '@/pages/client/sections/RoadmapPage';
import { ClientSprintsPage } from '@/pages/client/sections/SprintsPage';
import { ClientTimelinePage } from '@/pages/client/sections/TimelinePage';
import { ClientDeliverablesPage } from '@/pages/client/sections/DeliverablesPage';
import { ClientDecisionsPage } from '@/pages/client/sections/DecisionsPage';
import { ClientInsightsPage } from '@/pages/client/sections/InsightsPage';
import { ClientDocumentsPage } from '@/pages/client/sections/DocumentsPage';
import { ClientActivityPage } from '@/pages/client/sections/ActivityPage';
import { ClientBoardPage } from '@/pages/client/sections/BoardPage';
import { ClientProductsPage } from '@/pages/client/sections/ProductsPage';
import { ClientProductDetailPage } from '@/pages/client/sections/ProductDetailPage';
import { ClientHelpPage } from '@/pages/client/sections/HelpPage';

// Shared pages
import { TaskDetailPage } from '@/pages/TaskDetailPage';
import { CreateTaskPage } from '@/pages/CreateTaskPage';
import { AccountPage } from '@/pages/AccountPage';
import { TodayPage } from '@/pages/TodayPage';
import { ProjectIngestPage } from '@/pages/ProjectIngestPage';

export function App() {
  useInitAuth();
  // Inactivity logout — 12 hours (default; overridable via
  // VITE_INACTIVITY_TIMEOUT_MS in `.env`). Hook is no-op while
  // unauthenticated, so the listeners cost nothing for visitors hitting
  // /login. Warning modal surfaces in the last 2 minutes of the window so
  // the user has a clear, unhurried chance to stay signed in.
  const { logout } = useAuth();
  const { phase, secondsLeft, stayLoggedIn } = useInactivityLogout(() => {
    // Force logout — clears auth + redirects to /login. The hook's caller
    // is the only thing that should fire this; it's debounced + scoped to
    // authenticated state inside the hook itself.
    void logout();
  });

  const projectPermissions = ['project.view_all', 'project.view_assigned'];
  const activityPermissions = ['analytics.view_portfolio', 'analytics.view_project'];
  const analyticsPermissions = ['analytics.view_portfolio', 'analytics.view_project', 'analytics.view_team'];

  return (
    <ErrorBoundary onError={reportBoundaryError}>
      <ConfirmProvider>
      <InactivityWarningModal
        open={phase === 'warning'}
        secondsLeft={secondsLeft}
        onStay={stayLoggedIn}
        onLogoutNow={() => void logout()}
      />
      {/* PWA "Add to Home Screen" prompt — only renders on mobile, only
          when the user can install (Chromium event fired OR iOS Safari).
          Self-suppresses after dismissal or install. */}
      <InstallPrompt />
      <Routes>
        <Route path="/login" element={<LoginPage />} />

      {/* Shared permission-based routes */}
      <Route element={<ProtectedRoute permissions={projectPermissions} />}>
        <Route element={<AppShell />}>
          <Route path="/projects" element={<ProjectListPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          {/* Product detail — admin view of a product's tasks + a
              product-scoped kanban. Permission falls back to project
              access; the page itself uses product.view via the API gate. */}
          <Route path="/projects/:id/products/:productId" element={<ProductDetailPage />} />
          <Route path="/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
          {/* HITL agent inbox — every run waiting on a human (questions + approvals). */}
          <Route path="/agent-inbox" element={<InboxPage />} />
          <Route path="/timeline" element={<TimelinePage />} />
          {/* Admin/super-admin "My Tasks" — same component as engineers,
              role-aware navigation built in. Team feedback #3. */}
          <Route path="/my-tasks" element={<MyTasksPage />} />
        </Route>
      </Route>

      {/* Universal /account page — every authenticated user can edit their
          display name + company and change their password from here.
          Renders inside the AppShell for admin/PM/engineer (gives them the
          familiar nav chrome); clients render inside ClientLayout (next
          block) so the page lives inside their portal frame.
          Gated on the `task.view_internal` permission — the cleanest proxy
          for "internal team member", which every internal role has by
          default and CLIENT never does (clients always use the portal). */}
      <Route element={<ProtectedRoute permissions={['task.view_internal']} />}>
        <Route element={<AppShell />}>
          <Route path="/account" element={<AccountPage />} />
          {/* "Today" — daily wrap-up of what shipped, with the comments
              people posted on those tasks. Visible to every internal role;
              clients get their own scoped view inside the client routes. */}
          <Route path="/today" element={<TodayPage />} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute roles={['CLIENT']} />}>
        <Route element={<ClientLayout />}>
          <Route path="/account" element={<AccountPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute permissions={['task.create']} />}>
        <Route element={<AppShell />}>
          <Route path="/projects/:projectId/tasks/new" element={<CreateTaskPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute permissions={['analytics.view_portfolio']} />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<StudioPortfolioPage />} />
          {/* Triage Inbox — the morning ritual screen. Same RBAC gate as the
              portfolio dashboard since both surface the studio-wide attention items. */}
          <Route path="/inbox" element={<TriageInboxPage />} />
        </Route>
      </Route>

      {/* Internal activity feed used to live at `/activity` and was a
          distinct Activity-log surface. PR 2026-05-15 consolidated
          Activity + Today into the same combined page — the canonical
          URL is `/today` and `/activity` redirects there so old
          bookmarks survive. */}
      <Route element={<ProtectedRoute permissions={activityPermissions} />}>
        <Route element={<AppShell />}>
          <Route path="/activity" element={<Navigate to="/today" replace />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute permissions={['analytics.view_team']} />}>
        <Route element={<AppShell />}>
          <Route path="/team" element={<TeamPage />} />
          <Route path="/standup" element={<StandupViewPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute permissions={analyticsPermissions} />}>
        <Route element={<AppShell />}>
          <Route path="/analytics" element={<AnalyticsPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute permissions={['project.create']} />}>
        <Route element={<AppShell />}>
          <Route path="/projects/new" element={<ProjectFormPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute permissions={['project.edit']} />}>
        <Route element={<AppShell />}>
          <Route path="/projects/:id/edit" element={<ProjectFormPage />} />
          {/* Plan ingestion — turn a markdown implementation plan into
              Epics → Sprints → Tasks. project.edit gates entry; the
              service layer re-checks membership for defense in depth. */}
          <Route path="/projects/:id/ingest" element={<ProjectIngestPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute permissions={['user.view']} />}>
        <Route element={<AppShell />}>
          <Route path="/users" element={<UserManagementPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute permissions={['rbac.manage']} />}>
        <Route element={<AppShell />}>
          <Route path="/rbac" element={<RBACPage />} />
        </Route>
      </Route>

      {/* Super Admin only */}
      <Route element={<ProtectedRoute roles={['SUPER_ADMIN']} />}>
        <Route element={<AppShell />}>
          <Route path="/settings" element={<SystemSettingsPage />} />
        </Route>
      </Route>

      {/* Product Manager routes */}
      <Route element={<ProtectedRoute roles={['PRODUCT_MANAGER']} />}>
        <Route element={<AppShell />}>
          <Route path="/pm/dashboard" element={<PMDashboardPage />} />
          <Route path="/pm/projects" element={<ProjectListPage />} />
          <Route path="/pm/projects/:id" element={<PMProjectDetailPage />} />
          <Route path="/pm/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
          {/* PM "My Tasks" — same component, namespaced under /pm so the
              app shell renders the PM sidebar context (team feedback #3). */}
          <Route path="/pm/my-tasks" element={<MyTasksPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['PRODUCT_MANAGER']} permissions={['task.create']} />}>
        <Route element={<AppShell />}>
          <Route path="/pm/projects/:projectId/tasks/new" element={<CreateTaskPage />} />
        </Route>
      </Route>

      {/* PM activity route also redirects to /today — same consolidation
          as /activity above. The PM sidebar's old entry is dropped. */}
      <Route element={<ProtectedRoute roles={['PRODUCT_MANAGER']} permissions={['analytics.view_portfolio', 'analytics.view_project']} />}>
        <Route element={<AppShell />}>
          <Route path="/pm/activity" element={<Navigate to="/today" replace />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['PRODUCT_MANAGER']} permissions={['analytics.view_team']} />}>
        <Route element={<AppShell />}>
          <Route path="/pm/standup" element={<StandupViewPage />} />
          <Route path="/pm/team" element={<TeamPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={['PRODUCT_MANAGER']} permissions={['analytics.view_portfolio', 'analytics.view_project', 'analytics.view_team']} />}>
        <Route element={<AppShell />}>
          <Route path="/pm/analytics" element={<AnalyticsPage />} />
        </Route>
      </Route>

      {/* Engineer routes */}
      <Route element={<ProtectedRoute roles={['ENGINEER']} />}>
        <Route element={<AppShell />}>
          <Route path="/eng/dashboard" element={<EngDashboardPage />} />
          <Route path="/eng/my-tasks" element={<MyTasksPage />} />
          <Route path="/eng/eod-update" element={<EODUpdatePage />} />
          <Route path="/eng/projects/:id" element={<EngProjectBoardPage />} />
          <Route path="/eng/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
        </Route>
      </Route>

      {/*
        Client routes — two role tiers:
          /client/dashboard           CLIENT only (it's the client's "my projects"
                                      landing page; admins use their own dashboard)
          /client/projects/:id        Admin/PM also allowed in — they need to be
                                      able to see EXACTLY what the client sees
                                      (QA, demo, support calls, dogfooding). Page
                                      uses ClientLayout's slim chrome regardless,
                                      so admins get a faithful preview.
          /client/projects/.../tasks  Same broader access.
      */}
      <Route element={<ProtectedRoute roles={['CLIENT']} />}>
        <Route element={<ClientLayout />}>
          <Route path="/client/dashboard" element={<ClientDashboardPage />} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute roles={['CLIENT', 'SUPER_ADMIN', 'ADMIN', 'PRODUCT_MANAGER']} />}>
        <Route element={<ClientLayout />}>
          {/* Portal-wide help page — not nested under a project because the
              "what is this and how do I use it?" questions don't depend on
              which project you're on. Reachable from every screen via the
              sidebar's Help row. */}
          <Route path="/client/help" element={<ClientHelpPage />} />
          {/* Overview (the existing dense status page; sidebar marks this active when
              suffix is empty). Sibling skeleton routes below give the sidebar real
              targets to navigate to — Phase 2 will move content into each. */}
          <Route path="/client/projects/:id" element={<ClientProjectStatusPage />} />
          <Route path="/client/projects/:id/board" element={<ClientBoardPage />} />
          <Route path="/client/projects/:id/products" element={<ClientProductsPage />} />
          <Route path="/client/projects/:id/products/:productId" element={<ClientProductDetailPage />} />
          <Route path="/client/projects/:id/sprints" element={<ClientSprintsPage />} />
          <Route path="/client/projects/:id/timeline" element={<ClientTimelinePage />} />
          {/* Legacy combined tab → redirects to /sprints. */}
          <Route path="/client/projects/:id/roadmap" element={<ClientRoadmapPage />} />
          <Route path="/client/projects/:id/deliverables" element={<ClientDeliverablesPage />} />
          <Route path="/client/projects/:id/decisions" element={<ClientDecisionsPage />} />
          <Route path="/client/projects/:id/insights" element={<ClientInsightsPage />} />
          <Route path="/client/projects/:id/documents" element={<ClientDocumentsPage />} />
          <Route path="/client/projects/:id/activity" element={<ClientActivityPage />} />
          <Route path="/client/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
        </Route>
      </Route>

        {/* Catch-all */}
        <Route path="*" element={<RoleRedirect />} />

      </Routes>
      </ConfirmProvider>
    </ErrorBoundary>
  );
}
