import { z } from 'zod';
import { UserRole } from '@prisma/client';

export const updateRoleSchema = z.object({
  params: z.object({
    role: z.nativeEnum(UserRole),
  }),
  body: z.object({
    permissions: z.array(
      z.object({
        permissionId: z.string().uuid(),
        granted: z.boolean(),
      })
    ),
  }),
});
