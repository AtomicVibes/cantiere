import { useUserRole } from '@/hooks/useUserRole';

export const PermissionGate = ({ children, requiredRole }) => {
  const { role, loading } = useUserRole();

  if (loading) return null;

  if (role === 'super_admin' || role === requiredRole) {
    return <>{children}</>;
  }

  return null;
};
