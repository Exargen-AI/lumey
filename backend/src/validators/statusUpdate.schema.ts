import { z } from 'zod';
import { HealthStatus } from '@prisma/client';

export const createStatusUpdateSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    signal: z.nativeEnum(HealthStatus),
    note: z.string().optional(),
  }),
});
