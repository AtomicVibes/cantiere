import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';
import { ROLES } from '@/config/roles';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from 'react-i18next';

export default function ProjectAssignmentDropdown({ value, onChange, disabled }) {
  const { t } = useTranslation();

  const { data: teamMembers = [], isLoading } = useQuery({
    queryKey: ['projectAssignments', ROLES.TEAM_MEMBER],
    queryFn: async () => {
      if (!ROLES.TEAM_MEMBER) return [];
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('role_id', ROLES.TEAM_MEMBER)
        .order('full_name');
      return (data ?? []).map(p => ({ id: p.id, full_name: p.full_name || p.email || '' }));
    },
    staleTime: 30_000,
    enabled: !!ROLES.TEAM_MEMBER,
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
