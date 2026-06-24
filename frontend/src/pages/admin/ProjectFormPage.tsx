import { useEffect, useState } from 'react';
import { useNavigate, Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useCreateProject, useProject, useUpdateProject } from '@/hooks/useProjects';
import { getUsers } from '@/api/users';
import { CATEGORY_LABELS, PHASE_LABELS, ROLE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/cn';

interface ProjectFormData {
  name: string;
  description: string;
  category: string;
  phase: string;
  tags: string;
  startDate: string;
  targetDate: string;
}

export function ProjectFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEditing = Boolean(id);
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedMembers, setSelectedMembers] = useState<Record<string, string>>({});

  const { data: project, isLoading: projectLoading } = useProject(id || '', { enabled: isEditing });
  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['project-form-users'],
    queryFn: () => getUsers({ isActive: 'true' }),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProjectFormData>({
    defaultValues: {
      name: '',
      description: '',
      category: 'FLAGSHIP',
      phase: 'IDEA',
      tags: '',
      startDate: '',
      targetDate: '',
    },
  });

  useEffect(() => {
    if (!isEditing || project == null) return;

    reset({
      name: project.name || '',
      description: project.description || '',
      category: project.category || 'FLAGSHIP',
      phase: project.phase || 'IDEA',
      tags: Array.isArray(project.tags) ? project.tags.join(', ') : project.tags || '',
      startDate: project.startDate ? project.startDate.split('T')[0] : '',
      targetDate: project.targetDate ? project.targetDate.split('T')[0] : '',
    });

    setSelectedMembers(
      (project.members || []).reduce((acc: Record<string, string>, member: any) => {
        if (member.user?.id) acc[member.user.id] = member.role;
        return acc;
      }, {}),
    );
  }, [isEditing, project, reset]);

  const onSubmit = async (data: ProjectFormData) => {
    setSubmitError(null);
    try {
      const payload: any = {
        name: data.name,
        description: data.description || undefined,
        category: data.category,
        phase: data.phase,
        tags: data.tags
          ? data.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        startDate: data.startDate || undefined,
        targetDate: data.targetDate || undefined,
        memberIds: Object.entries(selectedMembers).map(([userId, role]) => ({ userId, role })),
      };

      const project = isEditing
        ? await updateProject.mutateAsync({ id: id!, data: payload })
        : await createProject.mutateAsync(payload);

      navigate(`/projects/${project.id}`);
    } catch (err: any) {
      setSubmitError(err?.response?.data?.error?.message || err?.message || `Failed to ${isEditing ? 'update' : 'create'} project`);
    }
  };

  const toggleMember = (userId: string, defaultRole: string) => {
    setSelectedMembers((prev) => {
      const next = { ...prev };
      if (next[userId]) {
        delete next[userId];
      } else {
        next[userId] = defaultRole;
      }
      return next;
    });
  };

  const updateMemberRole = (userId: string, role: string) => {
    setSelectedMembers((prev) => ({ ...prev, [userId]: role }));
  };

  if (isEditing && projectLoading) {
    return <div className="text-center py-12 text-gray-400">Loading project details...</div>;
  }

  if (isEditing && !project) {
    return <div className="text-center py-12 text-gray-500">Project not found.</div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/projects" className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">{isEditing ? 'Edit Project' : 'New Project'}</h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* Name */}
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Project Name <span className="text-red-500">*</span>
          </label>
          <input
            id="name"
            type="text"
            {...register('name', { required: 'Project name is required' })}
            className={cn(
              'w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500',
              errors.name ? 'border-red-300' : 'border-gray-300',
            )}
            placeholder="Enter project name"
          />
          {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            id="description"
            rows={3}
            {...register('description')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            placeholder="Brief project description"
          />
        </div>

        {/* Category + Phase row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">
              Category <span className="text-red-500">*</span>
            </label>
            <select
              id="category"
              {...register('category', { required: 'Category is required' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="phase" className="block text-sm font-medium text-gray-700 mb-1">
              Phase
            </label>
            <select
              id="phase"
              {...register('phase')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {Object.entries(PHASE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Tags */}
        <div>
          <label htmlFor="tags" className="block text-sm font-medium text-gray-700 mb-1">
            Tags
          </label>
          <input
            id="tags"
            type="text"
            {...register('tags')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Comma-separated tags (e.g. react, mobile, v2)"
          />
          <p className="mt-1 text-xs text-gray-400">Separate tags with commas</p>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-1">
              Start Date
            </label>
            <input
              id="startDate"
              type="date"
              {...register('startDate')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label htmlFor="targetDate" className="block text-sm font-medium text-gray-700 mb-1">
              Target Date
            </label>
            <input
              id="targetDate"
              type="date"
              {...register('targetDate')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* Members */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">Project Members</label>
            <span className="text-xs text-gray-400">You will be added automatically as the creator</span>
          </div>
          <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-72 overflow-y-auto">
            {usersLoading ? (
              <div className="px-4 py-6 text-sm text-gray-400">Loading users...</div>
            ) : (users?.length ?? 0) === 0 ? (
              <div className="px-4 py-6 text-sm text-gray-400">No active users available.</div>
            ) : (
              users!.map((user: any) => {
                const isSelected = !!selectedMembers[user.id];
                return (
                  <label key={user.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleMember(user.id, user.role)}
                        className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{user.name}</div>
                        <div className="text-xs text-gray-500 truncate">{user.email}</div>
                      </div>
                    </div>
                    <select
                      value={selectedMembers[user.id] || user.role}
                      onChange={(e) => updateMemberRole(user.id, e.target.value)}
                      disabled={!isSelected}
                      className="w-40 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-400"
                    >
                      {Object.entries(ROLE_LABELS).map(([roleKey, label]) => (
                        <option key={roleKey} value={roleKey}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })
            )}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Assignees and mentions come from project members, so adding the team here keeps task workflows working correctly.
          </p>
        </div>

        {/* Error */}
        {submitError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{submitError}</div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Link to="/projects" className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              'px-6 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 transition-colors',
              isSubmitting && 'opacity-50 cursor-not-allowed',
            )}
          >
            {isSubmitting ? (isEditing ? 'Saving...' : 'Creating...') : isEditing ? 'Save Project' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  );
}
