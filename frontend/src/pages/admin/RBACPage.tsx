import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Save, Check } from 'lucide-react';
import { getPermissions, getRoles, updateRolePermissions } from '@/api/rbac';
import { getMeApi } from '@/api/auth';
import { ROLE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/authStore';
import { DesktopHint } from '@/components/ui';

// Group permissions by category prefix (e.g., "project", "task", "user")
function groupPermissions(permissions: any[]): Record<string, any[]> {
  const groups: Record<string, any[]> = {};
  permissions.forEach((perm: any) => {
    const key = perm.key ?? perm.name ?? perm.id;
    const category = key.split('.')[0] ?? 'other';
    if (!groups[category]) groups[category] = [];
    groups[category].push(perm);
  });
  return groups;
}

export function RBACPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);
  const { data: permissions, isLoading: permsLoading } = useQuery({
    queryKey: ['rbac-permissions'],
    queryFn: getPermissions,
  });
  const { data: roles, isLoading: rolesLoading } = useQuery({
    queryKey: ['rbac-roles'],
    queryFn: getRoles,
  });

  // Track local edits: { [roleKey]: Set<permissionId> }
  const [matrix, setMatrix] = useState<Record<string, Set<string>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Initialize matrix from roles data
  useEffect(() => {
    if (!roles) return;
    const initial: Record<string, Set<string>> = {};
    roles.forEach((role: any) => {
      const roleKey = role.role ?? role.name ?? role.id;
      const permIds = (role.permissions ?? [])
        .filter((p: any) => p.granted)
        .map((p: any) => p.id);
      initial[roleKey] = new Set(permIds);
    });
    setMatrix(initial);
  }, [roles]);

  const isLoading = permsLoading || rolesLoading;

  const permissionGroups = useMemo(() => {
    if (!permissions) return {};
    return groupPermissions(permissions);
  }, [permissions]);

  const roleKeys = useMemo(() => {
    if (!roles) return [];
    return roles.map((r: any) => r.role ?? r.name ?? r.id);
  }, [roles]);

  const togglePermission = (roleKey: string, permId: string) => {
    setMatrix((prev) => {
      const next = { ...prev };
      const set = new Set(next[roleKey] ?? []);
      if (set.has(permId)) {
        set.delete(permId);
      } else {
        set.add(permId);
      }
      next[roleKey] = set;
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const promises = roleKeys.map((roleKey: string) => {
        const grantedIds = matrix[roleKey] ?? new Set();
        const perms = (permissions ?? []).map((p: any) => ({
          permissionId: p.id,
          granted: grantedIds.has(p.id),
        }));
        return updateRolePermissions(roleKey, perms);
      });
      await Promise.all(promises);
      qc.invalidateQueries({ queryKey: ['rbac-roles'] });
      if (user) {
        const refreshed = await getMeApi();
        // Access token now lives only in memory; pull from the store rather
        // than localStorage (XSS-safe path, QA finding #5).
        const currentToken = useAuthStore.getState().accessToken || '';
        setAuth(refreshed.user, currentToken, refreshed.permissions);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save RBAC:', err);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Roles & Permissions</h1>
        <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DesktopHint
        dismissKey="rbac"
        reason="The permission matrix has one column per role and one row per permission — it needs a wide screen to compare grants side-by-side without horizontal scroll."
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield size={24} className="text-brand-600" />
          <h1 className="text-2xl font-bold text-gray-900">Roles & Permissions</h1>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            'flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors',
            saved
              ? 'bg-green-600 text-white'
              : 'bg-brand-600 text-white hover:bg-brand-700',
            saving && 'opacity-50 cursor-not-allowed',
          )}
        >
          {saved ? <Check size={16} /> : <Save size={16} />}
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save Changes'}
        </button>
      </div>

      {/* Permission Matrix */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3 sticky left-0 bg-gray-50 min-w-[200px]">
                Permission
              </th>
              {roleKeys.map((roleKey: string) => (
                <th key={roleKey} className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3 min-w-[120px]">
                  {ROLE_LABELS[roleKey as keyof typeof ROLE_LABELS] ?? roleKey}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(permissionGroups).map(([category, categoryPerms]) => (
              <>
                {/* Category header row */}
                <tr key={`cat-${category}`} className="bg-gray-50">
                  <td colSpan={roleKeys.length + 1} className="px-4 py-2">
                    <span className="text-xs font-semibold text-gray-600 uppercase">{category}</span>
                  </td>
                </tr>
                {categoryPerms.map((perm: any) => {
                  const permKey = perm.key ?? perm.name ?? '';
                  const permLabel = permKey.split('.').slice(1).join('.').replace(/_/g, ' ');
                  return (
                    <tr key={perm.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 text-sm text-gray-700 sticky left-0 bg-white">
                        <span className="capitalize">{permLabel}</span>
                        <span className="block text-[10px] text-gray-400">{permKey}</span>
                      </td>
                      {roleKeys.map((roleKey: string) => {
                        const checked = matrix[roleKey]?.has(perm.id) ?? false;
                        return (
                          <td key={roleKey} className="text-center px-4 py-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePermission(roleKey, perm.id)}
                              className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-500 cursor-pointer"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
