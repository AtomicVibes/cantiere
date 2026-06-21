import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

const emptyMember = { full_name: '', email: '', phone: '', job_title: '', department: '', status: 'active' };

export default function Teams() {
  const { t } = useTranslation();
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

  const { data: members = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list('-created_date'),
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TeamMember.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teamMembers'] }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TeamMember.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teamMembers'] }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TeamMember.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teamMembers'] }),
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
    setSaving(true);
    if (editMember) {
      await updateMutation.mutateAsync({ id: editMember.id, data: form });
    } else {
      await createMutation.mutateAsync(form);
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
            <Button onClick={() => { setEditMember(null); setForm(emptyMember); setShowForm(true); }} className="gap-2">
              <Plus className="w-4 h-4" /> {t('addMember')}
            </Button>
          </div>
        </div>

        {/* Members */}
        {filtered.length === 0 ? (
          <EmptyState icon={Users} title={t('noTeamMembers')} description={t('addFirstTeamMember')} actionLabel={t('addMember')} onAction={() => setShowForm(true)} />
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(member => (
              <TeamMemberCard key={member.id} member={member} layout="grid" onEdit={openEdit} onDelete={(id) => deleteMutation.mutate(id)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map(member => (
              <TeamMemberCard key={member.id} member={member} layout="list" onEdit={openEdit} onDelete={(id) => deleteMutation.mutate(id)} />
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