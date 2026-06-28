import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import TopBar from '@/components/layout/TopBar';
import StatusBadge from '@/components/shared/StatusBadge';
import PriorityBadge from '@/components/shared/PriorityBadge';
import ProjectFormDialog from '@/components/projects/ProjectFormDialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import {
  ArrowLeft, Pencil, Calendar, MapPin, DollarSign,
  Plus, Loader2
} from 'lucide-react';
import { supabase } from '@/services/supabase';
import { findEntity, getEntity, createEntity, updateEntity } from '@/services/dataService';
import { useUserRole } from '@/hooks/useUserRole';
import { PERMISSIONS } from '@/lib/permissions';
import { handleMutationError } from '@/lib/rbac';

export default function ProjectDetail() {
  const { t } = useTranslation();
  const { role } = useUserRole();
  const canEdit = PERMISSIONS.canEditProject.includes(role);
  const canAddEntry = PERMISSIONS.canAddTimelineEntry.includes(role);
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);
  const [newEntry, setNewEntry] = useState({ title: '', description: '', date: '' });
  const [addingEntry, setAddingEntry] = useState(false);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => getEntity('projects', id),
  });

  const { data: timeline = [] } = useQuery({
    queryKey: ['timeline', id],
    queryFn: () => findEntity('project_timeline', { project_id: id }, { order: { column: 'created_at', direction: 'desc' } }),
    initialData: [],
  });

  const { data: clientRoleId } = useQuery({
    queryKey: ['clientRoleId'],
    queryFn: async () => {
      const { data, error } = await supabase.from('roles').select('id').eq('name', 'client').single();
      if (error) throw error;
      return data?.id;
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients', 'dropdown'],
    queryFn: async () => {
      if (!clientRoleId) return [];
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role_id', clientRoleId)
        .order('full_name');
      if (error) throw error;
      return (data ?? []).map(p => ({ id: p.id, name: p.full_name || '' }));
    },
    enabled: !!clientRoleId,
    initialData: [],
  });

  const { data: managers = [] } = useQuery({
    queryKey: ['projectManagers'],
    queryFn: async () => {
      const { data: roles, error: roleError } = await supabase
        .from('roles')
        .select('id')
        .in('name', ['super_admin', 'admin', 'manager']);
      if (roleError) throw roleError;
      const roleIds = (roles ?? []).map(r => r.id);
      if (roleIds.length === 0) return [];

      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('role_id', roleIds)
        .order('full_name');
      if (error) throw error;
      return (data ?? []).map(p => ({ user_id: p.id, full_name: p.full_name || '' }));
    },
    initialData: [],
  });

  const updateMutation = useMutation({
    mutationFn: (data) => updateEntity('projects', id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', id] }),
  });

  const createEntryMutation = useMutation({
    mutationFn: (data) => createEntity('project_timeline', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline', id] });
      setNewEntry({ title: '', description: '', date: '' });
      setAddingEntry(false);
    },
    onError: (err) => handleMutationError(err, t, toast),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">{t('projectNotFound')}</p>
        <Link to="/projects" className="text-primary text-sm mt-2 inline-block">{t('backToProjects')}</Link>
      </div>
    );
  }

  const clientName = clients.find(c => c.id === project.client_id)?.name;

  const handleAddEntry = async () => {
    if (!newEntry.title) return;
    await createEntryMutation.mutateAsync({
      project_id: id,
      title: newEntry.title,
      description: newEntry.description || null,
      date: newEntry.date || null,
    });
  };

  return (
    <div>
      <TopBar title={project.name} />
      <div className="p-6 space-y-6">
        {/* Back + Actions */}
        <div className="flex items-center justify-between">
          <Link to="/projects" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> {t('backToProjects')}
          </Link>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setShowEdit(true)} className="gap-2">
              <Pencil className="w-3.5 h-3.5" /> {t('edit')}
            </Button>
          )}
        </div>

        {/* Project Header Card */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="space-y-2">
              <h2 className="text-2xl font-heading font-bold">{project.name}</h2>
              {project.description && (
                <p className="text-muted-foreground max-w-2xl">{project.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={project.status} />
                <PriorityBadge priority={project.priority} />
                {clientName && <span className="text-sm text-muted-foreground">{t('clientLabel')}: {clientName}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 w-32">
              <Progress value={project.progress || 0} className="h-2" />
              <span className="text-sm font-medium">{project.progress || 0}%</span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-border">
            {project.budget > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">{t('budget')}</p>
                <p className="font-semibold flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5" />€{project.budget?.toLocaleString()}
                </p>
              </div>
            )}
            {project.start_date && (
              <div>
                <p className="text-xs text-muted-foreground">{t('startDate')}</p>
                <p className="font-semibold flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />{format(new Date(project.start_date), 'MMM d, yyyy')}
                </p>
              </div>
            )}
            {project.end_date && (
              <div>
                <p className="text-xs text-muted-foreground">{t('endDate')}</p>
                <p className="font-semibold flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />{format(new Date(project.end_date), 'MMM d, yyyy')}
                </p>
              </div>
            )}
            {project.location && (
              <div>
                <p className="text-xs text-muted-foreground">{t('location')}</p>
                <p className="font-semibold flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />{project.location}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Timeline Tab */}
        <Tabs defaultValue="timeline">
          <TabsList>
            <TabsTrigger value="timeline">{t('timeline')}</TabsTrigger>
            <TabsTrigger value="documents">{t('documents')}</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-semibold">{t('projectTimeline')}</h3>
              {canAddEntry && (
                <Button size="sm" variant="outline" onClick={() => setAddingEntry(!addingEntry)} className="gap-2">
                  <Plus className="w-3.5 h-3.5" /> {t('addEntry')}
                </Button>
              )}
            </div>

            {addingEntry && (
              <div className="bg-card rounded-xl border border-border p-4 space-y-3">
                <Input placeholder={t('entryTitle')} value={newEntry.title} onChange={e => setNewEntry({...newEntry, title: e.target.value})} />
                <Textarea placeholder="Description" value={newEntry.description} onChange={e => setNewEntry({...newEntry, description: e.target.value})} rows={2} />
                <Input type="date" value={newEntry.date} onChange={e => setNewEntry({...newEntry, date: e.target.value})} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleAddEntry} disabled={!newEntry.title}>{t('save')}</Button>
                  <Button size="sm" variant="outline" onClick={() => setAddingEntry(false)}>{t('cancel')}</Button>
                </div>
              </div>
            )}

            {timeline.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">{t('noTimelineEntries')}</div>
            ) : (
              <div className="relative pl-6 border-l-2 border-border space-y-6">
                {timeline.map(entry => (
                  <div key={entry.id} className="relative">
                    <div className="absolute -left-[25px] w-3 h-3 rounded-full bg-primary border-2 border-card" />
                    <div className="bg-card rounded-lg border border-border p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-semibold">{entry.title}</h4>
                          {entry.description && <p className="text-sm text-muted-foreground mt-1">{entry.description}</p>}
                        </div>
                        <StatusBadge status={entry.status} />
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {entry.date ? format(new Date(entry.date), 'MMM d, yyyy') : entry.created_at ? format(new Date(entry.created_at), 'MMM d, yyyy') : t('noDate')}
                        </span>
                        {entry.responsible_person && (
                          <span>{t('assignedTo')}: {entry.responsible_person}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="documents" className="mt-4">
            <div className="text-center py-12 text-muted-foreground text-sm">
              {t('documentsPlaceholder')}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <ProjectFormDialog
        open={showEdit}
        onOpenChange={setShowEdit}
        project={project}
        clients={clients}
        managers={managers}
        onSave={async (data) => {
          await updateMutation.mutateAsync(data);
        }}
      />
    </div>
  );
}