import { UserRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import prisma from '../config/database';
import { hashPassword } from '../utils/password';

// Dev/demo only: a single reference agent so runs can be dispatched locally
// without provisioning a real agent. userType=AGENT, non-interactive (a random
// password it never uses — it can't be logged into). Idempotent.
const AGENT_EMAIL = 'agent@lumey.local';

export async function seedReferenceAgent(): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { email: AGENT_EMAIL },
    select: { id: true },
  });
  if (existing) {
    console.log(`  ✔ Reference agent already exists (id=${existing.id}).`);
    return existing.id;
  }

  const passwordHash = await hashPassword(randomBytes(24).toString('hex'));
  const agent = await prisma.user.create({
    data: {
      name: 'Lumey Agent',
      email: AGENT_EMAIL,
      passwordHash,
      role: UserRole.ENGINEER,
      userType: 'AGENT',
      agentRole: 'autonomous-engineer',
      agentActive: true,
      isSeedData: true,
    },
  });
  console.log(`  ✔ Created reference agent (id=${agent.id}).`);
  return agent.id;
}
