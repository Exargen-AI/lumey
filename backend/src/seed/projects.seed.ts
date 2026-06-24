import { ProjectCategory, ProjectPhase, HealthStatus, UserRole } from '@prisma/client';
import prisma from '../config/database';

interface ProjectSeed {
  name: string;
  slug: string;
  description: string;
  clientDescription?: string;
  category: ProjectCategory;
  phase: ProjectPhase;
  healthStatus: HealthStatus;
  tags: string[];
  startDate: Date;
  targetDate: Date;
  members: { email: string; role: UserRole }[];
}

const SEED_PROJECTS: ProjectSeed[] = [
  {
    name: 'Furix AI', slug: 'furix-ai',
    description: 'Multi-modal AI assistant platform with voice, vision, and text capabilities. Built on custom LLM pipeline with RAG retrieval.',
    category: ProjectCategory.FLAGSHIP, phase: ProjectPhase.DEVELOPMENT, healthStatus: HealthStatus.GREEN,
    tags: ['ai', 'mobile', 'llm'],
    startDate: new Date('2026-01-15'), targetDate: new Date('2026-07-30'),
    members: [
      { email: 'ravi@exargen.in', role: UserRole.PRODUCT_MANAGER },
      { email: 'karthik@exargen.in', role: UserRole.ENGINEER },
    ],
  },
  {
    name: 'Clawmates ADK', slug: 'clawmates-adk',
    description: 'Agent Development Kit for building autonomous AI agents. Provides tools, memory, and orchestration primitives.',
    category: ProjectCategory.PLATFORM, phase: ProjectPhase.ARCHITECTURE, healthStatus: HealthStatus.GREEN,
    tags: ['ai', 'sdk', 'agents'],
    startDate: new Date('2026-02-01'), targetDate: new Date('2026-09-15'),
    members: [
      { email: 'ravi@exargen.in', role: UserRole.PRODUCT_MANAGER },
      { email: 'suresh@exargen.in', role: UserRole.ENGINEER },
    ],
  },
  {
    name: 'RozCar', slug: 'rozcar',
    description: 'Peer-to-peer car rental marketplace for Indian cities. Mobile-first with driver verification and insurance integration.',
    clientDescription: 'Car sharing platform connecting vehicle owners with verified renters. Currently in development with core booking flow complete.',
    category: ProjectCategory.B2C_SMB, phase: ProjectPhase.DEVELOPMENT, healthStatus: HealthStatus.YELLOW,
    tags: ['mobile', 'marketplace', 'automotive'],
    startDate: new Date('2025-11-01'), targetDate: new Date('2026-06-30'),
    members: [
      { email: 'ravi@exargen.in', role: UserRole.PRODUCT_MANAGER },
      { email: 'priya@exargen.in', role: UserRole.ENGINEER },
      { email: 'investor@fund.in', role: UserRole.CLIENT },
    ],
  },
  {
    name: 'ManaCalendar', slug: 'manacalendar',
    description: 'Smart calendar app with AI-powered scheduling suggestions. Integrates with Google Calendar, Outlook, and custom workflows.',
    category: ProjectCategory.PASSION, phase: ProjectPhase.TESTING, healthStatus: HealthStatus.GREEN,
    tags: ['productivity', 'mobile', 'ai'],
    startDate: new Date('2025-09-01'), targetDate: new Date('2026-04-15'),
    members: [
      { email: 'karthik@exargen.in', role: UserRole.ENGINEER },
    ],
  },
  {
    name: 'DhandhaPhone', slug: 'dhandhaphone',
    description: 'Ultra-affordable smartphone designed for rural India. Custom Android ROM with offline-first apps and edge AI capabilities.',
    category: ProjectCategory.SOCIAL_IMPACT, phase: ProjectPhase.IDEA, healthStatus: HealthStatus.GREEN,
    tags: ['hardware', 'edge', 'mobile'],
    startDate: new Date('2026-03-01'), targetDate: new Date('2027-01-01'),
    members: [
      { email: 'karthik@exargen.in', role: UserRole.ENGINEER },
      { email: 'suresh@exargen.in', role: UserRole.ENGINEER },
    ],
  },
  {
    name: 'Neerati', slug: 'neerati',
    description: 'Marketplace connecting traditional weavers with global buyers. Includes design tools, inventory management, and logistics.',
    category: ProjectCategory.B2C_SMB, phase: ProjectPhase.DEVELOPMENT, healthStatus: HealthStatus.GREEN,
    tags: ['marketplace', 'weaving', 'social-impact'],
    startDate: new Date('2025-12-01'), targetDate: new Date('2026-08-15'),
    members: [
      { email: 'priya@exargen.in', role: UserRole.ENGINEER },
    ],
  },
  {
    name: 'HPCL Analytics', slug: 'hpcl-analytics',
    description: 'Real-time analytics dashboard for HPCL fuel station network. Monitors inventory, sales trends, and predictive maintenance.',
    clientDescription: 'Analytics platform providing real-time insights into fuel station performance, inventory levels, and sales trends across the network.',
    category: ProjectCategory.CONSULTING, phase: ProjectPhase.LIVE, healthStatus: HealthStatus.GREEN,
    tags: ['analytics', 'enterprise', 'dashboard'],
    startDate: new Date('2025-06-01'), targetDate: new Date('2026-01-31'),
    members: [
      { email: 'priya@exargen.in', role: UserRole.ENGINEER },
      { email: 'pm@hpcl.co.in', role: UserRole.CLIENT },
    ],
  },
  {
    name: 'BountiPOS', slug: 'bountipos',
    description: 'Point-of-sale system for small businesses. Offline-capable with UPI integration, inventory tracking, and GST compliance.',
    category: ProjectCategory.PLATFORM, phase: ProjectPhase.DEVELOPMENT, healthStatus: HealthStatus.RED,
    tags: ['pos', 'payments', 'smb'],
    startDate: new Date('2025-10-01'), targetDate: new Date('2026-05-15'),
    members: [
      { email: 'suresh@exargen.in', role: UserRole.ENGINEER },
    ],
  },
];

export async function seedProjects(userMap: Map<string, string>): Promise<Map<string, string>> {
  console.log('Seeding projects...');
  const projectMap = new Map<string, string>();

  for (const projectData of SEED_PROJECTS) {
    const { members, ...data } = projectData;

    const project = await prisma.project.upsert({
      where: { slug: data.slug },
      create: { ...data, isSeedData: true },
      update: {},
    });

    projectMap.set(data.slug, project.id);

    // Create project memberships
    for (const member of members) {
      const userId = userMap.get(member.email);
      if (userId) {
        await prisma.projectMember.upsert({
          where: { userId_projectId: { userId, projectId: project.id } },
          create: { userId, projectId: project.id, role: member.role },
          update: {},
        });
      }
    }
  }

  console.log(`Seeded ${SEED_PROJECTS.length} projects with members`);
  return projectMap;
}
