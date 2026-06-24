import { Request, Response, NextFunction } from 'express';
import * as projectService from '../services/project.service';
import { checkPermission, canViewProjectInternal } from '../services/rbac.service';
import { viewerCanSeeAgents } from '../lib/agentVisibility';

function sanitizeProjectForClient(project: any) {
  const safeDescription = project.clientDescription || project.description || null;

  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: safeDescription,
    clientDescription: safeDescription,
    category: project.category,
    phase: project.phase,
    healthStatus: project.healthStatus,
    startDate: project.startDate,
    targetDate: project.targetDate,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    taskCounts: project.taskCounts,
    _count: project._count,
  };
}

export async function listProjectsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const projects = await projectService.listProjects({
      userId: req.user!.id,
      role: req.user!.role,
      category: req.query.category as string,
      phase: req.query.phase as string,
      health: req.query.health as string,
      search: req.query.search as string,
    });
    const canViewInternal = await checkPermission(req.user!.role, 'task.view_internal');
    const data = canViewInternal
      ? projects
      : projects.map((project) => sanitizeProjectForClient(project));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getProjectHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await projectService.getProject(req.params.id);
    // Role-level gate decides the project SHAPE: a client still gets the
    // sanitized object (no member emails / internal description). Unchanged —
    // we deliberately do NOT widen the shape for full-access clients here, to
    // avoid leaking member PII.
    const canViewInternalRole = await checkPermission(req.user!.role, 'task.view_internal');
    // Per-project gate: true for staff (role grant) AND for a CLIENT member
    // granted ProjectMember.fullAccess. The client portal reads this flag to
    // decide whether to surface internal roadmap views (e.g. the all-sprints
    // list) — kept separate from the shape gate above.
    const canViewInternal = await canViewProjectInternal(req.user!, req.params.id);
    const base = canViewInternalRole ? project : sanitizeProjectForClient(project);
    res.json({ success: true, data: { ...base, canViewInternal } });
  } catch (err) {
    next(err);
  }
}

export async function createProjectHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await projectService.createProject(req.body, req.user!.id);
    res.status(201).json({ success: true, data: project });
  } catch (err) {
    next(err);
  }
}

export async function updateProjectHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { expectedUpdatedAt, ...data } = req.body ?? {};
    const project = await projectService.updateProject(
      req.params.id,
      data,
      req.user!.id,
      expectedUpdatedAt,
    );
    res.json({ success: true, data: project });
  } catch (err) {
    next(err);
  }
}

export async function deleteProjectHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await projectService.deleteProject(req.params.id, req.user!.id);
    res.json({ success: true, data: { message: 'Project deleted' } });
  } catch (err) {
    next(err);
  }
}

export async function getProjectMembersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const canViewInternal = await checkPermission(req.user!.role, 'task.view_internal');
    if (!canViewInternal) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions to view project members' } });
      return;
    }
    // 2026-06-01 — hide AGENT members from the assignee picker for any
    // viewer not on the agent-visibility allowlist (SUPER_ADMIN passes).
    const members = await projectService.getProjectMembers(req.params.id, {
      hideAgents: !viewerCanSeeAgents(req.user!),
    });
    res.json({ success: true, data: members });
  } catch (err) {
    next(err);
  }
}

export async function addProjectMemberHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const member = await projectService.addProjectMember(req.params.id, req.body.userId, req.body.role, req.user!.id);
    res.status(201).json({ success: true, data: member });
  } catch (err) {
    next(err);
  }
}

export async function removeProjectMemberHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await projectService.removeProjectMember(req.params.id, req.params.userId, req.user!.id);
    res.json({ success: true, data: { message: 'Member removed' } });
  } catch (err) {
    next(err);
  }
}

export async function setMemberFullAccessHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const member = await projectService.setMemberFullAccess(
      req.params.id,
      req.params.userId,
      req.body.fullAccess === true,
      req.user!.id,
    );
    res.json({ success: true, data: member });
  } catch (err) {
    next(err);
  }
}
