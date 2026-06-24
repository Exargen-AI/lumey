import { UserRole } from '../enums.js';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  company?: string | null;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Full legal name used on signed compliance documents. Captured once
   * before the user signs their first document; null until then. Distinct
   * from `name` (display name, often a first-name shorthand from email).
   * Once set, immutable from the user side — admin can edit.
   */
  legalName: string | null;
  /**
   * Agent-visibility allowlist flag (2026-06-01). When true, this user
   * can see AI agents (userType = AGENT) and everything they touch —
   * agent-assigned tasks, agent comments, agent activity. SUPER_ADMIN
   * sees agents implicitly regardless of this flag and is the only role
   * that can grant it. Optional for older API responses; treat
   * undefined as false.
   */
  canViewAgents?: boolean;
  /**
   * URL of the user's uploaded profile photo. Null/undefined until they
   * upload one — the UI falls back to deterministic initials. Populated by
   * the avatar-upload endpoint (2026-06).
   */
  avatarUrl?: string | null;
}

export interface UserWithProjects extends User {
  projectMemberships: {
    id: string;
    projectId: string;
    role: UserRole;
    project: { id: string; name: string; slug: string };
  }[];
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  company?: string;
  projectIds?: { userId?: string; projectId: string; role: UserRole }[];
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  role?: UserRole;
  company?: string | null;
  isActive?: boolean;
  /**
   * SUPER_ADMIN-only agent-visibility grant. Backend silently drops this
   * for non-SUPER_ADMIN actors. See `User.canViewAgents`.
   */
  canViewAgents?: boolean;
}
