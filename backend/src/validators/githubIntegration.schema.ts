import { z } from 'zod';

// Tight character class on owner/repo so the path can never carry a ../
// or other shell-metachar that might end up in a webhook URL.
const ghName = z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/, 'Invalid GitHub name');

export const connectGitHubSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    repoOwner: ghName,
    repoName: ghName,
    autoCloseOnMerge: z.boolean().optional(),
    // Default false so re-saving (e.g. flipping auto-close) doesn't silently
    // rotate the secret and break the live webhook in GitHub. Admins who
    // actually want a fresh secret pass `rotateSecret: true` (the FE's
    // "Rotate webhook secret" button surfaces this).
    rotateSecret: z.boolean().optional(),
  }),
});

export const projectIdParamSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const taskIdParamSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});
