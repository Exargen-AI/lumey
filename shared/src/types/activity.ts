export interface Activity {
  id: string;
  projectId?: string | null;
  userId: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown> | null;
  createdAt: string;
  user?: { id: string; name: string };
  project?: { id: string; name: string; slug: string } | null;
}
