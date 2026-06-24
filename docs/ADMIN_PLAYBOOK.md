# Admin Playbook — User Onboarding & Security

This guide is for admins (anyone with the `user.create` permission) running day-to-day account work on the Exargen Command Center.

## TL;DR

| Action                    | Path / endpoint                                           | Notes |
|---------------------------|-----------------------------------------------------------|-------|
| Add a new user            | Admin → **Users** → "New user"                            | Sets initial password yourself. Password policy enforced server-side. |
| Remove a user             | Admin → **Users** → row → 🗑 deactivate icon              | Soft delete. All sessions die immediately. |
| Reset someone's password  | Admin → **Users** → row → ✏ Edit → "Reset Password" button (bottom-left of edit modal) | Sessions die immediately. Tell them the new password through a side-channel. |
| User changes own password | Profile menu → "Change password"                          | Requires current password. Kills every other session of theirs. |
| Forgot password recovery  | _Currently admin-driven only_ — see §3                    | No email-link flow yet. |
| Inactivity logout         | After 15 min idle, with a 60s warning interstitial        | Automatic. |
| Account lockout           | After 5 failed logins → 15-min lockout                    | Per-account, not per-IP. |

---

## 1. Onboarding a new user

### 1a. Create the account

1. Go to **Users** (admin sidebar). You need the `user.create` permission — `ADMIN` and `SUPER_ADMIN` have it by default.
2. Click **"New user"**. Fields:
   - **Name** — display name across the app (`Karthik S`, not `karthiks`).
   - **Email** — used for login. Must be unique. Capped at 254 chars (RFC 5321).
   - **Role** — `SUPER_ADMIN`, `ADMIN`, `PRODUCT_MANAGER`, `ENGINEER`, or `CLIENT`. Picks the dashboard they land on after login plus the default permission set.
   - **Password** — must satisfy the policy (see §6). Type it; the user changes it themselves on first login if they want to.
   - **Company** — optional. Required convention for `CLIENT` users so the dashboard can scope their view.
   - **Project assignments** (optional) — pick the projects they should be a member of, with a per-project role (an engineer can be `ENGINEER` on Project A and `PRODUCT_MANAGER` on Project B).
3. Click **Create**. The new user is active immediately. They can log in right now.

### 1b. Tell the user how to log in

Send them, via Slack/email/Signal — **not the app** since they don't have access yet:

```
URL:      https://<your-domain>/login
Email:    <their email>
Password: <the password you set>

After logging in, click your name (top right) → "Change password" to set your own.
```

Make it clear: the temporary password works once and they should rotate it on first login.

### 1c. Verify they're set up

- Have them log in once.
- Confirm the dashboard they land on is the one for their role.
- If the role is wrong: edit the user, change role, ask them to log out + back in (so the role is re-fetched into the JWT).

---

## 2. Removing a user (offboarding)

1. Go to **Users**, find the row, click **Deactivate**.
2. What happens, instantly:
   - `isActive` flips to `false`. They cannot log in again.
   - Every refresh token they hold is revoked. `tokenVersion` is bumped, which kills every still-valid access token at the next request.
   - Their existing tasks, comments, status updates, and attachments **stay**. Authorship is preserved for the audit trail. Removed-from-project tasks have their `assigneeId` set to `null` so they don't keep showing up in dashboard filters.
3. To re-instate later: this requires a manual DB toggle today (`UPDATE users SET "isActive" = true WHERE email = '…'`). A "reactivate" button is a small follow-up if it becomes a real workflow.
4. If you also need to **purge** their access from a single project without deactivating the whole account: open the project → **Members** → remove the row. This NULLs their assignment on every task in that project (with an audit trail) and drops their membership; their account stays alive everywhere else.

> **Important**: deactivating a user does NOT delete their authored data. We never hard-delete identity rows because referential audit (`who created this task in 2024-04`) breaks otherwise.

---

## 3. Password reset

There are three ways a password gets changed on this system. Know which one you're using.

### 3a. User changes their own (the normal case)

- Profile menu → **Change password**.
- Requires the current password. Kills every other session.
- Validates the new value against the password policy.

### 3b. Admin resets someone else's

- Admin → **Users** → click ✏ **Edit** on the user's row → click the **Reset Password** button at the bottom-left of the edit modal.
- You type the new value (must satisfy the policy in §6). The user is told via side-channel.
- All of that user's sessions die immediately.
- Use this for: forgotten-password recovery, suspected compromise, post-departure cleanup.

### 3c. There is no email-link "forgot password" flow

We didn't ship one because we don't yet have transactional email wired up. Until that lands:
- Pin a Slack channel where users can DM `#it-help` "I forgot my password".
- An admin runs §3b; tells the user the new value.
- This is OK for a small team but not scalable past 30–40 users — the "wire SMTP + add /auth/forgot-password" follow-up is in the backlog.

### 3d. The admin themselves forgot their password

- If there are at least two admins, ask the other one to reset yours via §3b.
- If you're the only admin: SSH to the host, run `cd backend && npx tsx scripts/reset-admin-password.ts` (in this repo). It generates a fresh 20-char password, prints it once, revokes every session for `admin@exargen.in`. Capture it immediately — the script never prints it again.
- For a different email: `npx tsx scripts/reset-admin-password.ts other@email.com`.

---

## 4. Inactivity logout (15 minutes)

