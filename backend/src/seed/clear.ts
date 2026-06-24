import { UserRole } from '@prisma/client';
import prisma from '../config/database';

export async function clearSeedData() {
  console.log('Clearing seed data...');

  await prisma.activity.deleteMany({ where: { user: { isSeedData: true } } });
  await prisma.comment.deleteMany({ where: { isSeedData: true } });
  await prisma.statusUpdate.deleteMany({ where: { author: { isSeedData: true } } });
  await prisma.decision.deleteMany({ where: { isSeedData: true } });
  await prisma.milestone.deleteMany({ where: { isSeedData: true } });
  await prisma.task.deleteMany({ where: { isSeedData: true } });
  await prisma.projectMember.deleteMany({ where: { project: { isSeedData: true } } });
  await prisma.project.deleteMany({ where: { isSeedData: true } });
  await prisma.user.deleteMany({ where: { isSeedData: true, role: { not: UserRole.SUPER_ADMIN } } });

  console.log('Seed data cleared');
}
