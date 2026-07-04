import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';

async function fetchClientCount() {
  const { data: role } = await supabase
    .from('roles')
    .select('id')
    .eq('name', 'client')
    .single();
  if (!role?.id) return 0;
  const { count, error } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('role_id', role.id);
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
    queryFn: async () => {
      const { count, error } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count ?? 0;
    },
    placeholderData: 0,
  });

  const {
    data: clientCount = 0,
    isLoading: clientLoading,
    isError: clientError,
  } = useQuery({
    queryKey: ['clientCount'],
    queryFn: fetchClientCount,
    placeholderData: 0,
  });

  return {
    clientCount,
    teamMemberCount,
    isLoading: teamLoading || clientLoading,
    isError: teamError || clientError,
  };
}
