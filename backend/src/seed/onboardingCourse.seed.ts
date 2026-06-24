import { CourseStatus, UserRole } from '@prisma/client';
import prisma from '../config/database';
import { createCourse, CreateCourseInput } from '../services/course.service';

// IMPORTANT: The legal text below is PLACEHOLDER. The structure, modules, and
// quizzes are ready to ship, but a qualified employment lawyer in your
// jurisdiction (India / US / wherever you hire) MUST review and replace the
// `bodyText` of every CourseDocument before this is used in production.
// The placeholder is intentionally clear and conservative; do not deploy as-is.

const NDA_TEXT = `NON-DISCLOSURE AGREEMENT (PLACEHOLDER — LAWYER REVIEW REQUIRED BEFORE PRODUCTION)

Between the Employee (you) and Exargen ("Company").

1. Confidential Information includes, without limitation: source code, technical
   architecture, product roadmaps, customer lists, financial data, internal
   communications, business strategies, designs, prototypes, and any information
   marked confidential or that a reasonable person would understand to be
   confidential by its nature or context.

2. You agree NOT to disclose, copy, reproduce, share, transmit, store, sell, or
   commercially exploit Confidential Information for any purpose other than the
   performance of your authorized duties for the Company.

3. You will not remove Confidential Information to personal devices, personal
   email, personal cloud storage, public code repositories, or any system not
   explicitly authorized by the Company. You will use only Company-issued or
   Company-approved tools to handle Confidential Information.

4. Upon termination of your engagement (for any reason), you will immediately
   return or destroy all Confidential Information in your possession and certify
   such return or destruction in writing if requested.

5. Your obligations under this Agreement survive the termination of your
   engagement and continue indefinitely with respect to trade secrets, and for
   a minimum period of five (5) years with respect to all other Confidential
   Information.

6. Violation of this Agreement may give rise to civil liability (including but
   not limited to injunctive relief and damages) and, where applicable,
   criminal liability under trade-secret, copyright, and computer-misuse laws.

By signing, you confirm you have read, understood, and agree to be bound by
this Agreement. Your signature is recorded electronically with a server-side
timestamp, your IP address, and your browser's user agent for audit purposes.`;

const IP_ASSIGNMENT_TEXT = `INTELLECTUAL PROPERTY ASSIGNMENT (PLACEHOLDER — LAWYER REVIEW REQUIRED)

1. "Work Product" means any invention, work of authorship, design, code,
   documentation, or other intellectual property that you conceive, develop,
   write, or create — alone or with others — during your engagement, that
   either (a) relates to the Company's actual or anticipated business or
   research, or (b) is created using any Company resources, time, facilities,
   or Confidential Information.

2. You hereby assign to the Company, irrevocably and exclusively, all worldwide
   right, title, and interest in and to all Work Product, including all
   copyrights, patents, trade secrets, moral rights, and other intellectual
   property rights, effective as of the moment of creation.

3. You will execute any further documents the Company reasonably requests to
   perfect, register, or enforce the rights assigned under this Agreement,
   including patent applications and copyright registrations, at the Company's
   expense.

4. You waive, to the fullest extent permitted by law, any moral rights or
   similar non-transferable rights in the Work Product.

5. Pre-existing inventions: any inventions or works you created BEFORE your
   engagement that you wish to exclude from this assignment must be disclosed
   to the Company in writing at the start of your engagement; otherwise this
   assignment applies to all Work Product.

6. This assignment does NOT apply to inventions you developed entirely on your
   own time, without using Company equipment, supplies, facilities, or
   Confidential Information, and that do not relate to the Company's business
   or anticipated research — to the extent such carve-out is required by
   applicable local law.

By signing, you assign all qualifying Work Product to the Company.`;