- Logged-in users who do nothing in their tab for 14 minutes see a warning modal: "Are you still here? Signing you out in 0:60." Two buttons: **Stay signed in** / **Sign out now**.
- If they don't click within 60 seconds, the app automatically signs them out and redirects to `/login`.
- The timer resets on any of: mouse movement, keystroke, scroll, click, tab focus, or touch event.
- Activity in any tab resets the timer in every tab (BroadcastChannel).
- Activity events while the tab is hidden are ignored — leaving the laptop closed doesn't keep the session alive forever.
- The implementation is in `frontend/src/hooks/useInactivityLogout.ts`. Constants `INACTIVITY_TIMEOUT_MS` and `INACTIVITY_WARNING_MS` are exported there if you ever need to tune them.

---

## 5. Account lockout (failed logins)

- After **5 failed login attempts** within a 15-minute rolling window, the account locks for **15 minutes**.
- Lockout is per-account, not per-IP. An attacker with a list of emails still can't brute-force individual accounts.
- The bcrypt compute is short-circuited during lockout, so a botnet can't burn server CPU on a locked account.
- Login responses for unknown emails run a dummy bcrypt to make the response time look identical to a real-but-wrong password. Closes the timing-side-channel that would otherwise enumerate which emails exist.

To unlock manually before the 15 min elapses: have an admin run §3b. Resetting the password also clears `failedLoginCount` and `lockedUntil`.

---

## 6. Password policy

Server-enforced. Same rules apply to admin-set passwords AND user-changed passwords — admins cannot weaken the policy by setting a 4-char password "for convenience".

| Rule        | Value               |
|-------------|---------------------|
| Minimum length | 10 chars         |
| Maximum length | 200 chars (anti-DoS for bcrypt) |
| Uppercase   | At least one (A-Z)  |
| Lowercase   | At least one (a-z)  |
| Digit       | At least one (0-9)  |
| Symbol      | At least one (`!@#$%^&*` etc.) |

The seed `Admin@1234` was chosen so dev workflows pass the policy; rotate it via §3d before anyone real uses the system.

---

## 6.5 Super-admin armor (the founder is the bedrock)

The `SUPER_ADMIN` role anchors the permission system. Pankaj (the founder) holds it as the canonical super-admin and the sole approver for company-wide actions like leave. The system enforces these invariants on every privileged user mutation, both at the route layer and inside the service:

| Action | Who can do it |
|---|---|
| Create a new SUPER_ADMIN | Only an active SUPER_ADMIN |
| Promote ADMIN → SUPER_ADMIN | Only an active SUPER_ADMIN |
| Demote SUPER_ADMIN → anything else | Only an active SUPER_ADMIN, AND only if at least one other active SUPER_ADMIN remains |
| Edit any field on a SUPER_ADMIN's user row (name, email, company) | Only an active SUPER_ADMIN |
| Reset a SUPER_ADMIN's password | Only an active SUPER_ADMIN (so an ADMIN can never lock the founder out) |
| Deactivate a SUPER_ADMIN | Only an active SUPER_ADMIN, AND only if at least one other active SUPER_ADMIN remains |
| Reactivate a previously-deactivated SUPER_ADMIN | Only an active SUPER_ADMIN |
| Self-deactivate any account | Refused. Ask another admin. |

Failure mode for the "lights-out attack" (deactivating or demoting the last SUPER_ADMIN): the operation is refused with an error pointing the operator to "promote another user to Super Admin first." The check counts other active SUPER_ADMINs at the moment of the call, so it stays correct even if multiple admins act concurrently.

Audit trail: every action targeting a SUPER_ADMIN sets `details.targetWasSuperAdmin: true` and, on role changes, includes the from/to roles. Filter the admin Activity Feed for `targetWasSuperAdmin` to surface every attempted privilege escalation.

If you genuinely need to retire the only super-admin (e.g. handing the company over): promote a successor first via Admin → Users → Edit → Role → Super Admin, sign-off with that account, then retire the previous holder.

---

## 7. Security baseline (one-pager for whoever audits this)

- **JWT access tokens**: 15-minute TTL, in-memory only (never localStorage), HMAC-SHA-256 signed. Refresh on every meaningful response interceptor 401.
- **Refresh tokens**: 7-day TTL, stored as httpOnly + secure cookies in production, rotated on every refresh, reuse-detection bumps `tokenVersion` and revokes the entire chain.
- **Account lockout**: §5.
- **Origin guard**: every state-changing request (POST/PUT/PATCH/DELETE) requires a same-origin `Origin` or `Referer` header. Webhooks and public CMS routes are explicit carve-outs.
- **Rate limits**: 5 logins / 15 min, 30 refreshes / 15 min, 100 general / 60s in production (higher in dev).
- **Helmet**: HSTS, X-Frame-Options DENY, Referrer-Policy, no-sniff, full CSP in production.
- **Cookies**: `SameSite=Lax` + `httpOnly` + `Secure` in production.
- **Body size limits**: 8 KB on `/auth/*` (so a 25 MB email payload can't burn bcrypt CPU before validation), 25 MB elsewhere.
- **Prototype pollution**: every parsed JSON body is recursively scanned and `__proto__` / `constructor` / `prototype` keys are deleted before any handler sees the payload.
- **Audit log**: every privileged action (user create, deactivate, password reset, project member add/remove, GitHub integration connect/disconnect) writes a row in `activities` with actor, target, and details. Visible in admin → Activity Feed.

---

## 8. When to escalate to engineering

- "I forgot my password and I'm the sole super-admin" → §3d, then post-mortem so it doesn't happen again.
- "A user's account was definitely compromised" → §3b (which kills every session), then check the activity log for what they did while compromised, then rotate any API tokens / GitHub webhook secrets they could have seen.
- "I want to delete a user permanently, including all their data" → file an issue. We don't have a generic GDPR-style purge yet; today this is a hand-rolled migration.
- "We need an email-link forgot-password flow" → file an issue tagged `auth`. The implementation is straightforward (SMTP config + signed time-limited token) but it's a real feature, not a 1-hour change.
