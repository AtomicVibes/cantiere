import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';

let roleIdCache = null;

async function getRoleIds() {
  if (roleIdCache) return roleIdCache;
  const { data, error } = await supabase.from('roles').select('id, name');
  if (error) throw error;
  roleIdCache = Object.fromEntries((data ?? []).map(r => [r.name, r.id]));
  return roleIdCache;
}

async function fetchCountByRoles(roleNames) {
  const roles = await getRoleIds();
  const roleIds = roleNames.map(name => roles[name]).filter(Boolean);
  if (roleIds.length === 0) return 0;
  const { count, error } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .in('role_id', roleIds);
  if (error) throw error;
  return count ?? 0;
}

export function useDashboardData() {
  const {
    data: teamMemberCount = 0,
    isLoading: teamLoading,
    isError: teamError,
  } = useQuery({
    queryKey: ['teamMemberCount'],
    queryFn: () => fetchCountByRoles(['super_admin', 'admin', 'manager']),
    placeholderData: 0,
  });

  const {
    data: clientCount = 0,
    isLoading: clientLoading,
    isError: clientError,
  } = useQuery({
    queryKey: ['clientCount'],
    queryFn: () => fetchCountByRoles(['client']),
    placeholderData: 0,
  });

  return {
    clientCount,
    teamMemberCount,
    isLoading: teamLoading || clientLoading,
    isError: teamError || clientError,
    refetch: () => {
      roleIdCache = null;
    },
  };
}
