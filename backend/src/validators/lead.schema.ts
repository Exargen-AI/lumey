import { z } from 'zod';

export const publicLeadSchema = z.object({
  formType: z.string().trim().min(1),
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  message: z.string().optional(),
  sourcePage: z.string().url().optional(),
  metadata: z.any().optional(),
});

export type PublicLeadPayload = z.infer<typeof publicLeadSchema>;
