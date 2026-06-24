import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import { SlashMenu, type SlashItem } from '../SlashMenu';

/**
 * Slash-command popup. Type `/` at the start of an empty line and a small
 * menu appears with insertion shortcuts (Heading, Bullet list, Code block,
 * etc.). Patterned after Notion / Linear.
 *
 * Items are passed straight to TipTap chains so we don't have to keep a
 * parallel state model — what you click here is what the toolbar would do.
 */

const ITEMS: SlashItem[] = [
  {
    title: 'Heading 1',
    keywords: 'heading h1',
    iconName: 'Heading1',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    keywords: 'heading h2',
    iconName: 'Heading2',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    keywords: 'heading h3',
    iconName: 'Heading3',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    title: 'Bullet list',
    keywords: 'bullet list ul unordered',
    iconName: 'List',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Numbered list',
    keywords: 'numbered list ol ordered',
    iconName: 'ListOrdered',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'Quote',
    keywords: 'quote blockquote',
    iconName: 'Quote',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: 'Code block',
    keywords: 'code block monospace pre',
    iconName: 'Code2',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: 'Divider',
    keywords: 'divider hr line separator',
    iconName: 'Minus',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

export function createSlashCommandsExtension() {
  return Extension.create({
    name: 'slashCommands',

    addOptions() {
      return {
        suggestion: {
          char: '/',
          startOfLine: false,
          // Don't trigger inside code blocks — we want a literal slash there.
          allow: ({ state, range }: any) => {
            const $from = state.doc.resolve(range.from);
            return !$from.parent.type.spec.code;
          },
          items: ({ query }: { query: string }) => {
            const q = query.toLowerCase().trim();
            if (!q) return ITEMS.slice(0, 8);
            return ITEMS.filter((i) => i.title.toLowerCase().includes(q) || i.keywords.toLowerCase().includes(q)).slice(0, 8);
          },
          render: () => {
            let component: ReactRenderer | null = null;
            let popup: TippyInstance[] | null = null;

            return {
              onStart: (props: any) => {
                component = new ReactRenderer(SlashMenu, { props, editor: props.editor });
                if (!props.clientRect) return;
                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                  // Match the panel's dark/light look automatically.
                  theme: 'transparent',
                });
              },
              onUpdate(props: any) {
                component?.updateProps(props);
                if (props.clientRect && popup?.[0]) {
                  popup[0].setProps({ getReferenceClientRect: props.clientRect });
                }
              },
              onKeyDown(props: any) {
                if (props.event.key === 'Escape') {
                  popup?.[0]?.hide();
                  return true;
                }
                return (component?.ref as any)?.onKeyDown?.(props) ?? false;
              },
              onExit() {
                popup?.[0]?.destroy();
                component?.destroy();
              },
            };
          },
          command: ({ editor, range, props }: any) => {
            (props as SlashItem).command({ editor, range });
          },
        },
      };
    },

    addProseMirrorPlugins() {
      return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
    },
  });
}
