import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { getDefaultRoute } from '@/lib/constants';

export function RoleRedirect() {
  const { user, permissions, isAuthenticated, isLoading } = useAuthStore();

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

  const path = getDefaultRoute(user.role, permissions);
  return <Navigate to={path} replace />;
}
