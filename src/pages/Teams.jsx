import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';
import { base44 } from '@/api/base44Client';
import TopBar from '@/components/layout/TopBar';
import EmptyState from '@/components/shared/EmptyState';
import TeamMemberCard from '@/components/teams/TeamMemberCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Plus, Search, Users, LayoutGrid, List } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { PERMISSIONS } from '@/lib/permissions';
import { handleMutationError } from '@/lib/rbac';
import { inviteUserByEmail, deleteUser } from '@/services/inviteService';

const emptyMember = { full_name: '', email: '', phone: '', job_title: '', department: '', status: 'active', role_id: '' };

export default function Teams() {
  const { t } = useTranslation();
  const { role, isSuperAdmin } = useUserRole();
  const canCreate = PERMISSIONS.canCreateTeamMember.includes(role);
  const canDelete = PERMISSIONS.canDeleteTeamMember.includes(role);
  const JOB_TITLES = [
    { value: 'project_manager', label: t('supervisor') },
    { value: 'project_coordinator', label: 'Project Coordinator' },
    { value: 'supervisor', label: t('supervisor') },
    { value: 'architect', label: t('architect') },
    { value: 'civil_engineer', label: t('civilEngineer') },
    { value: 'interior_designer', label: t('interiorDesigner') },
    { value: 'technician', label: t('technician') },
    { value: 'accountant', label: t('accountant') },
    { value: 'procurement_officer', label: t('procurementOfficer') },
    { value: 'supplier', label: t('supplier') },
    { value: 'contractor', label: t('contractor') },
    { value: 'safety_officer', label: 'Safety Officer' },
    { value: 'surveyor', label: 'Surveyor' },
    { value: 'consultant', label: 'Consultant' },
  ];
  const [showForm, setShowForm] = useState(false);
  const [editMember, setEditMember] = useState(null);
  const [form, setForm] = useState(emptyMember);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
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

  const { data: members = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone, job_title, department, role_id, roles:roles!profiles_role_id_fkey(name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(p => ({
        id: p.id,
        full_name: p.full_name || '',
        email: p.email || '',
        phone: p.phone || '',
        job_title: p.job_title || '',
        department: p.department || '',
        status: 'active',
        role_id: p.role_id,
        role_name: p.roles?.name || '',
      }));
    },
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TeamMember.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
    onError: (err) => handleMutationError(err, t, toast),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TeamMember.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teamMembers'] }),
    onError: (err) => handleMutationError(err, t, toast),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await deleteUser(id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teamMembers'] }),
    onError: (err) => {
      if (!handleMutationError(err, t, toast)) {
        toast.error(err.message);
      }
    },
  });

  const openEdit = (member) => {
    setEditMember(member);
    setForm({
      full_name: member.full_name || '', email: member.email || '', phone: member.phone || '',
      job_title: member.job_title || '', department: member.department || '', status: member.status || 'active',
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
    const payload = { ...form };

    if (editMember) {
      delete payload.role_id;
      await updateMutation.mutateAsync({ id: editMember.id, data: payload });
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: payload.full_name,
          phone: payload.phone,
          job_title: payload.job_title,
          department: payload.department,
        })
        .eq('id', editMember.id);
      if (updateError) throw updateError;
    } else {
      if (payload.role_id && payload.email) {
        try {
          await inviteUserByEmail({
            email: payload.email,
            role_id: payload.role_id,
            full_name: payload.full_name,
            phone: payload.phone,
            job_title: payload.job_title,
            department: payload.department,
          });
          toast.success('Invite sent!');
        } catch (inviteErr) {
          setSaving(false);
          toast.error(inviteErr.message);
          return;
        }
      }
      await createMutation.mutateAsync(payload);
    }
    setSaving(false);
    setShowForm(false);
    setEditMember(null);
    setForm(emptyMember);
  };

  const filtered = members.filter(m =>
    !search || m.full_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <TopBar title={t('teams')} />
      <div className="p-6 space-y-6">
        {/* Toolbar */}
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

        {/* Members */}
        {filtered.length === 0 ? (
          <EmptyState icon={Users} title={t('noTeamMembers')} description={t('addFirstTeamMember')} actionLabel={canCreate ? t('addMember') : undefined} onAction={canCreate ? () => setShowForm(true) : undefined} />
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(member => (
              <TeamMemberCard key={member.id} member={member} layout="grid" onEdit={openEdit} onDelete={(id) => deleteMutation.mutate(id)} canDelete={canDelete} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map(member => (
              <TeamMemberCard key={member.id} member={member} layout="list" onEdit={openEdit} onDelete={(id) => deleteMutation.mutate(id)} canDelete={canDelete} />
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={(v) => { setShowForm(v); if (!v) setEditMember(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading">{editMember ? t('editMember') : t('addMember')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div><Label>Full Name *</Label><Input value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})} required /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></div>
              <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Job Title</Label>
                <Select value={form.job_title} onValueChange={v => setForm({...form, job_title: v})}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{JOB_TITLES.map(j => <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Department</Label><Input value={form.department} onChange={e => setForm({...form, department: e.target.value})} /></div>
            </div>
            {isSuperAdmin && !editMember && (
              <div>
                <Label>Role</Label>
                <Select value={form.role_id} onValueChange={v => setForm({...form, role_id: v})}>
                  <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                  <SelectContent>
                    {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.name.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm({...form, status: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="on_leave">On Leave</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={saving || !form.full_name}>{saving ? t('saving') : t('save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}