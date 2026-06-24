import { MilestoneStatus } from '@prisma/client';
import prisma from '../config/database';

const MILESTONES_BY_PROJECT: Record<string, { title: string; date: Date; status: MilestoneStatus; clientVisible: boolean }[]> = {
  'furix-ai': [
    { title: 'MVP Demo Internal', date: new Date('2026-05-15'), status: MilestoneStatus.UPCOMING, clientVisible: false },
    { title: 'Beta Launch (100 users)', date: new Date('2026-07-01'), status: MilestoneStatus.UPCOMING, clientVisible: true },
    { title: 'Architecture Review Complete', date: new Date('2026-02-28'), status: MilestoneStatus.COMPLETED, clientVisible: false },
  ],
  'rozcar': [
    { title: 'Alpha Release (Delhi NCR)', date: new Date('2026-04-30'), status: MilestoneStatus.UPCOMING, clientVisible: true },
    { title: 'Payment Integration Complete', date: new Date('2026-05-15'), status: MilestoneStatus.UPCOMING, clientVisible: true },
    { title: 'Design System Finalized', date: new Date('2026-02-15'), status: MilestoneStatus.COMPLETED, clientVisible: false },
  ],
  'hpcl-analytics': [
    { title: 'Phase 1 Delivery', date: new Date('2025-12-31'), status: MilestoneStatus.COMPLETED, clientVisible: true },
    { title: 'Mobile App Launch', date: new Date('2026-05-30'), status: MilestoneStatus.UPCOMING, clientVisible: true },
    { title: 'Phase 2 - Predictive Analytics', date: new Date('2026-03-15'), status: MilestoneStatus.COMPLETED, clientVisible: true },
  ],
  'bountipos': [
    { title: 'Offline Mode MVP', date: new Date('2026-04-15'), status: MilestoneStatus.MISSED, clientVisible: false },
    { title: 'UPI Integration Complete', date: new Date('2026-05-01'), status: MilestoneStatus.UPCOMING, clientVisible: false },
  ],
  'manacalendar': [
    { title: 'Beta Release', date: new Date('2026-04-01'), status: MilestoneStatus.COMPLETED, clientVisible: false },
    { title: 'App Store Launch', date: new Date('2026-04-30'), status: MilestoneStatus.UPCOMING, clientVisible: false },
  ],
  'clawmates-adk': [
    { title: 'API Specification Complete', date: new Date('2026-04-15'), status: MilestoneStatus.UPCOMING, clientVisible: false },
    { title: 'SDK v0.1 Release', date: new Date('2026-06-30'), status: MilestoneStatus.UPCOMING, clientVisible: false },
  ],
  'neerati': [
    { title: 'Weaver Onboarding Pilot (10 weavers)', date: new Date('2026-05-01'), status: MilestoneStatus.UPCOMING, clientVisible: false },
    { title: 'Marketplace Launch', date: new Date('2026-07-15'), status: MilestoneStatus.UPCOMING, clientVisible: false },
  ],
  'dhandhaphone': [
    { title: 'Hardware Prototype v1', date: new Date('2026-09-01'), status: MilestoneStatus.UPCOMING, clientVisible: false },
  ],
};

export async function seedMilestones(projectMap: Map<string, string>) {
  console.log('Seeding milestones...');
  let count = 0;

  for (const [slug, milestones] of Object.entries(MILESTONES_BY_PROJECT)) {
    const projectId = projectMap.get(slug);
    if (!projectId) continue;

    for (const ms of milestones) {
      await prisma.milestone.create({
        data: { ...ms, projectId, isSeedData: true },
      });
      count++;
    }
  }

  console.log(`Seeded ${count} milestones`);
}
