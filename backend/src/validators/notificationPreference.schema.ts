import { z } from 'zod';
import { KNOWN_NOTIFICATION_TYPES } from '../constants/notificationTypes';

/**
 * Notification-preference validators.
 *
 * The `type` field is validated against the authoritative list from
 * `constants/notificationTypes.ts`. A typo (`task_assigned_` vs
 * `task_assigned`) is rejected at the validator boundary before it
 * can persist in `notification_preferences.type` — keeps the table
 * clean of dead keys that the FE would never render.
 *
 * Refine over enum so we don't have to regenerate the Zod schema
 * every time we add a notification type (the const-array source of
 * truth grows; the Zod schema reads from it via refine).
 */

const knownType = z.string().refine(
  (t) => KNOWN_NOTIFICATION_TYPES.has(t),
  (t) => ({ message: `Unknown notification type: ${t}` }),
);

export const setPreferenceSchema = z.object({
  params: z.object({
    type: knownType,
  }),
  body: z.object({
    muted: z.boolean(),
  }),
});

export const bulkUpdatePreferencesSchema = z.object({
  body: z.object({
    preferences: z
      .array(
        z.object({
          type: knownType,
          muted: z.boolean(),
        }),
      )
      // Cap the batch so a buggy or malicious caller can't ship a
      // 10MB list of preferences. The genuine UI has ~26 toggles
      // today and adding more would be a deliberate feature change.
      .max(100),
  }),
});
