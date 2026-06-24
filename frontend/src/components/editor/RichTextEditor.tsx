/* eslint-disable no-alert -- Phase 4 migration target: replace the
   `window.prompt` link-URL fallback with a small inline link-input popover. */

import { useEffect, useRef } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import {
  Bold as BoldIcon, Italic as ItalicIcon, Strikethrough,
  Code, Code2, Quote, List, ListOrdered, Heading1, Heading2,
  Link2, Undo2, Redo2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { createMentionExtension } from './extensions/MentionExtension';
import { createSlashCommandsExtension } from './extensions/SlashCommands';

interface RichTextEditorProps {
  /** Current HTML content. Empty string for fresh inputs. */
  value: string;
  /** Fires on blur with the latest HTML, or on every keystroke if liveUpdate is true. */
  onChange: (html: string) => void;
  /** When true, fires onChange on every edit. Default: only on blur (cheaper). */
  liveUpdate?: boolean;
  placeholder?: string;
  /** Read-only mode — the editor renders but can't be typed in. */
  disabled?: boolean;
  /** Project context for @-mentions; pass null to disable mentions. */
  projectId?: string | null;
  /** Smaller variant used inside comment composers. */
  compact?: boolean;
  /** Auto-focus on mount. */
  autoFocus?: boolean;
  /**
   * Fires on Cmd/Ctrl-Enter — intended for comment composers. The parent is
   * expected to have the latest HTML in state already (use `liveUpdate`), so
   * the callback takes no arguments.
   */
  onSubmit?: () => void;
  className?: string;
}

/**
 * Rich-text editor backed by TipTap (the same ProseMirror engine Linear uses).
 *
 *   - Markdown shortcuts:  **bold**  *italic*  ~~strike~~  `code`
 *                          # heading  - bullet  1. numbered  > quote
 *                          ``` code block       URLs auto-link
 *   - Floating toolbar above the canvas
 *   - Slash commands menu via "/" — see ./extensions/SlashCommands
 *   - @-mentions via "@"  — see ./extensions/MentionExtension
 *
 * Output is HTML, sanitized on render with DOMPurify (see MarkdownView).
 * Existing plain-text descriptions in the database are valid HTML (just
 * text nodes) so backwards compatibility is automatic.
 */
export function RichTextEditor({
  value,
  onChange,
  liveUpdate,
  placeholder = "Type '/' for commands or '@' to mention…",
  disabled = false,
  projectId,
  compact,
  autoFocus,
  onSubmit,
  className,
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const extensions: AnyExtension[] = [
    StarterKit.configure({
      // Heading levels we expose. h4-h6 not useful in task descriptions.
      heading: { levels: [1, 2, 3] },
      // Code blocks via three backticks. Highlight via tw classes.
      codeBlock: {
        HTMLAttributes: {
          class: 'rounded-md bg-gray-900 dark:bg-obsidian-sunken/80 text-gray-100 px-3 py-2 text-[12.5px] font-mono overflow-x-auto',
        },
      },
      // Disable the lift to avoid Tab interfering with browser focus order;
      // soft-break (Shift-Enter) and hard-break still work via StarterKit.
    }),
    Placeholder.configure({
      placeholder,
      showOnlyWhenEditable: true,
      emptyEditorClass: 'is-empty',
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: {
        class: 'text-brand-600 dark:text-brand-300 underline decoration-brand-500/40 hover:decoration-brand-500',
        rel: 'noopener noreferrer',
        target: '_blank',
      },
    }),
    createSlashCommandsExtension(),
  ];
  if (projectId) {
    extensions.push(createMentionExtension(projectId));
  }

  const editor = useEditor({
    extensions,
    content: value || '',
    editable: !disabled,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      handleKeyDown: (_view, event) => {
        // Cmd/Ctrl-Enter submits when an onSubmit handler is wired (e.g. comment composer).
        // Parent owns the latest HTML via liveUpdate, so we just trigger the send.
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && onSubmitRef.current) {
          event.preventDefault();
          onSubmitRef.current();
          return true;
        }
        return false;
      },
      attributes: {
        class: cn(
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none',
          'min-h-[80px]',
          compact && 'min-h-[40px] text-[13px]',
          // Sensible visual defaults that match the rest of the platform.
          '[&_h1]:text-[18px] [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5',
          '[&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5',
          '[&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1',
          '[&_p]:my-1.5 [&_p]:leading-relaxed',
          '[&_ul]:my-1 [&_ul]:pl-5 [&_ul]:list-disc',
          '[&_ol]:my-1 [&_ol]:pl-5 [&_ol]:list-decimal',
          '[&_li]:my-0.5',
          '[&_blockquote]:border-l-2 [&_blockquote]:border-brand-500/50 [&_blockquote]:pl-3 [&_blockquote]:text-gray-600 dark:[&_blockquote]:text-obsidian-muted [&_blockquote]:italic',
          '[&_code]:bg-gray-100 dark:[&_code]:bg-obsidian-raised [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px] [&_code]:font-mono',
          '[&_pre]:my-2',
          '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
          // Mention chip styling — applied via the .mention class set in MentionExtension.
          '[&_.mention]:bg-brand-500/10 [&_.mention]:text-brand-700 dark:[&_.mention]:text-brand-300 [&_.mention]:px-1 [&_.mention]:py-0.5 [&_.mention]:rounded [&_.mention]:font-medium',
          // Empty-editor placeholder.
          '[&_.is-empty]:before:text-gray-400 dark:[&_.is-empty]:before:text-obsidian-faded [&_.is-empty]:before:content-[attr(data-placeholder)] [&_.is-empty]:before:float-left [&_.is-empty]:before:pointer-events-none [&_.is-empty]:before:h-0',
        ),
      },
    },
    onUpdate: ({ editor: e }) => {
      if (liveUpdate) onChangeRef.current(e.getHTML());
    },
    onBlur: ({ editor: e }) => {
      // Always fire onChange on blur — even if liveUpdate is on — so we
      // capture the final value when focus leaves.
      onChangeRef.current(e.getHTML());
    },
  });

  // Sync external value changes (e.g. parent reset) without losing focus on
  // every keystroke. Only re-set content if the parent's value diverges from
  // what the editor currently holds.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value !== current && !editor.isFocused) {
      // Second arg is emitUpdate=false — keep parent value in sync without
      // re-firing onChange and causing an update loop.
      editor.commands.setContent(value || '', false);
    }
  }, [editor, value]);

  if (!editor) return null;

  return (
    <div
      className={cn(
        'rounded-md border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-bg overflow-hidden transition-colors',
        'focus-within:border-brand-500/60 focus-within:ring-2 focus-within:ring-brand-500/20',
        disabled && 'opacity-60',
        className,
      )}
    >
      {!disabled && !compact && <Toolbar editor={editor} />}
      <EditorContent editor={editor} className={cn('px-3 py-2', compact && 'px-2.5 py-1.5')} />
    </div>
  );
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────

