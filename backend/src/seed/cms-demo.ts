/**
 * CMS demo seed.
 *
 * The CMS pages render UI shells correctly but the database is empty out
 * of the box, so the surfaces look blank in dev. This script populates two
 * realistic content projects (Furix marketing site + Exargen Studio Blog),
 * a handful of templates, and a small library of blog posts so the CMS
 * actually feels alive.
 *
 * Idempotent — skips on existing slugs. Safe to re-run.
 *
 *   npx tsx backend/src/seed/cms-demo.ts
 */
import { CmsTemplateType, CmsBlogStatus, UserRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import prisma from '../config/database';

interface TemplateSpec {
  name: string;
  slug: string;
  type: CmsTemplateType;
  description: string;
  structure: any;
}

interface BlogSpec {
  title: string;
  slug: string;
  excerpt: string;
  /** Slug of a template inside the same project; resolved before insert. */
  templateSlug?: string;
  content: any;
  tags: string[];
  categories: string[];
  status: CmsBlogStatus;
  publishedDaysAgo?: number;
}

interface ProjectSpec {
  name: string;
  slug: string;
  description: string;
  domain: string;
  templates: TemplateSpec[];
  blogs: BlogSpec[];
}

// ─── Block content helpers — match the shape RichContentEditor expects ───
const heading = (text: string, level = 2) => ({ type: 'heading', text, level });
const paragraph = (text: string) => ({ type: 'paragraph', text });
const code = (code: string, language = 'typescript') => ({
  type: 'code', code, language, theme: 'dark', showLineNumbers: true,
});
const quote = (text: string, by?: string) => ({ type: 'quote', text, by });
const list = (items: string[], ordered = false) => ({ type: 'list', items, ordered });

const PROJECTS: ProjectSpec[] = [
  // ─── 1. Furix marketing site ───────────────────────────────────────────────
  {
    name: 'Furix Marketing',
    slug: 'furix-marketing',
    description: 'Public-facing site for Furix AI — security advisories, product launches, deep-dive blogs.',
    domain: 'furix.ai',
    templates: [
      {
        name: 'Security Advisory',
        slug: 'security-advisory',
        type: CmsTemplateType.ANNOUNCEMENT,
        description: 'CVE disclosure template — vuln summary, affected versions, fix guidance, timeline.',
        structure: {
          sections: ['Summary', 'Affected versions', 'Mitigation', 'Timeline', 'Credits'],
          frontmatter: ['cve_id', 'cvss', 'severity'],
        },
      },
      {
        name: 'Product Launch',
        slug: 'product-launch',
        type: CmsTemplateType.ANNOUNCEMENT,
        description: 'Standard launch post — what shipped, why now, what\'s next.',
        structure: {
          sections: ['What shipped', 'Why now', 'How to try it', 'What\'s next'],
        },
      },
      {
        name: 'Engineering Deep Dive',
        slug: 'eng-deep-dive',
        type: CmsTemplateType.ARTICLE,
        description: 'Long-form architecture post with code samples and diagrams.',
        structure: {
          sections: ['Problem', 'Approach', 'Implementation', 'Trade-offs', 'Lessons'],
        },
      },
    ],
    blogs: [
      {
        title: 'CVE-2026-1872: JWT verifier bypass in Furix Inference (≤ v8.4)',
        slug: 'cve-2026-1872-jwt-verifier-bypass',
        excerpt: 'A path-traversal in our JWT signing library let unauthenticated callers forge valid tokens. Patched in v8.5.0; mitigation guidance below.',
        templateSlug: 'security-advisory',
        status: CmsBlogStatus.PUBLISHED,
        publishedDaysAgo: 3,
        tags: ['security', 'cve', 'urgent'],
        categories: ['Security'],
        content: {
          blocks: [
            heading('Summary', 2),
            paragraph(
              'On 2026-05-01 our security team identified a path-traversal vulnerability in the JWT verifier shipped with Furix Inference up to and including v8.4. An unauthenticated attacker who knew a tenant ID could forge tokens that the inference gateway accepted as legitimate.',
            ),
            paragraph(
              'We classify this as **CVSS 7.4 (High)**. There is no evidence of exploitation in production tenants. The patched version (v8.5.0) is available now and we strongly recommend immediate upgrade.',
            ),
            heading('Affected versions', 2),
            list(['v8.0.0 – v8.4.x (inclusive)', 'v8.5.0 and later are not affected']),
            heading('Mitigation', 2),
            paragraph('Pin to v8.5.0 in your Helm values:'),
            code(`furix:
  inference:
    image:
      tag: "v8.5.0"  # was: "v8.4.2"`, 'yaml'),
            paragraph(
              'If you cannot upgrade right away, a temporary mitigation is to drop tokens that contain `..` in the kid field at your reverse proxy. Sample nginx snippet:',
            ),
            code(`location / {
  if ($http_authorization ~* "kid=\\".*\\.\\..*\\"") { return 401; }
  proxy_pass http://furix-inference;
}`, 'nginx'),
            heading('Timeline', 2),
            list([
              '2026-05-01 09:14 IST — Internal report from Karthik (Furix engineering)',
              '2026-05-01 11:02 IST — Reproduced + scope confirmed',
              '2026-05-01 18:30 IST — Patch landed in v8.5.0-rc1',
              '2026-05-02 08:00 IST — v8.5.0 released to all tenants',
              '2026-05-02 12:00 IST — Public disclosure (this post)',
            ], true),
            heading('Credits', 2),
            paragraph('Reported and patched by Karthik S (Furix engineering). Coordinated by Pankaj at Exargen security.'),
          ],
        },
      },
      {
        title: 'Furix Voice 2.0: ten languages, half the latency',
        slug: 'furix-voice-2-launch',
        excerpt: 'We rewrote the voice pipeline from streaming Whisper to a custom transformer with Indic-language fine-tuning. Day-1 latency is down 47%.',
        templateSlug: 'product-launch',
        status: CmsBlogStatus.PUBLISHED,
        publishedDaysAgo: 12,
        tags: ['launch', 'voice', 'indic'],
        categories: ['Product'],
        content: {
          blocks: [
            heading('What shipped', 2),
            paragraph(
              'Today we are rolling out Furix Voice 2.0 to all paid tenants. It is our first ground-up rewrite of the voice pipeline since the v1 stack went live 18 months ago.',
            ),
            list([
              '**10 supported languages** including Hindi, Bengali, Tamil, Telugu, and Marathi (up from English-only)',
              '**Latency p95 down 47%** (820 ms → 432 ms on the same hardware)',
              '**Code-switching aware** — accuracy on Hinglish snippets up 18 percentage points',
            ]),
            heading('Why now', 2),
            paragraph(
              'The customer signal had been clear for two quarters — Indian SMBs (the DhandhaPhone cohort especially) were running their stores in two or three languages per call, and v1\'s mono-language assumption was the single biggest reason for support escalations.',
            ),
            heading('How to try it', 2),
            paragraph('Existing tenants automatically receive the new pipeline. No config changes required.'),
            heading('What\'s next', 2),
            paragraph(
              'On-device inference for the same model is in private alpha — drop us a line if you want early access.',
            ),
          ],
        },
      },
      {
        title: 'Postgres replication lag: why we moved off pgbouncer at scale',
        slug: 'postgres-replication-lag-pgbouncer',
        excerpt: 'When our primary failed over and our replica was 30 seconds behind, we learned a painful lesson about transaction-pooled connections.',
        templateSlug: 'eng-deep-dive',
        status: CmsBlogStatus.PUBLISHED,
        publishedDaysAgo: 24,
        tags: ['postgres', 'sre', 'incident'],
        categories: ['Engineering'],
        content: {
          blocks: [
            heading('Problem', 2),
            paragraph(
              'On 2026-04-08 our primary Postgres instance failed over to its replica during a routine maintenance window. We expected ~5 seconds of write unavailability. We got 47 seconds — and a stack of 500s users were definitely going to remember.',
            ),
            quote(
              'The first sign something was wrong was that latency-monitoring alerts fired BEFORE the failover finished — the replica was already 30 seconds behind on apply.',
              'Postmortem retro, 2026-04-09',
            ),
            heading('Approach', 2),
            paragraph(
              'We reproduced the lag in staging by replaying our peak-hour write workload at 1.5x and watching `pg_stat_replication.replay_lag` climb past 30 seconds. The smoking gun was our pgbouncer config in transaction-pooled mode under sustained `LISTEN/NOTIFY` traffic.',
            ),
            heading('Implementation', 2),
            paragraph('Three changes shipped in v8.5.0:'),
            list([
              'Move `LISTEN/NOTIFY` consumers to a dedicated direct-connection pool (no pgbouncer)',
              'Replace pgbouncer transaction pooling with PgCat session pooling for primary writes',
              'Add a `pg_stat_replication.replay_lag` SLO at 5 seconds with PagerDuty wired to it',
            ], true),
            heading('Trade-offs', 2),
            paragraph(
              'PgCat is younger software, and we\'re committed to a vendor we don\'t fully control. We mitigated by running it in shadow mode for two weeks before flipping the cutover.',
            ),
            heading('Lessons', 2),
            paragraph(
              'The biggest lesson: don\'t assume your replica is keeping up just because the dashboard says it is. Measure the lag with a workload that looks like production, not synthetic queries.',
            ),
          ],
        },
      },
      {
        title: 'Streaming responses on the /chat endpoint (draft)',
        slug: 'streaming-chat-endpoint',
        excerpt: 'We are adding SSE-style streaming to the inference gateway so first-token latency under bursty load drops below 200ms. Draft, do not publish.',
        templateSlug: 'eng-deep-dive',
        status: CmsBlogStatus.DRAFT,
        tags: ['inference', 'streaming', 'WIP'],
        categories: ['Engineering'],
        content: {
          blocks: [
            heading('Problem', 2),
            paragraph('TODO: write up why TTFB matters for chat UX. Cite Linear blog?'),
            heading('Approach', 2),
            paragraph('TODO: SSE vs WebSocket vs HTTP/2 push. Decide on SSE.'),
          ],
        },
      },
    ],
  },

  // ─── 2. Exargen Studio Blog ────────────────────────────────────────────────
  {
    name: 'Exargen Studio Blog',
    slug: 'exargen-studio',
    description: 'Engineering and product writing from the Exargen team — what we ship, how we ship it, what we learned along the way.',
    domain: 'studio.exargen.in',
    templates: [
      {
        name: 'Weekly Digest',
        slug: 'weekly-digest',
        type: CmsTemplateType.NEWS,
        description: 'What every product shipped this week. Auto-generated draft from sprint completions.',
        structure: {
          sections: ['Highlights', 'Per-product', 'On the horizon'],
        },
      },
      {
        name: 'Customer Case Study',
        slug: 'case-study',
        type: CmsTemplateType.CASE_STUDY,
        description: 'How a customer is using one of our products in production.',
        structure: {
          sections: ['Background', 'Challenge', 'Solution', 'Results'],
        },
      },
    ],
    blogs: [
      {
        title: 'How we ship 8 products from one cockpit',
        slug: 'how-we-ship-eight-products',
        excerpt: 'A behind-the-scenes look at the tooling we built to keep eight parallel products on track without losing the founder\'s sanity.',
        status: CmsBlogStatus.PUBLISHED,
        publishedDaysAgo: 6,
        tags: ['process', 'tooling', 'meta'],
        categories: ['Engineering', 'Product'],
        content: {
          blocks: [
            paragraph(
              'When you\'re running 8 products in parallel — Furix AI, RozCar, ManaCalendar, DhandhaPhone, BountiPOS, Clawmates ADK, HPCL Analytics, and a stealth-mode social-impact project — the question is not "are we shipping?" but "are we shipping the right thing in each one?"',
            ),
            heading('What we tried first', 2),
            paragraph(
              'For the first six months we ran on a Notion + Linear + Slack stack. It worked, but every Monday standup the founder spent the first 20 minutes context-switching between 8 different Linear projects to figure out where the time was going.',
            ),
            heading('What we built', 2),
            paragraph(
              'We built our own command center — a dashboard that surfaces the studio-wide signal in four bands: product health, what\'s shipping right now across all teams, capacity vs velocity, and a triage inbox for things that need a routing decision today.',
            ),
            quote(
              'The triage inbox cut my morning ritual from 35 minutes to under 10. That\'s the only metric that matters.',
              'Pankaj, founder',
            ),
            heading('What we learned', 2),
            list([
              'A studio-wide view is not just a roll-up — it\'s a different abstraction',
              'Per-product custom fields (CVE for Furix, KYC for RozCar) prevent label sprawl',
              'A retro form built into the sprint-complete flow gets used; a separate retro doc never does',
            ]),
          ],
        },
      },
      {
        title: 'Hiring update: Q2 priorities',
        slug: 'hiring-q2-update',
        excerpt: 'We\'re opening engineering roles on Furix AI and RozCar. Here\'s what we look for and what the interview looks like.',
        status: CmsBlogStatus.PUBLISHED,
        publishedDaysAgo: 18,
        tags: ['hiring', 'team'],
        categories: ['People'],
        content: {
          blocks: [
            paragraph(
              'Our Q2 hiring focus is two senior engineering roles — one on Furix (RAG / LLM systems) and one on RozCar (mobile + backend, with KYC / payments depth).',
            ),
            heading('What we look for', 2),
            list([
              'Production engineering taste — you have shipped, broken, and fixed things at meaningful scale',
              'Cross-team curiosity — you don\'t treat product, design, or ops as someone else\'s problem',
              'Fluent communication — you can write a postmortem that someone two teams over learns from',
            ]),
            heading('What the interview is', 2),
            paragraph(
              'Two technical sessions (45 min each), a portfolio walkthrough, and a final founder conversation. We do not believe in coding tests under time pressure.',
            ),
          ],
        },
      },
    ],
  },
];

async function main() {
  console.log('🌱 CMS demo seed — populating two content projects with realistic posts…\n');

  // Pick an admin to author every blog. The CmsBlog model requires an authorId,
  // and using the seeded SUPER_ADMIN means deleting other users won't break
  // referential integrity.
  const author = await prisma.user.findFirst({ where: { role: UserRole.SUPER_ADMIN } });
  if (!author) {
    console.error('  No SUPER_ADMIN found. Run the main seed first.');
    process.exit(1);
  }

  let createdProjects = 0;
  let createdTemplates = 0;
  let createdBlogs = 0;
  let skipped = 0;

  for (const projectSpec of PROJECTS) {
    let project = await prisma.cmsContentProject.findUnique({ where: { slug: projectSpec.slug } });
    if (!project) {
      project = await prisma.cmsContentProject.create({
        data: {
          name: projectSpec.name,
          slug: projectSpec.slug,
          description: projectSpec.description,
          domain: projectSpec.domain,
          // 32-byte hex API key — same format the route handler generates.
          apiKey: `cms_${randomBytes(24).toString('hex')}`,
        },
      });
      createdProjects++;
      console.log(`  ✅ Project "${project.name}" created`);
    } else {
      console.log(`  ⏭  Project "${project.name}" already exists, populating contents…`);
    }

    // Templates — keyed by slug per project so we can reference them from blogs.
    const templateBySlug = new Map<string, string>();
    for (const t of projectSpec.templates) {
      const existing = await prisma.cmsTemplate.findFirst({
        where: { projectId: project.id, slug: t.slug },
      });
      if (existing) {
        templateBySlug.set(t.slug, existing.id);
        skipped++;
        continue;
      }
      const created = await prisma.cmsTemplate.create({
        data: {
          projectId: project.id,
          name: t.name,
          slug: t.slug,
          type: t.type,
          description: t.description,
          structure: t.structure,
        },
      });
      templateBySlug.set(t.slug, created.id);
      createdTemplates++;
    }

    // Blogs.
    for (const b of projectSpec.blogs) {
      const existing = await prisma.cmsBlog.findFirst({
        where: { projectId: project.id, slug: b.slug },
      });
      if (existing) {
        skipped++;
        continue;
      }
      const publishedAt =
        b.status === CmsBlogStatus.PUBLISHED && b.publishedDaysAgo != null
          ? new Date(Date.now() - b.publishedDaysAgo * 86_400_000)
          : null;

      await prisma.cmsBlog.create({
        data: {
          projectId: project.id,
          templateId: b.templateSlug ? templateBySlug.get(b.templateSlug) ?? null : null,
          title: b.title,
          slug: b.slug,
          excerpt: b.excerpt,
          content: b.content,
          tags: b.tags,
          categories: b.categories,
          status: b.status,
          authorId: author.id,
          publishedAt,
        },
      });
      createdBlogs++;
    }

    console.log(
      `     templates: ${projectSpec.templates.length} (${
        Array.from(templateBySlug.values()).length
      } resolved) · blogs: ${projectSpec.blogs.length}`,
    );
  }

  console.log(
    `\n🎉 Done — created ${createdProjects} project${createdProjects === 1 ? '' : 's'}, ${createdTemplates} template${
      createdTemplates === 1 ? '' : 's'
    }, ${createdBlogs} blog post${createdBlogs === 1 ? '' : 's'}. Skipped ${skipped} that already existed.\n`,
  );
}

main()
  .catch((e) => {
    console.error('CMS demo seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
