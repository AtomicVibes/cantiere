import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';

/**
 * @typedef {Object} StaffProfile
 * @property {string} id
 * @property {string} full_name
 * @property {string} email
 * @property {string} phone
 * @property {string} job_title
 * @property {string} department
 * @property {string} role_id
 * @property {string} role_name
 */

/**
 * Fetches the internal-staff directory (super_admin / admin / manager)
 * used by the Messaging contact search.
 *
 * Access is gated server-side by the "Profiles staff read" RLS policy,
 * so the caller can only ever see the staff rows their own role allows.
 * Client-role profiles are excluded here; clients stay reachable via the
 * Clients page rather than the global messaging directory.
 */
export function useStaffProfiles() {
  return useQuery({
    queryKey: ['staffProfiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone, job_title, department, role_id, roles(name)');
      if (error) throw error;

      return (data ?? [])
        .filter(p => p.roles?.some(r => r?.name === 'super_admin' || r?.name === 'admin' || r?.name === 'manager'))
        .map(p => ({
          id: p.id,
          full_name: p.full_name || '',
          email: p.email || '',
          phone: p.phone || '',
          job_title: p.job_title || '',
          department: p.department || '',
          role_id: p.role_id || '',
          role_name: p.roles?.find(r => r?.name)?.name || '',
        }));
    },
    staleTime: 5 * 60 * 1000,
  });
}