import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';

export function useManagers() {
  return useQuery({
    queryKey: ['managers'],
    queryFn: async () => {
      const { data: roles, error: roleError } = await supabase
        .from('roles')
        .select('id')
        .in('name', ['super_admin', 'admin', 'manager']);
      if (roleError) throw roleError;
      const roleIds = (roles ?? []).map(r => r.id);
      if (roleIds.length === 0) return [];

      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('role_id', roleIds)
        .order('full_name');
      if (error) throw error;
      return (data ?? []).map(p => ({ id: p.id, full_name: p.full_name || '' }));
    },
    staleTime: 30_000,
  });
}