const NO_MOONLIGHTING_TEXT = `NO MOONLIGHTING / EXCLUSIVE DEDICATION POLICY (PLACEHOLDER)

While employed by or contracted to the Company, you agree:

1. To devote your full professional time, attention, and effort during working
   hours exclusively to your duties for the Company.

2. NOT to engage in any other employment, consulting, contracting, freelance,
   or business activity (paid or unpaid) that:
     a) overlaps with your scheduled working hours;
     b) uses any Company time, equipment, network, accounts, or facilities;
     c) involves a Company customer, supplier, or competitor;
     d) creates a conflict of interest with your duties to the Company; or
     e) impairs your ability to perform those duties.

3. To disclose, in writing and BEFORE commencing the activity, any outside
   personal project, side venture, advisory role, board membership, or
   significant volunteer commitment, so the Company can evaluate any conflict.
   The Company may approve, condition, or refuse such activity in its
   reasonable discretion.

4. That use of Company time, computers, accounts, or networks for any outside
   activity is a material breach of this policy and your engagement, and may
   constitute a misappropriation of Company resources.

5. Violation of this policy may result in disciplinary action up to and
   including termination, recovery of any compensation paid for time not
   devoted to the Company, and other remedies available at law.

By signing, you affirm that you understand and will comply with this policy.`;

const CODE_OF_CONDUCT_TEXT = `CODE OF CONDUCT (PLACEHOLDER)

You agree to:

1. Treat colleagues, clients, and partners with respect, professionalism, and
   honesty regardless of role, background, identity, or seniority.

2. Maintain a workplace free of harassment, discrimination, retaliation, and
   bullying. Report any such conduct you witness or experience promptly to
   your manager, HR, or the designated reporting channel.

3. Avoid conflicts of interest; promptly disclose any relationship,
   investment, or activity that could reasonably be perceived as compromising
   your objectivity or loyalty to the Company.

4. Comply with all applicable laws, including anti-bribery, anti-corruption,
   data-protection, export-control, and trade-sanction regulations.

5. Use Company systems and data only for authorized business purposes; respect
   the privacy of colleagues, clients, and counterparties.

6. Cooperate with internal investigations and audits in good faith.

By signing, you commit to upholding these standards.`;

const ACCEPTABLE_USE_TEXT = `ACCEPTABLE USE OF COMPANY RESOURCES (PLACEHOLDER)

1. Company-provided devices, accounts, software licenses, and network access
   are for authorized work purposes. Incidental personal use is permitted only
   to the extent it does not interfere with your duties, consume meaningful
   Company resources, or violate any other policy.

2. You will not install unauthorized software, disable security controls,
   share credentials, or grant access to Company systems to any third party
   without written authorization.

3. Email, messaging, and document-storage tools provided by the Company may
   be monitored, logged, and audited; you have no expectation of privacy in
   them with respect to legitimate Company oversight, subject to applicable
   law.

4. You will not use Company resources for: illegal activity; harassment;
   excessive personal commerce; cryptocurrency mining; gambling; pornography;
   or any activity that would reflect poorly on the Company.

5. Lost or stolen devices, suspected account compromises, and any actual or
   suspected security incident must be reported to the security/IT team
   immediately upon discovery.

By signing, you agree to use Company resources responsibly.`;

const SECURITY_BASICS_TEXT = `DATA SECURITY BASICS (PLACEHOLDER)

You agree to follow these baseline practices:

1. Use a strong, unique password for every Company account, stored only in
   the Company-approved password manager. Enable multi-factor authentication
   on every system that supports it.

2. Lock your screen whenever you step away from your device. Do not share
   logged-in sessions with anyone.

3. Do not click suspicious links or open unexpected attachments. Report
   suspected phishing to the security team and do not forward the email to
   colleagues.

4. Encrypt portable storage and disk drives on Company devices. Do not store
   client or production data on personal devices.

5. Apply Company-provided OS and software updates promptly. Do not run
   end-of-life or unpatched systems for Company work.

6. Production credentials, API keys, and access tokens must never be
   committed to source control, pasted into chat, or stored in plain text.
   Use the Company-approved secrets manager.

7. Report any suspected breach, leak, or anomaly to the security team
   immediately. Time matters; do not wait to "figure it out" first.

By signing, you commit to following these practices.`;

