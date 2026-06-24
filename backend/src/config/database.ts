import { PrismaClient } from '@prisma/client';
import { env } from './env';

const prisma = new PrismaClient({
  log:
    env.NODE_ENV === 'development'
      ? [...(env.PRISMA_LOG_QUERIES ? ['query' as const] : []), 'warn', 'error']
      : ['error'],
});

export default prisma;
