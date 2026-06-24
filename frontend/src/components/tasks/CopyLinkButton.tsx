/* eslint-disable no-alert -- Phase 4 migration target: replace the
   `window.prompt` fallback with a toast notification + Clipboard API
   permission re-request once a toast system lands. */

import { useState } from 'react';
import { Link2, Check } from 'lucide-react';
import { cn } from '@/lib/cn';

interface CopyLinkButtonProps {
  /** The URL to copy. Usually a deep link to the current task. */
  url: string;
  /** Visual size. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * One-click "copy link" affordance — copies a URL to the clipboard and
 * flashes a check icon for ~1.5s. Falls back to a manual prompt if the
 * Clipboard API isn't available (older browsers, insecure contexts).
 *
 * Used in the task detail header so people can paste a deep link into
 * Slack / Linear / a Notion doc without selecting + copying the address bar.
 */
export function CopyLinkButton({ url, size = 'md', className }: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    let success = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        success = true;
      } else {
        // Fallback: ephemeral textarea + execCommand. Works in older browsers
        // and in non-secure contexts (which navigator.clipboard refuses).
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        success = document.execCommand?.('copy') ?? false;
        document.body.removeChild(ta);
      }
    } catch {
      success = false;
    }

    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      // Last-ditch: show the URL so the user can copy it manually.
      window.prompt('Copy the link:', url);
    }
  }

  const sizeClasses =
    size === 'sm'
      ? 'h-7 w-7'
      : 'h-8 w-8';
  const iconSize = size === 'sm' ? 12 : 14;

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
        copied
          ? 'bg-success-500/15 text-success-600 dark:text-success-500 ring-1 ring-success-500/30'
          : 'text-gray-500 dark:text-obsidian-muted hover:bg-gray-100 dark:hover:bg-obsidian-raised hover:text-gray-900 dark:hover:text-obsidian-fg',
        sizeClasses,
        className,
      )}
      aria-label={copied ? 'Link copied' : 'Copy link to this task'}
      title={copied ? 'Copied!' : 'Copy link'}
    >
      {copied ? <Check size={iconSize} strokeWidth={2.5} /> : <Link2 size={iconSize} />}
    </button>
  );
}
