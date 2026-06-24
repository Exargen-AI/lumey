import { useAuthStore } from '@/stores/authStore';

export function usePermission(permissionKey: string): boolean {
  const permissions = useAuthStore((s) => s.permissions);
  return permissions.includes(permissionKey);
}

export function useHasAnyPermission(keys: string[]): boolean {
  const permissions = useAuthStore((s) => s.permissions);
  return keys.some((key) => permissions.includes(key));
}

export function useHasAllPermissions(keys: string[]): boolean {
  const permissions = useAuthStore((s) => s.permissions);
  return keys.every((key) => permissions.includes(key));
}
