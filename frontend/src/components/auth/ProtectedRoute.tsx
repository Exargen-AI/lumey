import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { getDefaultRoute } from '@/lib/constants';

interface ProtectedRouteProps {
  roles?: string[];
  permissions?: string[];
  requireAllPermissions?: boolean;
}

export function ProtectedRoute({ roles, permissions, requireAllPermissions = false }: ProtectedRouteProps) {
  const { user, permissions: grantedPermissions, isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !roles.includes(user.role)) {
    const correctPath = getDefaultRoute(user.role, grantedPermissions);
    return <Navigate to={correctPath} replace />;
  }

  if (permissions?.length) {
    const hasRequiredPermissions = requireAllPermissions
      ? permissions.every((permission) => grantedPermissions.includes(permission))
      : permissions.some((permission) => grantedPermissions.includes(permission));

    if (!hasRequiredPermissions) {
      const correctPath = getDefaultRoute(user.role, grantedPermissions);
      return <Navigate to={correctPath} replace />;
    }
  }

  return <Outlet />;
}
