import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from 'react-i18next';

export default function ProjectAssignmentDropdown({ value, onChange, disabled }) {
  const { t } = useTranslation();

  const { data: teamMembers = [], isLoading } = useQuery({
    queryKey: ['projectAssignments', 'all-eligible'],
    queryFn: async () => {
      const { data: roles, error: rolesError } = await supabase
        .from('roles')
        .select('id')
        .in('name', ['super_admin', 'admin', 'manager']);
      if (rolesError) {
        console.error('ProjectAssignmentDropdown roles error', rolesError);
        return [];
      }
      const roleIds = (roles ?? []).map(r => r.id);
      if (roleIds.length === 0) return [];
      const { data, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('role_id', roleIds)
        .order('full_name')
        .limit(1000);
      if (profilesError) {
        console.error('ProjectAssignmentDropdown profiles error', profilesError);
        return [];
      }
      console.log('ProjectAssignmentDropdown found profiles:', data?.length);
      return (data ?? []).map(p => ({ id: p.id, full_name: p.full_name || p.email || '' }));
    },
    staleTime: 30_000,
    enabled: true,
  });

  const selectValue = value || '';
  const handleChange = (val) => {
    onChange?.(val === 'none' ? null : val);
  };

  return (
    <Select value={selectValue} onValueChange={handleChange} disabled={disabled || isLoading}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={t('selectTeamMember')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{t('none')}</SelectItem>
        {teamMembers.map((m) => (
          <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
