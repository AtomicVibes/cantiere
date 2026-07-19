import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/services/supabase';
import { updateMember } from '@/services/memberService';
import { fetchProjectAssignments, fetchAllProjects, syncProjectAssignments } from '@/services/projectMemberService';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { useUserRole } from '@/hooks/useUserRole';
import { useTeamFormFields } from '@/hooks/useFormSchema';
import { PERMISSIONS } from '@/lib/permissions';
import { handleMutationError } from '@/lib/rbac';
import { useDirection } from '@/i18n/LanguageProvider';
import { ChevronsUpDown, X } from 'lucide-react';

const ROLE_RANK = { super_admin: 4, admin: 3, manager: 2, client: 1 };
const ROLE_LABELS = { super_admin: 'Super Admin', admin: 'Admin', manager: 'User', client: 'Client' };
const RANK = { SUPER_ADMIN: 4, ADMIN: 3, MANAGER: 2, CLIENT: 1 };

export default function EditMemberDialog({ member, open, onOpenChange }) {
  const { t } = useTranslation();
  const { dir } = useDirection();
  const { role: currentUserRole } = useUserRole();
  const { fields, jobTitleOptions, statusOptions } = useTeamFormFields();
  const queryClient = useQueryClient();

  const canAssignRole = PERMISSIONS.canAssignProjectRole.includes(currentUserRole);
  const canAssignProjects = PERMISSIONS.canAssignProjects.includes(currentUserRole);
  const canEdit = PERMISSIONS.canEditTeamMember.includes(currentUserRole);

  const [form, setForm] = useState({
    full_name: '', phone: '', job_title: '', department: '', status: 'active', role_id: '',
  });
  const [selectedProjects, setSelectedProjects] = useState([]);
  const [saving, setSaving] = useState(false);
  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false);

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('roles').select('id, name').order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: canAssignRole,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-for-assignment'],
    queryFn: fetchAllProjects,
    enabled: canAssignProjects,
  });

  const { data: assignedProjectIds = [] } = useQuery({
    queryKey: ['project-members', member?.id],
    queryFn: () => fetchProjectAssignments(member.id),
    enabled: canAssignProjects && !!member?.id,
  });

  useEffect(() => {
    if (member) {
      setForm({
        full_name: member.full_name || '',
        phone: member.phone || '',
        job_title: member.job_title || '',
        department: member.department || '',
        status: member.status || 'active',
        role_id: member.role_id || '',
      });
    }
  }, [member]);

  useEffect(() => {
    if (assignedProjectIds.length > 0) {
      setSelectedProjects(assignedProjectIds);
    }
  }, [assignedProjectIds]);

  const availableRoles = roles.filter(r => {
    if (currentUserRole === 'super_admin') return true;
    if (currentUserRole === 'admin') return r.name !== 'super_admin';
    return false;
  });

  const toggleProject = (projectId) => {
    setSelectedProjects(prev =>
      prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    );
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canEdit) {
      toast.error(t('accessDenied'));
      return;
    }
    setSaving(true);

    try {
      await updateMember(member.id, {
        full_name: form.full_name,
        phone: form.phone,
        job_title: form.job_title,
        department: form.department,
        status: form.status,
      });

      if (canAssignRole && form.role_id && form.role_id !== member.role_id) {
        const selectedRole = roles.find(r => r.id === form.role_id);
        const currentMemberRole = roles.find(r => r.id === member.role_id);
        const targetRoleRank = selectedRole ? ROLE_RANK[selectedRole.name] ?? 0 : 0;
        const currentTargetRank = currentMemberRole ? ROLE_RANK[currentMemberRole.name] ?? 0 : 0;

        if (currentUserRole !== 'super_admin' && (targetRoleRank >= RANK.SUPER_ADMIN || currentTargetRank >= RANK.SUPER_ADMIN)) {
          toast.error('You do not have permission to modify this role.');
          setSaving(false);
          return;
        }
        await updateMember(member.id, { role_id: form.role_id });
      }

      if (canAssignProjects) {
        await syncProjectAssignments(member.id, selectedProjects);
      }

      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
      queryClient.invalidateQueries({ queryKey: ['teamMemberCount'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['project-members'] });
      toast.success('Member updated');
      onOpenChange(false);
    } catch (err) {
      if (!handleMutationError(err, t, toast)) {
        toast.error(err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="font-heading">{t('editMember')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4" dir={dir}>
          {fields.filter(f => f.key !== 'email' && f.key !== 'role_id').map(field => {
            if (field.type === 'select') {
              let options = [];
              if (field.key === 'job_title') options = jobTitleOptions;
              else if (field.key === 'status') options = statusOptions;

              return (
                <div key={field.key}>
                  <Label>{field.label}</Label>
                  <Select
                    value={form[field.key]}
                    onValueChange={v => setForm({...form, [field.key]: v})}
                  >
                    <SelectTrigger><SelectValue placeholder={t('select')} /></SelectTrigger>
                    <SelectContent>
                      {options.map(o => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            }
            return (
              <div key={field.key}>
                <Label>{field.label}{field.required ? ' *' : ''}</Label>
                <Input
                  type={field.type}
                  value={form[field.key] || ''}
                  onChange={e => setForm({...form, [field.key]: e.target.value})}
                  required={field.required}
                />
              </div>
            );
          })}

          {canAssignRole && (
            <div>
              <Label>{t('role')}</Label>
              <Select
                value={form.role_id}
                onValueChange={v => setForm({...form, role_id: v})}
              >
                <SelectTrigger><SelectValue placeholder={t('selectRole')} /></SelectTrigger>
                <SelectContent>
                  {availableRoles.map(r => (
                    <SelectItem key={r.id} value={r.id}>
                      {ROLE_LABELS[r.name] || r.name.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {canAssignProjects && (
            <div>
              <Label>{t('project')}s</Label>
              <Popover open={projectPopoverOpen} onOpenChange={setProjectPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between h-auto min-h-10"
                  >
                    <div className="flex flex-wrap gap-1">
                      {selectedProjects.length === 0 && (
                        <span className="text-muted-foreground">{t('select')}</span>
                      )}
                      {selectedProjects.slice(0, 3).map(id => {
                        const project = projects.find(p => p.id === id);
                        return project ? (
                          <Badge key={id} variant="secondary" className="mr-1">
                            {project.name}
                            <X
                              className="ml-1 h-3 w-3 cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); toggleProject(id); }}
                            />
                          </Badge>
                        ) : null;
                      })}
                      {selectedProjects.length > 3 && (
                        <Badge variant="secondary">+{selectedProjects.length - 3}</Badge>
                      )}
                    </div>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                  <Command>
                    <CommandInput placeholder={t('searchProjects')} />
                    <CommandList>
                      <CommandEmpty>{t('noProjectsFound')}</CommandEmpty>
                      <CommandGroup>
                        {projects.map(project => (
                          <CommandItem
                            key={project.id}
                            value={project.name}
                            onSelect={() => toggleProject(project.id)}
                          >
                            <Checkbox
                              checked={selectedProjects.includes(project.id)}
                              className="mr-2"
                            />
                            {project.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={saving || !form.full_name}>
              {saving ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
