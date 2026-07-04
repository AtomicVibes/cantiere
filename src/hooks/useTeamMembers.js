import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';

/**
 * @typedef {Object} TeamMember
 * @property {string} id
 * @property {string} full_name
 * @property {string} email
 * @property {string} phone
 * @property {string} job_title
 * @property {string} department
 * @property {string} role_id
 * @property {string} status
 */

function formatMember(p) {
  return {
    id: p.id,
    full_name: p.full_name || '',
    email: p.email || '',
    phone: p.phone || '',
    job_title: p.job_title || '',
    department: p.department || '',
    role_id: p.role_id || '',
    status: 'active',
  };
}

/**
 * Fetches team members with dynamic role-based filtering.
 *
 * Role logic:
 *   Super admins see ALL profiles (no role filter).
 *   Standard users see profiles whose role is NOT super_admin,
 *   using a roles table join for stable name-based lookups.
 *
 * This avoids hardcoded role UUIDs and survives role name changes.
 *
 * @param {Object} options
 * @param {string|null} options.userRole     - Current user's role name (e.g. 'super_admin')
 * @param {boolean}      options.isSuperAdmin - Whether current user is super_admin
 * @returns {{ members: TeamMember[], isLoading: boolean }}
 */
export function useTeamMembers({ userRole, isSuperAdmin }) {
  const { data, isLoading } = useQuery({
    queryKey: ['teamMembers', { userRole, isSuperAdmin }],
    queryFn: async () => {
      if (isSuperAdmin) {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, email, full_name, phone, job_title, department, role_id')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return (data ?? []).map(formatMember);
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone, job_title, department, role_id, roles!inner(name)')
        .neq('roles.name', 'super_admin')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(formatMember);
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!userRole,
  });
  return { members: data ?? [], isLoading };
}