function Toolbar({ editor }: { editor: Editor }) {
  const promptForLink = () => {
    const previous = editor.getAttributes('link').href;
    const url = window.prompt('Link URL', previous ?? 'https://');
    if (url == null) return; // user cancelled
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-100 dark:border-obsidian-border/60 bg-gray-50/40 dark:bg-obsidian-sunken/30 flex-wrap">
      <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()}    active={editor.isActive('bold')}    title="Bold (⌘B)">
        <BoldIcon size={13} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()}  active={editor.isActive('italic')}  title="Italic (⌘I)">
        <ItalicIcon size={13} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()}  active={editor.isActive('strike')}  title="Strikethrough">
        <Strikethrough size={13} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()}    active={editor.isActive('code')}    title="Inline code (⌘E)">
        <Code size={13} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1">
        <Heading1 size={13} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">
        <Heading2 size={13} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()}  active={editor.isActive('bulletList')}  title="Bullet list">
        <List size={13} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
        <ListOrdered size={13} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()}  active={editor.isActive('blockquote')}  title="Quote">
        <Quote size={13} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()}   active={editor.isActive('codeBlock')}   title="Code block">
        <Code2 size={13} />
      </ToolbarButton>
      <ToolbarButton onClick={promptForLink}                                          active={editor.isActive('link')}        title="Link (⌘K)">
        <Link2 size={13} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (⌘Z)">
        <Undo2 size={13} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (⌘⇧Z)">
        <Redo2 size={13} />
      </ToolbarButton>
      <span className="ml-auto text-[10px] text-gray-400 dark:text-obsidian-faded font-mono pr-1">
        / for commands · @ for people
      </span>
    </div>
  );
}

function ToolbarButton({
  children, onClick, active, disabled, title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center justify-center w-7 h-7 rounded transition-colors',
        active
          ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/25'
          : 'text-gray-500 dark:text-obsidian-muted hover:bg-gray-100 dark:hover:bg-obsidian-raised hover:text-gray-800 dark:hover:text-obsidian-fg',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 w-px h-4 bg-gray-200 dark:bg-obsidian-border self-center" />;
}
