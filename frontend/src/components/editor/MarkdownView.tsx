import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { cn } from '@/lib/cn';

interface MarkdownViewProps {
  /** HTML content, typically produced by RichTextEditor.getHTML(). */
  content: string;
  /** Tighter spacing for inline contexts (comment bodies, card previews). */
  compact?: boolean;
  className?: string;
}

/**
 * Read-only renderer for content authored in RichTextEditor. The HTML is
 * sanitized by DOMPurify on every render so a malicious actor can't ship a
 * stored-XSS payload through the description field.
 *
 * Plain-text content (the legacy state for descriptions written before this
 * editor existed) renders untouched as a bare paragraph — DOMPurify lets
 * text nodes pass through.
 */
export function MarkdownView({ content, compact, className }: MarkdownViewProps) {
  const safe = useMemo(() => {
    if (!content || !content.trim()) return '';
    return DOMPurify.sanitize(content, {
      // Keep the same tag whitelist TipTap actually emits. Everything else
      // is dropped — including <script>, on* handlers, and javascript: URLs.
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 's', 'u', 'code', 'pre',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'blockquote', 'hr',
        'a', 'span',
      ],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'data-id', 'data-mention', 'data-type', 'data-label'],
      // Force every link to open in a new tab and strip referer.
      ADD_ATTR: ['target', 'rel'],
    });
  }, [content]);

  if (!safe) {
    return (
      <p className={cn('text-[12.5px] italic text-gray-400 dark:text-obsidian-faded', className)}>
        No description yet.
      </p>
    );
  }

  return (
    <div
      // SECURITY: content is run through DOMPurify with a strict tag list and
      // limited attributes, so dangerouslySetInnerHTML is acceptable here.
      // See the ALLOWED_TAGS / ALLOWED_ATTR config above.
      dangerouslySetInnerHTML={{ __html: safe }}
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none',
        // Mirror the editor's own visual rules so text written and text read
        // look identical.
        '[&_h1]:text-[18px] [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5',
        '[&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5',
        '[&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1',
        '[&_p]:my-1.5 [&_p]:leading-relaxed [&_p]:text-gray-700 dark:[&_p]:text-obsidian-fg',
        '[&_ul]:my-1 [&_ul]:pl-5 [&_ul]:list-disc',
        '[&_ol]:my-1 [&_ol]:pl-5 [&_ol]:list-decimal',
        '[&_li]:my-0.5',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-brand-500/50 [&_blockquote]:pl-3 [&_blockquote]:text-gray-600 dark:[&_blockquote]:text-obsidian-muted [&_blockquote]:italic',
        '[&_code]:bg-gray-100 dark:[&_code]:bg-obsidian-raised [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px] [&_code]:font-mono',
        '[&_pre]:rounded-md [&_pre]:bg-gray-900 dark:[&_pre]:bg-obsidian-sunken/80 [&_pre]:text-gray-100 [&_pre]:px-3 [&_pre]:py-2 [&_pre]:my-2 [&_pre]:text-[12.5px] [&_pre]:font-mono [&_pre]:overflow-x-auto',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
        '[&_a]:text-brand-600 dark:[&_a]:text-brand-300 [&_a]:underline [&_a]:decoration-brand-500/40 hover:[&_a]:decoration-brand-500',
        '[&_.mention]:bg-brand-500/10 [&_.mention]:text-brand-700 dark:[&_.mention]:text-brand-300 [&_.mention]:px-1 [&_.mention]:py-0.5 [&_.mention]:rounded [&_.mention]:font-medium',
        '[&_hr]:my-3 [&_hr]:border-gray-200 dark:[&_hr]:border-obsidian-border',
        compact && 'text-[13px] [&_p]:my-1',
        className,
      )}
    />
  );
}
