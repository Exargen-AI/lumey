import {
  HelpCircle, LayoutGrid, KanbanSquare, Boxes, GanttChart, Package,
  Lightbulb, BarChart3, FileText, ShieldCheck, Activity, MessageCircle,
  Mail, FolderOpen,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/cn';

/**
 * Help / "what is this and how do I use it?" — the first-stop docs page
 * for clients landing in the portal. Static one-pager, no API calls.
 * Lives at /client/help (portal-wide, not nested under a project) because
 * the questions it answers ("what's Insights?", "how do I find docs?")
 * don't depend on which project you're on.
 *
 * Structure:
 *   1. Intro — the portal in one sentence
 *   2. Sidebar tour — every section, what it shows, when to click it
 *   3. Common questions — short FAQ
 *   4. Get in touch — mailto + reminder that the team sees activity live
 *
 * Why static: clients ask for orientation in their first 10 minutes;
 * a server round-trip just to render help copy is wasteful, and the
 * copy itself rarely changes. When/if we add per-tenant onboarding,
 * swap this for a CMS-driven page — the section shapes here are the
 * stable contract.
 */

type Section = {
  // `any` because lucide-react's icon type is narrower than a plain
  // ComponentType — same pattern as ClientSidebar's SectionItem.
  Icon: React.ComponentType<any>;
  title: string;
  body: string;
};

const PORTAL_SECTIONS: Section[] = [
  {
    Icon: FolderOpen,
    title: 'All projects',
    body: 'Your portfolio landing page. Every project you have access to, with a health dot showing whether things are green, amber, or red at a glance.',
  },
  {
    Icon: LayoutGrid,
    title: 'Overview',
    body: 'The dense one-page status for a single project — health, latest update, risks, next milestone, completion rollup. Start here when checking in.',
  },
  {
    Icon: KanbanSquare,
    title: 'Project Board',
    body: 'A read-only view of the active sprint board. Drag-and-drop is admin-only; you see what is in flight, what is blocked, and what just landed.',
  },
  {
    Icon: Boxes,
    title: 'Products',
    body: 'The shippable artefacts inside the project (features, modules, integrations). Click a product to see its scope, status, and the tasks behind it.',
  },
  {
    Icon: GanttChart,
    title: 'Sprint & Roadmap',
    body: 'Milestones on a timeline with progress bars and a forecast verdict — On track, At risk, Behind, or Baselining — based on the last few weeks of velocity.',
  },
  {
    Icon: Package,
    title: 'Deliverables',
    body: 'Things being handed over to you. Specs, designs, builds, reports — each with a status (Draft, In review, Delivered) so you know what to action.',
  },
  {
    Icon: Lightbulb,
    title: 'Decisions',
    body: 'The log of choices the team has made and why. Useful for "wait, why did we pick X?" weeks later. Open decisions are flagged so you can weigh in.',
  },
  {
    Icon: BarChart3,
    title: 'Insights',
    body: 'Charts: completion ring, weekly velocity, cadence, and risk register. The "is this project actually moving?" page.',
  },
  {
    Icon: FileText,
    title: 'Documents',
    body: 'Specs, contracts, designs, runbooks. Upload anything the team needs to reference — the file is visible to both engineers and AI agents working on the project.',
  },
  {
    Icon: ShieldCheck,
    title: 'Compliance',
    body: 'Audit trail and compliance evidence for projects with regulated requirements. Hidden if your project doesn\'t need it.',
  },
  {
    Icon: Activity,
    title: 'Activity',
    body: 'A reverse-chronological feed of everything happening on the project — task status flips, milestone completions, document uploads, decisions logged.',
  },
];

type Faq = { q: string; a: string };

const FAQS: Faq[] = [
  {
    q: 'Why don\'t I see all the team\'s tasks?',
    a: 'You see tasks marked "Visible to client". This is the team\'s way of separating customer-facing work from internal scaffolding (refactors, infra, exploration). If something looks missing, ask your project manager — they can flip the visibility flag in one click.',
  },
  {
    q: 'How do I know if a milestone is at risk?',
    a: 'Open Sprint & Roadmap. Each milestone has a verdict chip — green "On track", amber "At risk", or rose "Behind" — based on the team\'s recent velocity vs. work remaining. "Baselining" means there isn\'t enough completed work yet to forecast.',
  },
  {
    q: 'Can I add a comment or open a task?',
    a: 'You can comment on tasks and milestones you can see. Opening tasks is admin-only today — drop your project manager a note and they\'ll create it (or use the Decisions log if it\'s a decision you need to capture).',
  },
  {
    q: 'How fresh is the data on these pages?',
    a: 'Live, with a short cache. When the team moves a task or ships a milestone, you see it within a minute or two on refresh. The Activity feed is the source of truth for "what just happened".',
  },
  {
    q: 'I see a section but it says "Soon" — what does that mean?',
    a: 'That section is in the sidebar but the surface hasn\'t shipped yet for your project. Nothing is missing — it just isn\'t lit up. The team will let you know when it goes live.',
  },
];

export function ClientHelpPage() {
  // Personalise the intro line with the client's name when we have it.
  // Falls back to a generic greeting; no API call needed.
  const user = useAuthStore((s) => s.user);
  const firstName = user?.name?.split(' ')[0];

  return (
    <div className="space-y-10 animate-fade-in-down max-w-4xl">
      {/* ─── Header ─── */}
      <header>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-500/10 flex items-center justify-center">
            <HelpCircle size={20} className="text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
              {firstName ? `Welcome, ${firstName}` : 'Welcome to the portal'}
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-obsidian-muted">
              A two-minute tour of where everything lives.
            </p>
          </div>
        </div>
      </header>

      {/* ─── Intro ─── */}
      <section className="rounded-2xl border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-sunken p-6 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 dark:text-obsidian-fg">
          What is this?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-obsidian-muted">
          The client portal is your window into the projects we are building for you. Status, milestones,
          documents, decisions, and the active board — all in one place, refreshed as the team works.
          You don’t need to ask "what’s the latest?" — open the project, glance at Overview, and
          you’re caught up.
        </p>
      </section>

      {/* ─── Sidebar tour ─── */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 dark:text-obsidian-fg mb-1">
          Where to find things
        </h2>
        <p className="text-sm text-gray-500 dark:text-obsidian-muted mb-5">
          Every item in the sidebar, and what it shows.
        </p>

        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PORTAL_SECTIONS.map((s) => (
            <li
              key={s.title}
              className={cn(
                'rounded-xl border border-gray-200 dark:border-obsidian-border',
                'bg-white dark:bg-obsidian-sunken p-4 flex gap-3',
              )}
            >
              <div className="w-9 h-9 rounded-lg bg-gray-50 dark:bg-obsidian-panel flex items-center justify-center shrink-0">
                <s.Icon size={16} className="text-gray-600 dark:text-obsidian-muted" />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-gray-900 dark:text-obsidian-fg">
                  {s.title}
                </div>
                <p className="mt-1 text-[12.5px] leading-snug text-gray-600 dark:text-obsidian-muted">
                  {s.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ─── FAQ ─── */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 dark:text-obsidian-fg mb-1">
          Common questions
        </h2>
        <p className="text-sm text-gray-500 dark:text-obsidian-muted mb-5">
          The five things every new client asks in week one.
        </p>

        <div className="space-y-3">
          {FAQS.map((f) => (
            <details
              key={f.q}
              className={cn(
                'group rounded-xl border border-gray-200 dark:border-obsidian-border',
                'bg-white dark:bg-obsidian-sunken px-4 py-3',
                'open:border-brand-200 dark:open:border-brand-500/30',
              )}
            >
              <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-[13.5px] font-medium text-gray-900 dark:text-obsidian-fg">
                <span>{f.q}</span>
                <span className="text-gray-400 dark:text-obsidian-faded text-sm group-open:rotate-45 transition-transform select-none">
                  +
                </span>
              </summary>
              <p className="mt-2 text-[13px] leading-relaxed text-gray-600 dark:text-obsidian-muted">
                {f.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* ─── Get in touch ─── */}
      <section className="rounded-2xl border border-gray-200 dark:border-obsidian-border bg-gradient-to-br from-brand-50/60 to-white dark:from-brand-500/5 dark:to-obsidian-sunken p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white dark:bg-obsidian-panel flex items-center justify-center shrink-0 ring-1 ring-gray-200 dark:ring-obsidian-border">
            <MessageCircle size={18} className="text-brand-600 dark:text-brand-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-obsidian-fg">
              Still stuck?
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-obsidian-muted">
              Comment on any task, milestone, or decision — your project manager will see it. For anything
              that doesn’t fit a specific surface, drop us an email and we’ll get back the same day.
            </p>
            <a
              href="mailto:support@exargen.ai"
              className={cn(
                'mt-3 inline-flex items-center gap-2 text-[13px] font-medium',
                'text-brand-700 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200',
                'transition-colors',
              )}
            >
              <Mail size={14} />
              support@exargen.ai
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
