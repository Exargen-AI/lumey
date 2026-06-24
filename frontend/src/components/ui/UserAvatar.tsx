import { useState, useEffect } from 'react';
import { cn } from '@/lib/cn';

interface AvatarUser {
  id?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}

interface UserAvatarProps {
  user?: AvatarUser | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Brand ring — use for the current user (sidebar/topbar). */
  ring?: boolean;
  /** Show an online presence dot. */
  online?: boolean;
  className?: string;
  title?: string;
}

const SIZES: Record<string, { box: string; text: string; dot: string }> = {
  xs: { box: 'w-5 h-5', text: 'text-[9px]', dot: 'w-1.5 h-1.5' },
  sm: { box: 'w-7 h-7', text: 'text-[11px]', dot: 'w-2 h-2' },
  md: { box: 'w-8 h-8', text: 'text-[12px]', dot: 'w-2 h-2' },
  lg: { box: 'w-10 h-10', text: 'text-sm', dot: 'w-2.5 h-2.5' },
  xl: { box: 'w-[72px] h-[72px]', text: 'text-2xl', dot: 'w-3.5 h-3.5' },
};

// Deterministic per-person colour for the initials fallback. A flat fill that
// reads on both themes — the chip is its own surface. 8 hues keep two people
// with the same initial visually distinct (the old single-violet gradient
// made everyone identical).
const PALETTE = [
  'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200',
  'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200',
  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200',
  'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-200',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-200',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200',
];

function initialsOf(name?: string | null): string {
  const n = name?.trim();
  if (!n) return '?';
  return n.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function colorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/**
 * The single source of truth for showing a person. Renders their uploaded
 * photo when present, otherwise their initials in a stable per-person colour.
 * Replaces the hand-rolled "initial in a violet gradient circle" that was
 * copy-pasted across the sidebar, topbar, task cards, comments, and mentions.
 */
export function UserAvatar({ user, size = 'sm', ring, online, className, title }: UserAvatarProps) {
  const s = SIZES[size] ?? SIZES.sm;
  const name = user?.name ?? '';
  const key = user?.id || name || '?';
  const ringCls = ring ? 'ring-2 ring-brand-200 dark:ring-brand-500/40' : '';

  // The photo URL is a short-lived presigned S3 link; if it expires (or 404s)
  // mid-session, fall back to initials rather than show a broken image. Reset
  // when a fresh URL arrives.
  const [imgError, setImgError] = useState(false);
  useEffect(() => setImgError(false), [user?.avatarUrl]);
  const showImg = !!user?.avatarUrl && !imgError;

  return (
    <span className={cn('relative inline-flex shrink-0', className)} title={title ?? name ?? undefined}>
      {showImg ? (
        <img
          src={user!.avatarUrl!}
          alt={name}
          onError={() => setImgError(true)}
          className={cn(s.box, 'rounded-full object-cover bg-gray-100 dark:bg-obsidian-raised', ringCls)}
        />
      ) : (
        <span
          className={cn(
            s.box,
            s.text,
            'rounded-full flex items-center justify-center font-semibold select-none',
            colorFor(key),
            ringCls,
          )}
          aria-label={name || undefined}
        >
          {initialsOf(name)}
        </span>
      )}
      {online && (
        <span
          className={cn('absolute bottom-0 right-0 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-obsidian-bg', s.dot)}
          aria-hidden
        />
      )}
    </span>
  );
}
