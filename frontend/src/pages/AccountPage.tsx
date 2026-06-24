import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, KeyRound, Lock, Mail, ShieldCheck, UserCircle, AlertCircle, Loader2, Building2, Clock, Camera } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useAuth } from '@/hooks/useAuth';
import { changePasswordApi, updateMeApi, uploadAvatarApi, removeAvatarApi } from '@/api/auth';
import { UserAvatar } from '@/components/ui';
import {
  useNotificationPreferences,
  useBulkUpdateNotificationPreferences,
} from '@/hooks/useNotificationPreferences';
import type { NotificationPreference, NotificationTypeMeta } from '@/api/notifications';
import { ROLE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/cn';

/**
 * Universal Account page. Works for every authenticated role (admin,
 * PM, engineer, client) — the editable surface is the same:
 *
 *   1. Profile card  — display name + optional company.
 *   2. Identity card — read-only email + role + legal name (the latter
 *      is captured once during onboarding and is admin-managed).
 *   3. Security card — change-password form.
 *
 * Hits PATCH /auth/me for the profile half and PUT /auth/change-password
 * for the security half. After a successful password change the backend
 * has revoked every refresh token; we log the user out so they re-enter
 * with the new credentials.
 */
export function AccountPage() {
  const user = useAuthStore((s) => s.user);
  const { logout } = useAuth();

  if (!user) {
    // Shouldn't happen — ProtectedRoute keeps us off the page when
    // unauthenticated — but guard anyway so the rest can assume a user.
    return null;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-7 animate-fade-in-down">
      <ProfileHero user={user} />

      <ProfileCard user={user} />
      <IdentityCard user={user} />
      <SecurityCard onPasswordChanged={logout} />
      <NotificationPreferencesCard />
    </div>
  );
}

/* ─── Profile hero — at-a-glance identity header ─── */

function ProfileHero({ user }: { user: any }) {
  const roleLabel = ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role;
  const since = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null;

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchUser = (updated: any) =>
    useAuthStore.setState((s) => ({ user: s.user ? { ...s.user, ...updated } : updated }));

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the user re-pick the same file
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Use a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be 5 MB or smaller.');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      patchUser(await uploadAvatarApi(file));
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err?.message || 'Could not update your photo.');
    } finally {
      setUploading(false);
    }
  };

  const onRemove = async () => {
    setError(null);
    setUploading(true);
    try {
      patchUser(await removeAvatarApi());
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not remove your photo.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <header className="rounded-xl border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-panel p-5 sm:p-6 flex items-center gap-5">
      <div className="relative shrink-0">
        <UserAvatar user={user} size="xl" />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-white dark:bg-obsidian-raised border border-gray-200 dark:border-obsidian-border flex items-center justify-center shadow-soft hover:bg-gray-50 dark:hover:bg-obsidian-panel transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          aria-label="Change photo"
          title="Change photo"
        >
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} className="text-gray-500 dark:text-obsidian-muted" />}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={onPick}
        />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg truncate">
            {user.name}
          </h1>
          <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 whitespace-nowrap">
            {roleLabel}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-gray-500 dark:text-obsidian-muted">
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <Mail size={14} className="shrink-0" />
            <span className="truncate">{user.email}</span>
          </span>
          {user.company && (
            <span className="inline-flex items-center gap-1.5">
              <Building2 size={14} className="shrink-0" /> {user.company}
            </span>
          )}
          {since && (
            <span className="inline-flex items-center gap-1.5">
              <Clock size={14} className="shrink-0" /> since {since}
            </span>
          )}
        </div>
        {error ? (
          <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{error}</p>
        ) : user.avatarUrl ? (
          <button
            onClick={onRemove}
            disabled={uploading}
            className="mt-2 text-[12px] text-gray-400 hover:text-rose-600 dark:text-obsidian-faded dark:hover:text-rose-400 transition-colors disabled:opacity-60"
          >
            Remove photo
          </button>
        ) : (
          <p className="mt-2 text-[12px] text-gray-400 dark:text-obsidian-faded">JPG, PNG or WebP, up to 5 MB.</p>
        )}
      </div>
    </header>
  );
}

/* ─── Profile card — editable name + company ─── */