// ─── Module content (CMS-style content blocks) ───
//
// Each module is a JSON array of CmsContentBlock-shaped blocks (same shape
// CmsBlog.content uses). The frontend reuses RichContentEditor's read-only
// renderer to display them.

function moduleBlocks(intro: string, points: string[], summary: string) {
  return [
    {
      id: 'b1',
      type: 'paragraph',
      data: { text: intro, alignment: 'left' },
    },
    {
      id: 'b2',
      type: 'header',
      data: { text: 'Key points', level: 3, alignment: 'left' },
    },
    {
      id: 'b3',
      type: 'list',
      data: { style: 'unordered', items: points },
    },
    {
      id: 'b4',
      type: 'header',
      data: { text: 'Summary', level: 3, alignment: 'left' },
    },
    {
      id: 'b5',
      type: 'paragraph',
      data: { text: summary, alignment: 'left' },
    },
  ];
}

const courseInput: CreateCourseInput = {
  slug: 'employee-onboarding-2026',
  title: 'Employee Onboarding — Confidentiality, IP, Conduct & Security',
  description:
    'Mandatory orientation for all new internal hires. Read each module, pass the comprehension quizzes, then sign each policy individually. All signatures are recorded with timestamp, IP, and user-agent for legal audit.',
  version: 1,
  isMandatoryOnHire: true,
  passingScore: 80,
  // Re-acknowledgment cadence: annual (365 days from completion). The
  // OnboardingGate will re-prompt the user automatically when expired; the
  // maintenance job does the bookkeeping.
  acknowledgmentValidityDays: 365,
  applicableRoles: [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.PRODUCT_MANAGER, UserRole.ENGINEER],
  status: CourseStatus.PUBLISHED,
  modules: [
    {
      order: 1,
      title: 'Confidentiality & Non-Disclosure',
      estimatedMinutes: 6,
      contentBlocks: moduleBlocks(
        "This module covers what counts as 'confidential information,' your obligations to protect it, and what happens when those obligations are breached. After this module, you'll sign the Non-Disclosure Agreement.",
        [
          'Confidential information includes code, designs, client lists, internal strategy, and anything a reasonable person would understand to be sensitive.',
          'You may not copy, share, transmit, or store confidential information outside Company-approved systems.',
          'Confidentiality obligations survive the end of your engagement and continue indefinitely for trade secrets.',
          'Violations can lead to civil and criminal liability under trade-secret and copyright law.',
        ],
        'When in doubt, treat information as confidential and ask before sharing. The cost of a moment of caution is far less than the cost of an inadvertent disclosure.',
      ),
      quiz: {
        passingScore: 80,
        questions: [
          {
            order: 1,
            prompt: 'Which of the following counts as confidential information?',
            type: 'MULTIPLE_CHOICE',
            options: [
              { id: 'a', label: 'Source code in a private repository', isCorrect: true },
              { id: 'b', label: 'A blog post the Company has published publicly', isCorrect: false },
              { id: 'c', label: 'A product feature already announced on the website', isCorrect: false },
              { id: 'd', label: 'Generally known industry facts', isCorrect: false },
            ],
            explanation: 'Confidential information is information not publicly known. Public marketing material is not confidential.',
          },
          {
            order: 2,
            prompt: 'Confidentiality obligations end the moment you stop working for the Company.',
            type: 'TRUE_FALSE',
            options: [
              { id: 'true', label: 'True', isCorrect: false },
              { id: 'false', label: 'False', isCorrect: true },
            ],
            explanation: 'Confidentiality obligations survive the end of engagement and continue indefinitely for trade secrets.',
          },
          {
            order: 3,
            prompt: 'A friend asks you to "just send them" a copy of the Company\'s production code so they can "take a quick look." What do you do?',
            type: 'SCENARIO',
            options: [
              { id: 'a', label: 'Send it; they promised not to share it', isCorrect: false },
              { id: 'b', label: 'Refuse and report the request to your manager', isCorrect: true },
              { id: 'c', label: 'Send only a small portion', isCorrect: false },
              { id: 'd', label: 'Paste it into a personal cloud drive first', isCorrect: false },
            ],
            explanation: 'Source code is confidential. Sharing any portion outside authorized channels is a violation regardless of the recipient\'s assurances.',
          },
        ],
      },
    },
    {
      order: 2,
      title: 'Intellectual Property Assignment',
      estimatedMinutes: 5,
      contentBlocks: moduleBlocks(
        'Anything you create as part of your work — code, designs, documents, inventions — is "work product" and belongs to the Company. This module explains the scope of that assignment and the narrow exceptions.',
        [
          'Work product includes anything created during engagement that relates to the Company\'s business or uses Company resources.',
          'IP rights transfer to the Company at the moment of creation, not at some later date.',
          'You must disclose pre-existing inventions you wish to exclude in writing at the start of your engagement.',
          'Personal projects done entirely on your own time, with your own equipment, that don\'t relate to the Company\'s business are typically excluded — but disclose to be safe.',
        ],
        'IP assignment is the cornerstone of working at any technology company. Understanding it protects both you and the Company.',
      ),
      quiz: {
        passingScore: 80,
        questions: [
          {
            order: 1,
            prompt: 'When does ownership of work product you create transfer to the Company?',
            type: 'MULTIPLE_CHOICE',
            options: [
              { id: 'a', label: 'Only when you submit a formal assignment form', isCorrect: false },
              { id: 'b', label: 'At the moment of creation', isCorrect: true },
              { id: 'c', label: 'When the Company files a patent', isCorrect: false },
              { id: 'd', label: 'When you receive your next paycheck', isCorrect: false },
            ],
            explanation: 'IP assignment under your engagement agreement is effective at the moment of creation, not later.',
          },
          {
            order: 2,
            prompt: 'You build a small open-source library on the weekend, on your own laptop, that has nothing to do with Company business. The Company automatically owns it.',
            type: 'TRUE_FALSE',
            options: [
              { id: 'true', label: 'True', isCorrect: false },
              { id: 'false', label: 'False', isCorrect: true },
            ],
            explanation: 'Off-hours, off-equipment, off-business-scope projects typically remain yours — but always disclose to confirm.',
          },
        ],
      },
    },
    {
      order: 3,
      title: 'No Moonlighting on Company Time',
      estimatedMinutes: 5,
      contentBlocks: moduleBlocks(
        "Your working hours, Company devices, and Company accounts are reserved for Company work. This module explains what's allowed, what isn't, and how to disclose outside activities properly.",
        [
          'No outside paid or unpaid work during scheduled working hours.',
          'No use of Company computer, network, or accounts for outside work, ever.',
          'No work for Company customers, suppliers, or competitors without written approval.',
          'Outside personal projects, advisory roles, or side ventures must be disclosed in writing before starting.',
        ],
        'A short conversation with your manager beforehand prevents long disputes later. Disclose, don\'t hide.',
      ),
      quiz: {
        passingScore: 80,
        questions: [
          {
            order: 1,
            prompt: 'Which of these is NOT allowed?',
            type: 'MULTIPLE_CHOICE',
            options: [
              { id: 'a', label: 'Working on a freelance contract using your Company laptop on a weekend', isCorrect: true },
              { id: 'b', label: 'Reading a book during your lunch break', isCorrect: false },
              { id: 'c', label: 'Volunteering at a local non-profit on weekends, on your own laptop', isCorrect: false },
              { id: 'd', label: 'Writing a personal blog at night after hours', isCorrect: false },
            ],
            explanation: 'Use of Company equipment for outside paid work is a clear violation, even on weekends.',
          },
          {
            order: 2,
            prompt: 'You receive a paid consulting offer from another company in your field. What\'s the right next step?',
            type: 'SCENARIO',
            options: [
              { id: 'a', label: 'Accept it quietly; do the work outside business hours', isCorrect: false },
              { id: 'b', label: 'Disclose it to your manager in writing first and wait for a decision', isCorrect: true },
              { id: 'c', label: 'Accept and tell HR after a few months if it\'s going well', isCorrect: false },
              { id: 'd', label: 'It\'s your personal life — no need to disclose', isCorrect: false },
            ],
            explanation: 'Outside paid engagements that touch your professional field must be disclosed in advance so the Company can evaluate any conflict.',
          },
        ],
      },
    },
    {
      order: 4,
      title: 'Code of Conduct',
      estimatedMinutes: 4,
      contentBlocks: moduleBlocks(
        'A respectful, professional, ethical workplace isn\'t the responsibility of HR — it\'s the responsibility of every team member. This module covers our baseline expectations.',
        [
          'Treat everyone with respect, regardless of role or seniority.',
          'Zero tolerance for harassment, discrimination, retaliation, and bullying.',
          'Disclose conflicts of interest promptly.',
          'Comply with applicable laws including anti-bribery and data-protection.',
          'Use Company data only for authorized business purposes.',
        ],
        'When you see something off, say something. Reporting in good faith is protected and encouraged.',
      ),
      quiz: {
        passingScore: 80,
        questions: [
          {
            order: 1,
            prompt: 'You witness a senior teammate making repeated demeaning comments to a junior colleague. What should you do?',
            type: 'SCENARIO',
            options: [
              { id: 'a', label: 'Stay out of it; it\'s not your problem', isCorrect: false },
              { id: 'b', label: 'Report the conduct to your manager, HR, or the designated reporting channel', isCorrect: true },
              { id: 'c', label: 'Confront the senior teammate publicly', isCorrect: false },
              { id: 'd', label: 'Wait to see if it happens again before doing anything', isCorrect: false },
            ],
            explanation: 'Reporting workplace harassment promptly is the expected — and protected — course of action.',
          },
          {
            order: 2,
            prompt: 'A vendor offers you a personal gift worth several hundred dollars before a contract negotiation. Acceptable?',
            type: 'TRUE_FALSE',
            options: [
              { id: 'true', label: 'Acceptable', isCorrect: false },
              { id: 'false', label: 'Not acceptable; disclose and decline', isCorrect: true },
            ],
            explanation: 'Significant gifts during active business decisions create at minimum the appearance of a conflict and must be declined and disclosed.',
          },
        ],
      },
    },
    {
      order: 5,
      title: 'Acceptable Use of Company Resources',
      estimatedMinutes: 4,
      contentBlocks: moduleBlocks(
        'Your laptop, accounts, network access, and software licenses are tools entrusted to you. This module covers what they can and can\'t be used for, and how to handle incidents.',
        [
          'Company resources are for work; incidental personal use is OK if it doesn\'t interfere with duties or violate policy.',
          'Don\'t install unauthorized software or disable security controls.',
          'Don\'t share credentials or grant external access without authorization.',
          'Lost or compromised devices must be reported immediately.',
        ],
        'Treat the Company\'s tools the way you\'d want a teammate to treat yours.',
      ),
      quiz: {
        passingScore: 80,
        questions: [
          {
            order: 1,
            prompt: 'Your laptop was stolen from a coffee shop. The right time to report it is:',
            type: 'MULTIPLE_CHOICE',
            options: [
              { id: 'a', label: 'Immediately, even if it\'s evening or weekend', isCorrect: true },
              { id: 'b', label: 'The next business day', isCorrect: false },
              { id: 'c', label: 'After you finish the police report', isCorrect: false },
              { id: 'd', label: 'After you replace it', isCorrect: false },
            ],
            explanation: 'Time matters. Reporting immediately allows IT/security to remotely revoke sessions and reduce exposure.',
          },
          {
            order: 2,
            prompt: 'It\'s OK to share your Company login with your spouse so they can quickly check something for you.',
            type: 'TRUE_FALSE',
            options: [
              { id: 'true', label: 'True', isCorrect: false },
              { id: 'false', label: 'False', isCorrect: true },
            ],
            explanation: 'Credentials are personal and non-transferable, no exceptions.',
          },
        ],
      },
    },
    {
      order: 6,
      title: 'Data Security Basics',
      estimatedMinutes: 5,
      contentBlocks: moduleBlocks(
        'Most security breaches happen through everyday lapses — phishing emails, weak passwords, or credentials in chat. This module covers the basics that prevent the vast majority of incidents.',
        [
          'Use a strong, unique password for every account; store them in the Company password manager; enable MFA everywhere.',
          'Lock your screen when you step away. Don\'t share logged-in sessions.',
          'Be skeptical of unexpected attachments and links. Report phishing.',
          'Never paste production secrets into chat or commit them to source control.',
          'Apply OS and software updates promptly.',
          'Report suspected incidents immediately — even if you\'re not sure.',
        ],
        'Security is a team activity. The faster you report a possible incident, the smaller it stays.',
      ),
      quiz: {
        passingScore: 80,
        questions: [
          {
            order: 1,
            prompt: 'You receive an email asking you to "verify your password" via a link. What do you do?',
            type: 'SCENARIO',
            options: [
              { id: 'a', label: 'Click the link and enter your password', isCorrect: false },
              { id: 'b', label: 'Reply asking who sent it', isCorrect: false },
              { id: 'c', label: 'Don\'t click; report to the security team and delete', isCorrect: true },
              { id: 'd', label: 'Forward it to your team to ask if it\'s legit', isCorrect: false },
            ],
            explanation: 'Phishing links must not be clicked, even to "check." Forwarding to colleagues spreads risk. Report and delete.',
          },
          {
            order: 2,
            prompt: 'It\'s acceptable to commit a Company API key into a private GitHub repo since the repo is private.',
            type: 'TRUE_FALSE',
            options: [
              { id: 'true', label: 'True', isCorrect: false },
              { id: 'false', label: 'False', isCorrect: true },
            ],
            explanation: 'Secrets in source control — public or private — are a common breach vector. Use the secrets manager.',
          },
          {
            order: 3,
            prompt: 'Multi-factor authentication should be enabled:',
            type: 'MULTIPLE_CHOICE',
            options: [
              { id: 'a', label: 'On every account that supports it', isCorrect: true },
              { id: 'b', label: 'Only on financial accounts', isCorrect: false },
              { id: 'c', label: 'Only on personal accounts', isCorrect: false },
              { id: 'd', label: 'Only when IT mandates it', isCorrect: false },
            ],
            explanation: 'MFA is the single most effective control against credential theft. Enable it everywhere.',
          },
        ],
      },
    },
  ],
  documents: [
    { slug: 'nda', title: 'Non-Disclosure Agreement', bodyText: NDA_TEXT, order: 1 },
    { slug: 'ip-assignment', title: 'Intellectual Property Assignment', bodyText: IP_ASSIGNMENT_TEXT, order: 2 },
    { slug: 'no-moonlighting', title: 'No Moonlighting / Exclusive Dedication', bodyText: NO_MOONLIGHTING_TEXT, order: 3 },
    { slug: 'code-of-conduct', title: 'Code of Conduct', bodyText: CODE_OF_CONDUCT_TEXT, order: 4 },
    { slug: 'acceptable-use', title: 'Acceptable Use of Company Resources', bodyText: ACCEPTABLE_USE_TEXT, order: 5 },
    { slug: 'security-basics', title: 'Data Security Basics', bodyText: SECURITY_BASICS_TEXT, order: 6 },
  ],
};

export async function seedOnboardingCourse() {
  // Idempotent: if the course at this slug already exists, do nothing.
  // (Re-running the seed shouldn't duplicate. To bump the course, edit the
  // course in the admin UI and increment its version, or write a separate
  // migration script.)
  const existing = await prisma.course.findUnique({ where: { slug: courseInput.slug } });
  if (existing) {
    console.log(`✔ Course "${courseInput.slug}" already exists (id=${existing.id}); skipping.`);
    return existing;
  }

  console.log(`Seeding onboarding course "${courseInput.slug}"…`);
  const course = await createCourse(courseInput);
  console.log(`✔ Created course id=${course.id} (${courseInput.modules.length} modules, ${courseInput.documents.length} documents)`);
  return course;
}
