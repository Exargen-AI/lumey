export { PERMISSIONS, type PermissionKey } from './permissions.js';
export {
  ROLE_LABELS,
  ROLE_HIERARCHY,
  DEFAULT_ROLE_PERMISSIONS,
} from './roles.js';

export const TASK_STATUS_ORDER = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const;

export const TASK_STATUS_LABELS: Record<string, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
};

export const PHASE_ORDER = ['IDEA', 'ARCHITECTURE', 'DEVELOPMENT', 'TESTING', 'LIVE', 'MAINTENANCE'] as const;

export const PHASE_LABELS: Record<string, string> = {
  IDEA: 'Idea',
  ARCHITECTURE: 'Architecture',
  DEVELOPMENT: 'Development',
  TESTING: 'Testing',
  LIVE: 'Live',
  MAINTENANCE: 'Maintenance',
};

export const PRIORITY_LABELS: Record<string, string> = {
  P0: 'Critical',
  P1: 'High',
  P2: 'Medium',
  P3: 'Low',
};

export const PRIORITY_COLORS: Record<string, string> = {
  P0: '#ef4444',
  P1: '#f97316',
  P2: '#3b82f6',
  P3: '#6b7280',
};

export const HEALTH_COLORS: Record<string, string> = {
  GREEN: '#22c55e',
  YELLOW: '#eab308',
  RED: '#ef4444',
};

export const CATEGORY_LABELS: Record<string, string> = {
  FLAGSHIP: 'Flagship',
  PLATFORM: 'Platform',
  B2C_SMB: 'B2C/SMB',
  PASSION: 'Passion',
  CONSULTING: 'Consulting',
  SOCIAL_IMPACT: 'Social Impact',
};

export const CATEGORY_COLORS: Record<string, string> = {
  FLAGSHIP: '#8b5cf6',
  PLATFORM: '#3b82f6',
  B2C_SMB: '#10b981',
  PASSION: '#f59e0b',
  CONSULTING: '#6366f1',
  SOCIAL_IMPACT: '#ec4899',
};

// Task types
export const TASK_TYPE_LABELS: Record<string, string> = {
  FEATURE: 'Feature',
  BUG: 'Bug',
  CHORE: 'Chore',
  SPIKE: 'Spike',
};

export const TASK_TYPE_COLORS: Record<string, string> = {
  FEATURE: '#6366f1',
  BUG: '#ef4444',
  CHORE: '#6b7280',
  SPIKE: '#f59e0b',
};

// Sprint statuses
export const SPRINT_STATUS_LABELS: Record<string, string> = {
  PLANNING: 'Planning',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

// Story point options (Fibonacci-like)
export const STORY_POINT_OPTIONS = [1, 2, 3, 5, 8, 13] as const;

// Epic statuses
export const EPIC_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
};
