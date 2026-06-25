import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';

async function fetchCount(table) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

export function useDashboardData() {
  const {
    data: clientCount = 0,
    isLoading: clientLoading,
    isError: clientError,
  } = useQuery({
    queryKey: ['clientCount'],
    queryFn: () => fetchCount('clients'),
    placeholderData: 0,
  });

  const {
    data: teamMemberCount = 0,
    isLoading: teamLoading,
    isError: teamError,
  } = useQuery({
    queryKey: ['teamMemberCount'],
    queryFn: () => fetchCount('team_members'),
    placeholderData: 0,
  });

  return {
    clientCount,
    teamMemberCount,
    isLoading: clientLoading || teamLoading,
    isError: clientError || teamError,
  };
}
