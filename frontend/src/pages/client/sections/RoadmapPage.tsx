import { Navigate, useParams } from 'react-router-dom';

/**
 * Legacy "Sprint & Roadmap" route. The combined page was split into two
 * dedicated tabs — Sprints (`/sprints`) and Timeline (`/timeline`) — to
 * mirror the engineer board's layout. This component keeps the old
 * `/roadmap` URL working by redirecting to Sprints (the primary half).
 */
export function ClientRoadmapPage() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/client/projects/${id}/sprints`} replace />;
}
