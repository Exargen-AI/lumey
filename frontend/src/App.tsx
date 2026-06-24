import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useInitAuth, useAuth } from '@/hooks/useAuth';
import { useInactivityLogout } from '@/hooks/useInactivityLogout';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { RoleRedirect } from '@/components/auth/RoleRedirect';
import { OnboardingGate } from '@/components/onboarding/OnboardingGate';
import { InactivityWarningModal } from '@/components/auth/InactivityWarningModal';
import { ErrorBoundary, ConfirmProvider } from '@/components/ui';
import { reportBoundaryError } from '@/lib/errorReporter';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { LoginPage } from '@/pages/LoginPage';
import { AppShell } from '@/components/layout/AppShell';
import { ClientLayout } from '@/components/layout/ClientLayout';

// Admin pages
import { AdminDashboardPage } from '@/pages/admin/DashboardPage';
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
import { PulsePage } from '@/pages/admin/PulsePage';
import { PulseReportsPage } from '@/pages/admin/PulseReportsPage';
import { LeadDetailPage } from '@/pages/admin/LeadDetailPage';
import { StandupViewPage } from '@/pages/admin/StandupViewPage';

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
import { ClientCompliancePage } from '@/pages/client/sections/CompliancePage';
import { ClientProductsPage } from '@/pages/client/sections/ProductsPage';
import { ClientProductDetailPage } from '@/pages/client/sections/ProductDetailPage';
import { ClientHelpPage } from '@/pages/client/sections/HelpPage';

// Shared pages
import { TaskDetailPage } from '@/pages/TaskDetailPage';
import { CreateTaskPage } from '@/pages/CreateTaskPage';
import { MyTimePage } from '@/pages/MyTimePage';
import { AccountPage } from '@/pages/AccountPage';
import { TodayPage } from '@/pages/TodayPage';
import { ApprovalsPage } from '@/pages/admin/ApprovalsPage';
import { ProjectIngestPage } from '@/pages/ProjectIngestPage';
import CmsPage from '@/pages/CmsPage';

// CMS pages
import { default as ProjectBlogsPage } from '@/pages/cms/ProjectBlogsPage';
import { default as ProjectTemplatesPage } from '@/pages/cms/ProjectTemplatesPage';
import { default as ProjectSettingsPage } from '@/pages/cms/ProjectSettingsPage';
import { default as ProjectLeadsPage } from '@/pages/cms/ProjectLeadsPage';
import { default as CreateBlogPage } from '@/pages/cms/CreateBlogPage';
import { default as EditBlogPage } from '@/pages/cms/EditBlogPage';
import { default as BlogPreviewPage } from '@/pages/cms/BlogPreviewPage';
import { default as ProjectContentEnginePage } from '@/pages/cms/ProjectContentEnginePage';

// Compliance / onboarding admin pages
import { ComplianceCourseListPage } from '@/pages/admin/compliance/CourseListPage';
import { ComplianceCourseDetailPage } from '@/pages/admin/compliance/CourseDetailPage';
import { ComplianceEnrollmentsPage } from '@/pages/admin/compliance/EnrollmentsPage';
import { UserOnboardingDetailPage } from '@/pages/admin/compliance/UserOnboardingDetailPage';
import { MyConfidentialityPage } from '@/pages/onboarding/MyConfidentialityPage';

/**
 * Forwards `/eng/projects/:projectId/tasks/new` to the canonical
 * `/projects/:projectId/tasks/new`. The eng-prefixed path was a leftover
 * from the role-prefix routing convention but nothing in the app
 * navigated to it — and the canonical route's `task.create` permission
 * already covers engineers, admins, and PMs, so a single destination is
 * enough. Kept as a transparent forward so old bookmarks don't 404.
 */
