import { type ReactNode } from 'react';
import { useHasAllPermissions, useHasAnyPermission, usePermission } from '@/hooks/usePermission';

interface CanProps {
  permission?: string;
  permissions?: string[];
  requireAllPermissions?: boolean;
  children: ReactNode;
  fallback?: ReactNode;
}

export function Can({ permission, permissions, requireAllPermissions = false, children, fallback = null }: CanProps) {
  const hasSinglePermission = usePermission(permission || '');
  const hasAnyPermissions = useHasAnyPermission(permissions || []);
  const hasAllPermissions = useHasAllPermissions(permissions || []);
  const hasPermission = permission
    ? hasSinglePermission
    : permissions?.length
      ? (requireAllPermissions ? hasAllPermissions : hasAnyPermissions)
      : true;

  if (!hasPermission) return <>{fallback}</>;
  return <>{children}</>;
}