function ProfileCard({ user }: { user: any }) {
  const setAuthUser = useAuthStore((s) => (next: any) => {
    // Merge the patched fields back into the auth-store user. Avoids a
    // /auth/me round trip after every save.
    const state = useAuthStore.getState();
    if (state.user) {
      useAuthStore.setState({ user: { ...state.user, ...next } });
    }
  });
  const [name, setName] = useState(user.name ?? '');
  const [company, setCompany] = useState(user.company ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // If the auth store mutates from elsewhere (e.g. /auth/me refetch),
  // keep the form in sync.
  useEffect(() => { setName(user.name ?? ''); }, [user.name]);
  useEffect(() => { setCompany(user.company ?? ''); }, [user.company]);

  const dirty = name.trim() !== (user.name ?? '') || (company ?? '').trim() !== (user.company ?? '');
  const valid = name.trim().length > 0 && name.trim().length <= 80 && (company ?? '').length <= 120;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || !valid) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const patch: { name?: string; company?: string | null } = {};
      if (name.trim() !== (user.name ?? '')) patch.name = name.trim();
      if ((company ?? '').trim() !== (user.company ?? '')) {
        patch.company = company.trim() === '' ? null : company.trim();
      }
      const result = await updateMeApi(patch);
      setAuthUser(result.user);
      setSaved(true);
      // Auto-hide the success state after a short beat so the card
      // doesn't feel sticky.
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not save changes. Try again?');
    } finally {
      setPending(false);
    }
  };

  return (
    <Card title="Profile" icon={<UserCircle size={16} />}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Display name" htmlFor="acct-name">
          <input
            id="acct-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className={inputCls}
            autoComplete="name"
          />
        </Field>
        <Field label="Company" htmlFor="acct-company" hint="Optional — shown on team pages so clients see who they're working with.">
          <input
            id="acct-company"
            type="text"
            value={company ?? ''}
            onChange={(e) => setCompany(e.target.value)}
            maxLength={120}
            className={inputCls}
            autoComplete="organization"
          />
        </Field>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={!dirty || !valid || pending}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
              dirty && valid && !pending
                ? 'bg-brand-600 hover:bg-brand-700 text-white shadow-soft'
                : 'bg-gray-100 dark:bg-obsidian-raised text-gray-400 dark:text-obsidian-faded cursor-not-allowed',
            )}
          >
            {pending ? 'Saving…' : 'Save changes'}
          </button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-[12px] text-emerald-600 dark:text-emerald-400 animate-fade-in-down">
              <Check size={13} /> Saved
            </span>
          )}
          {error && (
            <span className="inline-flex items-center gap-1 text-[12px] text-rose-600 dark:text-rose-400">
              <AlertCircle size={13} /> {error}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

/* ─── Identity card — read-only — ─── */

function IdentityCard({ user }: { user: any }) {
  const roleLabel = ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role;
  return (
    <Card title="Identity" icon={<ShieldCheck size={16} />}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <ReadOnlyField label="Email" icon={<Mail size={13} />} value={user.email} />
        <ReadOnlyField label="Role" value={roleLabel} />
        <ReadOnlyField
          label="Legal name"
          value={user.legalName ?? 'Not captured yet'}
          muted={!user.legalName}
        />
      </div>
      <p className="mt-4 text-[11px] text-gray-400 dark:text-obsidian-faded">
        Email, role, and legal name are managed by an administrator. Ask them if you need a change here.
      </p>
    </Card>
  );
}

/* ─── Security card — change password ─── */

function SecurityCard({ onPasswordChanged }: { onPasswordChanged: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirrors the backend's passwordPolicy. Showing the rules up front
  // is friendlier than failing on submit.
  const checks = {
    length: next.length >= 10,
    upper: /[A-Z]/.test(next),
    lower: /[a-z]/.test(next),
    digit: /[0-9]/.test(next),
    special: /[^A-Za-z0-9]/.test(next),
  };
  const policyOk = Object.values(checks).every(Boolean);
  const match = next.length > 0 && next === confirm;
  const ready = current.length > 0 && policyOk && match && !pending;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setPending(true);
    setError(null);
    try {
      await changePasswordApi(current, next);
      // Server has revoked every refresh token + bumped tokenVersion —
      // log out so the user re-enters with the new credentials.
      onPasswordChanged();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not change password. Try again?');
      setPending(false);
    }
  };

  return (
    <Card title="Password" icon={<KeyRound size={16} />}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Current password" htmlFor="acct-pw-current">
          <input
            id="acct-pw-current"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            maxLength={128}
            className={inputCls}
            autoComplete="current-password"
            required
          />
        </Field>
        <Field label="New password" htmlFor="acct-pw-new">
          <input
            id="acct-pw-new"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            maxLength={128}
            className={inputCls}
            autoComplete="new-password"
            required
          />
          <PolicyChecklist checks={checks} />
        </Field>
        <Field label="Confirm new password" htmlFor="acct-pw-confirm">
          <input
            id="acct-pw-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            maxLength={128}
            className={inputCls}
            autoComplete="new-password"
            required
          />
          {confirm.length > 0 && !match && (
            <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
              Doesn't match the new password.
            </p>
          )}
        </Field>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={!ready}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
              ready
                ? 'bg-brand-600 hover:bg-brand-700 text-white shadow-soft'
                : 'bg-gray-100 dark:bg-obsidian-raised text-gray-400 dark:text-obsidian-faded cursor-not-allowed',
            )}
          >
            <Lock size={13} />
            {pending ? 'Changing…' : 'Change password'}
          </button>
          {error && (
            <span className="inline-flex items-center gap-1 text-[12px] text-rose-600 dark:text-rose-400">
              <AlertCircle size={13} /> {error}
            </span>
          )}
        </div>

        <p className="mt-2 text-[11px] text-gray-400 dark:text-obsidian-faded">
          You'll be signed out on every device — including this one — after a successful change.
        </p>
      </form>
    </Card>
  );
}