function EngTaskCreateForward() {
  const { projectId } = useParams<{ projectId: string }>();
  return <Navigate to={`/projects/${projectId}/tasks/new`} replace />;
}

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
  const cmsPermissions = [
    'cms.project.view',
    'cms.project.create',
    'cms.project.edit',
    'cms.blog.view',
    'cms.blog.create',
    'cms.blog.edit',
    'cms.template.view',
    'cms.template.create',
    'cms.template.edit',
    'cms.media.view',
    'cms.media.upload',
  ];

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

      {/*
        OnboardingGate is the app-level mandatory-onboarding chokepoint. It
        wraps every authenticated route. If the user has any pending
        mandatory enrollments (NDA / IP / Conduct / Security course), it
        renders the CoursePlayer instead of the requested route. Once they
        complete the course, /auth/me is refetched and the gate falls
        through to <Outlet /> rendering the normal app.
      */}
      <Route element={<OnboardingGate />}>

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
          <Route path="/timeline" element={<TimelinePage />} />
          {/* Admin/super-admin "My Tasks" — same component as engineers,
              role-aware navigation built in. Team feedback #3. */}
          <Route path="/my-tasks" element={<MyTasksPage />} />
        </Route>
      </Route>

      {/* "My Time" — combined personal page (Timesheet + Leave tabs).
          Open to every authenticated user; the inner tabs decide what's
          visible. The old `/leaves` and `/eng/timesheet` paths redirect
          here for any in-flight bookmarks/notification deep-links. */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/my-time" element={<MyTimePage />} />
          {/* Back-compat redirects. `replace` so the user's history
              doesn't have the legacy URL in it. */}
          <Route path="/leaves" element={<Navigate to="/my-time?tab=leave" replace />} />
          <Route path="/eng/timesheet" element={<Navigate to="/my-time?tab=timesheet" replace />} />
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

      {/* "Approvals" — combined queue (Timesheets + Leave tabs). The
          Leave tab inside is gated to SUPER_ADMIN by the page itself.
          Route gate uses analytics.view_team so PMs can still review
          timesheets even though they can't action leave. */}
      <Route element={<ProtectedRoute permissions={['analytics.view_team']} />}>
        <Route element={<AppShell />}>
          <Route path="/approvals" element={<ApprovalsPage />} />
          {/* Back-compat redirects from the previously-separate pages. */}
          <Route path="/admin/leaves" element={<Navigate to="/approvals?tab=leave" replace />} />
          <Route path="/pm/approvals" element={<Navigate to="/approvals" replace />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute permissions={cmsPermissions} />}>
        <Route element={<AppShell />}>
          <Route path="/cms" element={<CmsPage />} />
          <Route path="/cms/projects/:projectId/blogs" element={<ProjectBlogsPage />} />
          <Route path="/cms/projects/:projectId/blogs/create" element={<CreateBlogPage />} />
          <Route path="/cms/projects/:projectId/blogs/:blogId" element={<EditBlogPage />} />
          <Route path="/cms/projects/:projectId/blogs/:blogId/preview" element={<BlogPreviewPage />} />
          <Route path="/cms/projects/:projectId/templates" element={<ProjectTemplatesPage />} />
          <Route path="/cms/projects/:projectId/settings" element={<ProjectSettingsPage />} />
          <Route path="/cms/projects/:projectId/content-engine" element={<ProjectContentEnginePage />} />
          <Route path="/cms/projects/:projectId/leads" element={<ProjectLeadsPage />} />
        </Route>
      </Route>

      {/* Compliance / onboarding course admin (SUPER_ADMIN + ADMIN only) */}
      <Route element={<ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN']} />}>
        <Route element={<AppShell />}>
          <Route path="/compliance/courses" element={<ComplianceCourseListPage />} />
          <Route path="/compliance/courses/:id" element={<ComplianceCourseDetailPage />} />
          <Route path="/compliance/enrollments" element={<ComplianceEnrollmentsPage />} />
          <Route path="/compliance/users/:userId" element={<UserOnboardingDetailPage />} />
        </Route>
      </Route>

      {/* User-facing Confidentiality page — visible to every authenticated user.
          The hard-blocking onboarding gate has been removed; this is the
          discoverable surface where employees complete (or re-complete) their
          assigned compliance courses. */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/confidentiality" element={<MyConfidentialityPage />} />
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
          {/* Legacy admin overview kept under /dashboard/legacy for one release
              while teams adapt to the new portfolio home. Safe to remove later. */}
          <Route path="/dashboard/legacy" element={<AdminDashboardPage />} />
        </Route>
      </Route>

      {/* Internal activity feed used to live at `/activity` and was a
          distinct Activity-log surface. PR 2026-05-15 consolidated
          Activity + Today into the same combined page — the canonical
          URL is `/today` and `/activity` redirects there so old
          bookmarks survive. The legacy ActivityFeedPage component still
          exists in source; revive its route here if a future PR wants
          the raw mutation log back as a separate page. */}
      <Route element={<ProtectedRoute permissions={activityPermissions} />}>
        <Route element={<AppShell />}>
          <Route path="/activity" element={<Navigate to="/today" replace />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute permissions={['analytics.view_team']} />}>
        <Route element={<AppShell />}>
          <Route path="/team" element={<TeamPage />} />
          <Route path="/standup" element={<StandupViewPage />} />
          {/* /approvals lives in the combined-approvals block above —
              don't redeclare it here or React Router picks the first
              match and the redirect siblings would lose their parent. */}
        </Route>
      </Route>

      <Route element={<ProtectedRoute permissions={['leads.view']} />}>
        <Route element={<AppShell />}>
          <Route path="/leads/:leadId" element={<LeadDetailPage />} />
          {/* Legacy global-leads route — kept as a redirect to the CMS hub
              now that leads live under each CMS project. */}
          <Route path="/admin/leads" element={<Navigate to="/cms" replace />} />
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
          <Route path="/pulse" element={<PulsePage />} />
          {/* Pulse productivity-score reports (Wave 6). SUPER_ADMIN-only
              per R5 lockdown — surface for composite scores, breakdowns,
              weights, and worker health. */}
          <Route path="/pulse/reports" element={<PulseReportsPage />} />
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
          {/* /pm/approvals → /approvals redirect lives in the combined block above. */}
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
          {/* /eng/timesheet → /my-time?tab=timesheet redirect lives in
              the combined-personal block above. */}
          <Route path="/eng/projects/:id" element={<EngProjectBoardPage />} />
          <Route path="/eng/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
        </Route>
      </Route>

      {/*
        Engineer-prefixed task-create URL is preserved as a transparent
        forward to the canonical /projects/:projectId/tasks/new (which is
        already gated by the `task.create` permission — engineers,
        admins, and PMs all have it). Nothing in the app navigates here
        today, but typed URLs and old bookmarks used to bounce non-
        engineers to their dashboard; this keeps them landing on the
        right page. ProtectedRoute is on the canonical route, not this
        forward, so the forward is reachable to anyone authenticated.
      */}
      <Route element={<ProtectedRoute />}>
        <Route path="/eng/projects/:projectId/tasks/new" element={<EngTaskCreateForward />} />
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
          <Route path="/client/projects/:id/compliance" element={<ClientCompliancePage />} />
          <Route path="/client/projects/:id/activity" element={<ClientActivityPage />} />
          <Route path="/client/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
        </Route>
      </Route>

        {/* Catch-all */}
        <Route path="*" element={<RoleRedirect />} />

        </Route>
      </Routes>
      </ConfirmProvider>
    </ErrorBoundary>
  );
}
