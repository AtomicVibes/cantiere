import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';
import TopBar from '@/components/layout/TopBar';
import EmptyState from '@/components/shared/EmptyState';
import TeamMemberCard from '@/components/teams/TeamMemberCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Search, Users, LayoutGrid, List } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { useTeamFormFields } from '@/hooks/useFormSchema';
import { PERMISSIONS } from '@/lib/permissions';
import { handleMutationError } from '@/lib/rbac';
import { useDirection } from '@/i18n/LanguageProvider';
import { inviteUserByEmail, deleteUser } from '@/services/inviteService';

const TEAM_ROLE_NAMES = ['super_admin', 'admin', 'manager'];
const emptyMember = { full_name: '', email: '', phone: '', job_title: '', department: '', status: 'active', role_id: '' };

async function getTeamRoleIds() {
  const { data, error } = await supabase
    .from('roles')
    .select('id, name')
    .in('name', TEAM_ROLE_NAMES);
  if (error) throw error;
  return (data ?? []).map(r => r.id);
}

export default function Teams() {
  const { t } = useTranslation();
  const { dir } = useDirection();
  const { role, isSuperAdmin } = useUserRole();
  const canCreate = PERMISSIONS.canCreateTeamMember.includes(role);
  const canDelete = PERMISSIONS.canDeleteTeamMember.includes(role);
  const { fields, jobTitleOptions, statusOptions } = useTeamFormFields();
  const [showForm, setShowForm] = useState(false);
  const [editMember, setEditMember] = useState(null);
  const [form, setForm] = useState(emptyMember);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [inviteMode, setInviteMode] = useState('direct');
  const [friendlyError, setFriendlyError] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const queryClient = useQueryClient();

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('roles').select('id, name').order('name');
      if (error) throw error;
      return data ?? [];
    },
    initialData: [],
    enabled: isSuperAdmin,
  });

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: async () => {
      const roleIds = await getTeamRoleIds();
      if (roleIds.length === 0) return [];

      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone, job_title, department, role_id')
        .in('role_id', roleIds)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(p => ({
        id: p.id,
        profile_id: p.id,
        full_name: p.full_name || '',
        email: p.email || '',
        phone: p.phone || '',
        job_title: p.job_title || '',
        department: p.department || '',
        role_id: p.role_id || '',
        status: 'active',
      }));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await deleteUser(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
      queryClient.invalidateQueries({ queryKey: ['teamMemberCount'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
    onError: (err) => {
      if (!handleMutationError(err, t, toast)) {
        toast.error(err.message);
      }
    },
  });

  const openEdit = (member) => {
    setEditMember(member);
    setForm({
      full_name: member.full_name || '',
      email: member.email || '',
      phone: member.phone || '',
      job_title: member.job_title || '',
      department: member.department || '',
      status: member.status || 'active',
      role_id: member.role_id || '',
    });
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canCreate && !editMember) {
      toast.error(t('accessDenied'));
      return;
    }
    setSaving(true);
    setFriendlyError('');

    try {
      if (editMember) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            full_name: form.full_name,
            phone: form.phone,
            job_title: form.job_title,
            department: form.department,
          })
          .eq('id', editMember.profile_id);
        if (profileError) throw profileError;
      } else {
        if (!form.email) {
          setFriendlyError('Email is required');
          setSaving(false);
          return;
        }
        await inviteUserByEmail({
          email: form.email,
          role_id: form.role_id,
          full_name: form.full_name,
          phone: form.phone,
          job_title: form.job_title,
          department: form.department,
          mode: inviteMode,
        });
        toast.success(inviteMode === 'direct' ? `User created (${form.email})` : 'Invite sent!');
      }

      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
      queryClient.invalidateQueries({ queryKey: ['teamMemberCount'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      setShowForm(false);
      setEditMember(null);
      setForm(emptyMember);
    } catch (err) {
      setFriendlyError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const filtered = members.filter(m =>
    !search || m.full_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <TopBar title={t('teams')} />
      <div className="p-6 space-y-6">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder={t('searchMembers')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex items-center gap-3">
            <ToggleGroup type="single" value={viewMode} onValueChange={v => v && setViewMode(v)} className="border border-border rounded-lg p-0.5">
              <ToggleGroupItem value="grid" className="h-8 w-8 rounded-md data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                <LayoutGrid className="w-4 h-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" className="h-8 w-8 rounded-md data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                <List className="w-4 h-4" />
              </ToggleGroupItem>
            </ToggleGroup>
            {canCreate && (
              <Button onClick={() => { setEditMember(null); setForm(emptyMember); setShowForm(true); }} className="gap-2">
                <Plus className="w-4 h-4" /> {t('addMember')}
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users} title={t('noTeamMembers')} description={t('addFirstTeamMember')} actionLabel={canCreate ? t('addMember') : undefined} onAction={canCreate ? () => setShowForm(true) : undefined} />
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(member => (
              <TeamMemberCard key={member.id} member={member} layout="grid" onEdit={openEdit} onDelete={(id) => setDeleteTarget(id)} canDelete={canDelete} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map(member => (
              <TeamMemberCard key={member.id} member={member} layout="list" onEdit={openEdit} onDelete={(id) => setDeleteTarget(id)} canDelete={canDelete} />
            ))}
          </div>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={(v) => { setShowForm(v); setFriendlyError(''); if (!v) setEditMember(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading">{editMember ? t('editMember') : t('addMember')}</DialogTitle>
          </DialogHeader>
          {friendlyError && (
            <div className="bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-3 border border-destructive/20" dir={dir}>
              {friendlyError}
            </div>
          )}
          <form onSubmit={handleSave} className="space-y-4" dir={dir}>
            {fields.filter(f => editMember ? f.key !== 'role_id' : true).map(field => {
              if (field.type === 'select') {
                let options = [];
                if (field.key === 'job_title') options = jobTitleOptions;
                else if (field.key === 'role_id') options = roles.map(r => ({ value: r.id, label: r.name.replace(/_/g, ' ') }));
                else if (field.key === 'status') options = statusOptions;

                if (field.key === 'role_id' && !isSuperAdmin) return null;

                return (
                  <div key={field.key}>
                    <Label>{field.label}</Label>
                    <Select value={form[field.key]} onValueChange={v => setForm({...form, [field.key]: v})}>
                      <SelectTrigger><SelectValue placeholder={t('select')} /></SelectTrigger>
                      <SelectContent>
                        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
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
            {!editMember && (
              <div>
                <Label>{t('provisioning')}</Label>
                <select
                  value={inviteMode}
                  onChange={e => setInviteMode(e.target.value)}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="direct">{t('directCreation')}</option>
                  <option value="invite">{t('sendInvitation')}</option>
                </select>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={saving || !form.full_name}>{saving ? t('saving') : t('save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete team member</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this user from the system,
              including their auth account and profile. They will lose all access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Yes, delete it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
