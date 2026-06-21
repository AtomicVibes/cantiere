import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import TopBar from '@/components/layout/TopBar';
import ProjectCard from '@/components/projects/ProjectCard';
import ProjectFormDialog from '@/components/projects/ProjectFormDialog';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, FolderKanban } from 'lucide-react';
import { listEntities, createEntity, updateEntity } from '@/services/dataService';

export default function Projects() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [editProject, setEditProject] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const queryClient = useQueryClient();

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listEntities('projects', { order: { column: 'created_at', direction: 'desc' } }),
    initialData: [],
  });
  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => listEntities('clients'),
    initialData: [],
  });

  const clientMap = Object.fromEntries(clients.map(c => [c.id, c.name]));

  const createMutation = useMutation({
    mutationFn: (data) => createEntity('projects', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateEntity('projects', id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const handleSave = async (data) => {
    if (editProject) {
      await updateMutation.mutateAsync({ id: editProject.id, data });
    } else {
      await createMutation.mutateAsync(data);
    }
    setEditProject(null);
  };

  const filtered = (projects ?? []).filter(p => {
    const matchesSearch = !search || p.name?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div>
      <TopBar title={t('projects')} />
      <div className="p-6 space-y-6">
        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="flex gap-3 flex-1 w-full sm:w-auto">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('searchProjects')}
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t('allStatuses')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                <SelectItem value="draft">{t('draft')}</SelectItem>
                <SelectItem value="planning">{t('planning')}</SelectItem>
                <SelectItem value="in_progress">{t('inProgress')}</SelectItem>
                <SelectItem value="on_hold">{t('onHold')}</SelectItem>
                <SelectItem value="completed">{t('completed')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => { setEditProject(null); setShowForm(true); }} className="gap-2">
            <Plus className="w-4 h-4" />
            {t('newProject')}
          </Button>
        </div>

        {/* Project Grid */}
        {filtered.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title={t('noProjectsFound')}
            description={t('createFirstProject')}
            actionLabel={t('newProject')}
            onAction={() => setShowForm(true)}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                clientName={clientMap[project.client_id]}
              />
            ))}
          </div>
        )}
      </div>

      <ProjectFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        project={editProject}
        clients={clients}
        onSave={handleSave}
      />
    </div>
  );
}