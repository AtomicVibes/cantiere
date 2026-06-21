import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/services/supabase';

export function useUserRole() {
  const { user, isLoadingAuth } = useAuth();
  const [role, setRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isLoadingAuth) return;

    if (!user) {
      setRole(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const fetchRole = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('role_id, roles!inner(name)')
          .eq('id', user.id)
          .single();

        if (!cancelled) {
          if (data?.roles?.name) {
            setRole(data.roles.name);
          } else {
            setRole(user?.user_metadata?.role || null);
          }
        }
      } catch {
        if (!cancelled) {
          setRole(user?.user_metadata?.role || null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchRole();

    return () => { cancelled = true; };
  }, [user, isLoadingAuth]);

  const hasRole = (...roles) => roles.includes(role);

  const isSuperAdmin = role === 'super_admin';
  const isAdmin = role === 'admin' || role === 'super_admin';
  const isManager = ['super_admin', 'admin', 'manager'].includes(role);
  const isClient = role === 'client';

  return {
    role,
    isLoading,
    isSuperAdmin,
    isAdmin,
    isManager,
    isClient,
    hasRole,
  };
}
