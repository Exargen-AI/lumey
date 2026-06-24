import { useParams } from 'react-router-dom';
import { ActivityFeedView } from '@/components/activity/ActivityFeedView';

/**
 * Client "Activity" section — `/client/projects/:id/activity`.
 *
 * Same combined Today + This-Week feed the internal `/today` page uses,
 * scoped to the single project the client is viewing. The earlier
 * implementation (RecentProgressCard + status updates feed) was
 * conceptually the same answer to "what's happening?", so PR
 * 2026-05-15 consolidated both onto one component — clients now see
 * the same shape internal users do.
 *
 * Status updates aren't in the new view as a dedicated section; team
 * announcements that matter to the client come through deliverables /
 * decisions / task comments which DO appear here. If the team
 * specifically wants a long-form announcement feed, the StatusUpdate
 * model survives — it just isn't surfaced as a top-level client page
 * anymore.
 *
 * The URL stays `/activity` (no broken bookmarks); the sidebar label
 * flips to "Today" so admin + client portals agree on naming.
 */
export function ClientActivityPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return <ActivityFeedView projectId={id} title="Activity" />;
}