/* ─── Notification preferences card — mute by type ─── */

function NotificationPreferencesCard() {
  const { data, isLoading } = useNotificationPreferences();
  const bulkSave = useBulkUpdateNotificationPreferences();

  // Local edit state — the user toggles freely, then clicks Save.
  // Keep it as a Map keyed by type for O(1) flips.
  const [draft, setDraft] = useState<Map<string, boolean>>(new Map());
  const [saved, setSaved] = useState(false);

  // Seed the draft from the server-side data the first time it arrives.
  // After that, the draft is the source of truth until Save lands.
  useEffect(() => {
    if (!data) return;
    setDraft(new Map(data.preferences.map((p) => [p.type, p.muted])));
  }, [data]);

  // Group types by category for the UI. Memo because the backend's
  // type list is stable across renders.
  const grouped = useMemo<
    Array<{ category: string; meta: { label: string; description: string }; types: NotificationTypeMeta[] }>
  >(() => {
    if (!data) return [];
    const buckets = new Map<string, NotificationTypeMeta[]>();
    for (const t of data.types) {
      const arr = buckets.get(t.category) ?? [];
      arr.push(t);
      buckets.set(t.category, arr);
    }
    return Array.from(buckets.entries()).map(([category, types]) => ({
      category,
      meta: data.categories[category] ?? { label: category, description: '' },
      types,
    }));
  }, [data]);

  // Dirty = any toggle differs from the server-side row. Drives the
  // Save button's enabled state.
  const dirty = useMemo(() => {
    if (!data) return false;
    const serverMap = new Map(data.preferences.map((p) => [p.type, p.muted]));
    for (const [type, muted] of draft.entries()) {
      if (serverMap.get(type) !== muted) return true;
    }
    return false;
  }, [data, draft]);

  const onToggle = (type: string) => {
    setDraft((prev) => {
      const next = new Map(prev);
      next.set(type, !next.get(type));
      return next;
    });
    setSaved(false);
  };

  const onSave = async () => {
    const payload: NotificationPreference[] = Array.from(draft.entries()).map(([type, muted]) => ({ type, muted }));
    await bulkSave.mutateAsync(payload);
    setSaved(true);
  };

  return (
    <Card title="Notifications" icon={<Bell size={16} />}>
      <p className="text-[12.5px] text-gray-500 dark:text-obsidian-muted -mt-1 mb-5">
        Mute anything you'd rather not get pinged about. Everything is on by default — flip a toggle to silence it, then click Save.
      </p>

      {isLoading || !data ? (
        <div className="flex items-center gap-2 text-[12.5px] text-gray-400">
          <Loader2 size={13} className="animate-spin" /> Loading preferences…
        </div>
      ) : (
        <>
          <div className="space-y-6">
            {grouped.map(({ category, meta, types }) => (
              <div key={category}>
                <h3 className="text-[12px] font-semibold text-gray-800 dark:text-obsidian-fg">{meta.label}</h3>
                {meta.description && (
                  <p className="text-[11.5px] text-gray-400 dark:text-obsidian-faded mt-0.5 mb-2.5">{meta.description}</p>
                )}
                <ul className="divide-y divide-gray-100 dark:divide-obsidian-border/40 border border-gray-100 dark:border-obsidian-border/40 rounded-lg overflow-hidden">
                  {types.map((t) => {
                    const muted = draft.get(t.type) ?? false;
                    return (
                      <li key={t.type} className="flex items-start justify-between gap-4 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] text-gray-800 dark:text-obsidian-fg">{t.label}</div>
                          <div className="text-[11.5px] text-gray-400 dark:text-obsidian-faded mt-0.5">{t.description}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onToggle(t.type)}
                          aria-pressed={muted}
                          aria-label={`${muted ? 'Unmute' : 'Mute'} ${t.label}`}
                          className={cn(
                            'shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-medium transition-colors',
                            muted
                              ? 'bg-gray-200 text-gray-600 dark:bg-obsidian-border dark:text-obsidian-muted'
                              : 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200',
                          )}
                        >
                          <Bell size={11} />
                          {muted ? 'Muted' : 'On'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            {saved && !dirty && (
              <span className="text-[12px] text-green-600 dark:text-green-400 flex items-center gap-1">
                <Check size={13} /> Saved
              </span>
            )}
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || bulkSave.isPending}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-medium transition-colors',
                dirty && !bulkSave.isPending
                  ? 'bg-brand-600 text-white hover:bg-brand-700'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-obsidian-border dark:text-obsidian-faded',
              )}
            >
              {bulkSave.isPending && <Loader2 size={13} className="animate-spin" />}
              Save preferences
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

/* ─── Local primitives ───────────────────────────────────────────── */

const inputCls = cn(
  'block w-full rounded-md px-3 py-2 text-[13.5px] transition-colors',
  'bg-white dark:bg-obsidian-bg',
  'border border-gray-200 dark:border-obsidian-border',
  'text-gray-900 dark:text-obsidian-fg',
  'placeholder:text-gray-400 dark:placeholder:text-obsidian-faded',
  'focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-400 dark:focus:border-brand-500/50',
);

function Card({
  title, icon, children,
}: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={cn(
      'rounded-2xl border p-6',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark',
    )}>
      <div className="flex items-center gap-2 mb-5 text-gray-700 dark:text-obsidian-muted">
        {icon}
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Field({
  label, htmlFor, hint, children,
}: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[12px] font-medium text-gray-700 dark:text-obsidian-muted mb-1.5">
        {label}
      </label>
      {children}
      {hint && (
        <p className="mt-1 text-[11px] text-gray-400 dark:text-obsidian-faded">{hint}</p>
      )}
    </div>
  );
}

function ReadOnlyField({
  label, value, icon, muted,
}: { label: string; value: string; icon?: React.ReactNode; muted?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-1.5">
        {label}
      </p>
      <p className={cn(
        'inline-flex items-center gap-1.5 text-[13px] truncate',
        muted ? 'text-gray-400 dark:text-obsidian-faded italic' : 'text-gray-900 dark:text-obsidian-fg',
      )}>
        {icon}
        {value}
      </p>
    </div>
  );
}

function PolicyChecklist({ checks }: { checks: Record<string, boolean> }) {
  const items = [
    { key: 'length',  label: '10+ characters' },
    { key: 'upper',   label: 'An uppercase letter' },
    { key: 'lower',   label: 'A lowercase letter' },
    { key: 'digit',   label: 'A digit' },
    { key: 'special', label: 'A symbol' },
  ];
  return (
    <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
      {items.map((it) => {
        const ok = checks[it.key];
        return (
          <li
            key={it.key}
            className={cn(
              'inline-flex items-center gap-1.5 text-[11px]',
              ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-obsidian-faded',
            )}
          >
            <Check size={11} className={cn(!ok && 'opacity-40')} />
            <span>{it.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
