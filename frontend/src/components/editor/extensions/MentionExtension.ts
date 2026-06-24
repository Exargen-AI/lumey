import Mention from '@tiptap/extension-mention';
import { ReactRenderer } from '@tiptap/react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import api from '@/api/client';
import { MentionList, type MentionItem } from '../MentionList';

/**
 * @-mention extension. Pulls project members live from
 * /api/v1/projects/:id/members and pops a small autocomplete menu when the
 * user types "@". Selecting an item inserts a styled chip with the member's
 * name.
 *
 * The chip carries `data-id={userId}` so a future notification system can
 * find the mentioned users without re-parsing the rendered HTML.
 */

// Per-project cache — keeps repeated `@` opens snappy without re-querying, but
// scoped per projectId so navigating between projects never serves stale data.
// Stored as a Map so a hover-and-go between three tasks across two projects
// hits cache the second time on each.
const memberCache = new Map<string, MentionItem[]>();

async function loadMembers(projectId: string): Promise<MentionItem[]> {
  const cached = memberCache.get(projectId);
  if (cached) return cached;
  try {
    const { data } = await api.get(`/projects/${projectId}/members`);
    const rows = (data?.data ?? []) as Array<{ user: { id: string; name: string; email: string } }>;
    const items = rows.map((r) => ({ id: r.user.id, name: r.user.name, email: r.user.email }));
    memberCache.set(projectId, items);
    return items;
  } catch {
    return [];
  }
}

export function createMentionExtension(projectId: string) {
  return Mention.configure({
    HTMLAttributes: { class: 'mention', 'data-mention': 'true' },
    suggestion: {
      char: '@',
      // Use suggestion's items() to filter project members.
      items: async ({ query }: { query: string }) => {
        const all = await loadMembers(projectId);
        const q = query.toLowerCase().trim();
        if (!q) return all.slice(0, 8);
        return all
          .filter((m) =>
            m.name.toLowerCase().includes(q) ||
            (m.email ?? '').toLowerCase().includes(q),
          )
          .slice(0, 8);
      },
      render: () => {
        let component: ReactRenderer | null = null;
        let popup: TippyInstance[] | null = null;

        return {
          onStart: (props: any) => {
            component = new ReactRenderer(MentionList, { props, editor: props.editor });
            if (!props.clientRect) return;
            popup = tippy('body', {
              getReferenceClientRect: props.clientRect,
              appendTo: () => document.body,
              content: component.element,
              showOnCreate: true,
              interactive: true,
              trigger: 'manual',
              placement: 'bottom-start',
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
    },
  });
}
