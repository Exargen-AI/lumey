import { z } from 'zod';
import { normalizeEmail } from '../utils/email';

const passwordPolicy = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

// RFC 5321: email local-part max 64, domain max 253; total ≤ 254 in practice.
// Bcrypt itself ignores bytes past 72, so anything longer is wasted hashing
// work — cap before it reaches the comparePassword call.
export const loginSchema = z.object({
  body: z.object({
    // `.transform(normalizeEmail)` runs AFTER `.email()` and `.max()`
    // validate the raw input, so a user typing `John@Exargen.in` is first
    // validated as a syntactically-valid email and then lowercased before
    // the value reaches the handler. Fixes the "case-sensitive login"
    // bug reported 2026-05-21.
    email: z.string().email('Invalid email address').max(254).transform(normalizeEmail),
    password: z.string().min(1, 'Password is required').max(128),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    // currentPassword is just compared against bcrypt — same cap as login.
    // Min still 1 (we don't tell the user "your old password was X chars").
    currentPassword: z.string().min(1, 'Current password is required').max(128),
    newPassword: passwordPolicy,
  }),
});

/**
 * Self-update for the authenticated user's profile. Intentionally narrow —
 * email changes touch the auth identity (and any future SSO mapping) and
 * legalName is locked once captured during onboarding, so neither is
 * editable here. Admin still has the broader `PUT /users/:id` path.
 *
 * Both fields are optional; whichever is present is the patch. An empty
 * body is rejected so the API doesn't accept no-op writes (which would
 * still bump updatedAt and clutter activity logs).
 */
export const updateMeSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'Name cannot be empty').max(80).optional(),
    // null clears the company; '' is normalised to null in the handler.
    company: z.string().max(120).nullable().optional(),
  }).refine(
    (b) => Object.keys(b).length > 0,
    'Provide at least one field to update.',
  ),
});

// Avatar upload. The content-type allowlist + size cap are baked into the
// presigned-PUT signature server-side; these mirror them so a bad request
// fails fast at the edge.
export const avatarUploadUrlSchema = z.object({
  body: z.object({
    contentType: z.enum(['image/png', 'image/jpeg', 'image/webp'], {
      errorMap: () => ({ message: 'Avatar must be a PNG, JPEG, or WebP image' }),
    }),
    sizeBytes: z.number().int().positive().max(5 * 1024 * 1024, 'Avatar must be 5 MB or smaller'),
  }),
});

export const setAvatarSchema = z.object({
  body: z.object({ key: z.string().min(1).max(512) }),
});

export { passwordPolicy };
