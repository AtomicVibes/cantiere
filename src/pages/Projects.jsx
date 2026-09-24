import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import TopBar from '@/components/layout/TopBar';
import ProjectCard from '@/components/projects/ProjectCard';
import ProjectFormDialog from '@/components/projects/ProjectFormDialog';
import EmptyState from '@/components/shared/EmptyState';
import StatusBadge from '@/components/shared/StatusBadge';
import PriorityBadge from '@/components/shared/PriorityBadge';
import { VisibilityBadge } from '@/components/documents/VisibilitySelect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus, Search, FolderKanban, AlertTriangle, Loader2, RefreshCw,
  List as ListIcon, LayoutGrid, Calendar as CalendarIcon, Users,
} from 'lucide-react';
import { supabase } from '@/services/supabase';
import { listEntities, createEntity, updateEntity } from '@/services/dataService';
import { useUserRole } from '@/hooks/useUserRole';
import { useAuth } from '@/lib/AuthContext';
import { useManagers } from '@/hooks/useManagers';
import { PERMISSIONS } from '@/lib/permissions';
import { matchesProjectFilters, sortProjects } from '@/lib/projectFilters';
import { getEffectiveProgress } from '@/lib/projectProgress';
import { logAppError } from '@/lib/userErrors';

const VIEW_STORAGE_KEY = 'projects_view_mode';
const STANDARD_STATUSES = ['draft', 'planning', 'in_progress', 'on_hold', 'completed', 'other'];

export default function Projects() {
  const { t } = useTranslation();
  const { role } = useUserRole();
  const { user } = useAuth();
  const canCreate = PERMISSIONS.canCreateProject.includes(role);
  const [showForm, setShowForm] = useState(false);
  const [editProject, setEditProject] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [deadlineFilter, setDeadlineFilter] = useState('all');
  const [visibilityFilter, setVisibilityFilter] = useState('all');
  const [sortKey, setSortKey] = useState('created_desc');
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const queryClient = useQueryClient();

  const setView = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, mode);
    } catch {
      // Non-fatal: preference simply won't persist.
    }
  };

  const { data: projects = [], isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listEntities('projects', { order: { column: 'created_at', direction: 'desc' } }),
    placeholderData: [],
    enabled: !!user?.id,
    // A project may have been created/approved on another page (e.g. request
    // approval) while this cache was stale; refetch on mount so the list heals.
    refetchOnMount: true,
  });
  const { data: clients = [] } = useQuery({
    queryKey: ['clients', 'dropdown'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, company_name');
      if (error) throw error;
      const result = (data ?? []).map(c => ({ id: c.id, company_name: c.company_name || '' }));
      return result;
    },
    placeholderData: [],
    enabled: !!user?.id,
  });
  const { data: managers = [] } = useManagers();

  // Single aggregated timeline query (counts + latest activity) for all
  // visible projects — avoids one query per card.
  const projectIds = useMemo(() => (projects ?? []).map((p) => p.id).filter(Boolean), [projects]);
  const { data: timelineMeta = {} } = useQuery({
    queryKey: ['projects-timeline-meta', projectIds.join(',')],
    enabled: projectIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('project_timeline')
          .select('project_id, created_at')
          .in('project_id', projectIds)
          .order('created_at', { ascending: false })
          .limit(2000);
        if (error) throw error;
        const meta = {};
        for (const row of data ?? []) {
          const entry = meta[row.project_id] || (meta[row.project_id] = { count: 0, latest: null });
          entry.count += 1;
          if (!entry.latest) entry.latest = row.created_at;
        }
        return meta;
      } catch (err) {
        logAppError('Projects', err, { operation: 'timeline-meta' });
        return {};
      }
    },
  });

  const clientMap = Object.fromEntries(clients.map(c => [c.id, c.company_name]));
  const managerMap = Object.fromEntries((managers ?? []).map(m => [m.id, m.full_name || '']));

  const createMutation = useMutation({
    mutationFn: (data) => createEntity('projects', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
    onError: (err) => logAppError('Projects', err, { operation: 'create-project' }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateEntity('projects', id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
    onError: (err) => logAppError('Projects', err, { operation: 'update-project' }),
  });

  const handleSave = async (data) => {
    let saved = null;
    if (editProject) {
      saved = await updateMutation.mutateAsync({ id: editProject.id, data });
    } else {
      saved = await createMutation.mutateAsync(data);
    }
    setEditProject(null);
    return saved;
  };

  // Custom statuses stay filterable: union of standard values present in
  // data plus any stored custom value (displayed as entered, untranslated).
  const availableStatuses = useMemo(() => {
    const customs = new Set();
    for (const p of projects ?? []) {
      if (p?.status && !STANDARD_STATUSES.includes(p.status)) customs.add(p.status);
    }
    return [...STANDARD_STATUSES, ...[...customs].sort()];
  }, [projects]);

  const enriched = useMemo(
    () =>
      (projects ?? []).map((p) => ({
        ...p,
        clientName: clientMap[p.client_id],
        managerName: managerMap[p.manager_id],
      })),
    [projects, clientMap, managerMap]
  );

  const filtered = useMemo(() => {
    const visible = enriched.filter((p) =>
      matchesProjectFilters(p, {
        search,
        status: statusFilter,
        priority: priorityFilter,
        deadline: deadlineFilter,
        visibility: visibilityFilter,
      })
    );
    return sortProjects(visible, sortKey);
  }, [enriched, search, statusFilter, priorityFilter, deadlineFilter, visibilityFilter, sortKey]);

  useEffect(() => {
    if (isError) logAppError('Projects', loadError, { operation: 'load-projects' });
  }, [isError, loadError]);

  const hasActiveFilters =
    statusFilter !== 'all' || priorityFilter !== 'all' || deadlineFilter !== 'all' || visibilityFilter !== 'all' || !!search;

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setPriorityFilter('all');
    setDeadlineFilter('all');
    setVisibilityFilter('all');
  };

  return (
    <div>
      <TopBar title={t('projects')} />
      <div className="p-6 space-y-6">
        {/* Toolbar */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex gap-3 flex-1 w-full sm:w-auto">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={t('searchProjects')}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9"
                  aria-label={t('searchProjects')}
                />
              </div>
              <div className="flex items-center gap-1 border border-border rounded-lg p-1" role="group" aria-label={t('viewMode') || 'View mode'}>
                <Button
                  variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setView('list')}
                  aria-pressed={viewMode === 'list'}
                  title={t('listView') || 'List view'}
                  aria-label={t('listView') || 'List view'}
                >
                  <ListIcon className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setView('grid')}
                  aria-pressed={viewMode === 'grid'}
                  title={t('gridView') || 'Grid view'}
                  aria-label={t('gridView') || 'Grid view'}
                >
                  <LayoutGrid className="w-4 h-4" />
                </Button>
              </div>
            </div>
            {canCreate && (
              <Button onClick={() => { setEditProject(null); setShowForm(true); }} className="gap-2">
                <Plus className="w-4 h-4" />
                {t('newProject')}
              </Button>
            )}
          </div>

          {/* Filters + sorting */}
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40" aria-label={t('status')}>
                <SelectValue placeholder={t('allStatuses')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                {availableStatuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STANDARD_STATUSES.includes(s) ? t(s === 'in_progress' ? 'inProgress' : s === 'on_hold' ? 'onHold' : s) : s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-36" aria-label={t('priority')}>
                <SelectValue placeholder={t('priority')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('all') || 'All'}</SelectItem>
                <SelectItem value="low">{t('low')}</SelectItem>
                <SelectItem value="medium">{t('medium')}</SelectItem>
                <SelectItem value="high">{t('high')}</SelectItem>
                <SelectItem value="critical">{t('critical')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={deadlineFilter} onValueChange={setDeadlineFilter}>
              <SelectTrigger className="w-36" aria-label={t('deadline') || 'Deadline'}>
                <SelectValue placeholder={t('deadline') || 'Deadline'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('all') || 'All'}</SelectItem>
                <SelectItem value="overdue">{t('overdue') || 'Overdue'}</SelectItem>
                <SelectItem value="today">{t('today') || 'Today'}</SelectItem>
                <SelectItem value="week">{t('thisWeek') || 'This week'}</SelectItem>
                <SelectItem value="month">{t('thisMonth') || 'This month'}</SelectItem>
                <SelectItem value="none">{t('noDeadline') || 'No deadline'}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={visibilityFilter} onValueChange={setVisibilityFilter}>
              <SelectTrigger className="w-36" aria-label={t('visibility.label', 'Visibility')}>
                <SelectValue placeholder={t('visibility.label', 'Visibility')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('all') || 'All'}</SelectItem>
                <SelectItem value="private">{t('visibility.private')}</SelectItem>
                <SelectItem value="public">{t('visibility.public')}</SelectItem>
                <SelectItem value="selected">{t('visibility.selected')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={setSortKey}>
              <SelectTrigger className="w-44" aria-label={t('sortBy') || 'Sort by'}>
                <SelectValue placeholder={t('sortBy') || 'Sort by'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created_desc">{t('sortNewest') || 'Newest first'}</SelectItem>
                <SelectItem value="name_asc">{t('sortName') || 'Name (A–Z)'}</SelectItem>
                <SelectItem value="priority">{t('sortPriority') || 'Priority'}</SelectItem>
                <SelectItem value="deadline_asc">{t('sortDeadline') || 'Deadline'}</SelectItem>
                <SelectItem value="progress_desc">{t('sortProgress') || 'Progress'}</SelectItem>
                <SelectItem value="updated_desc">{t('sortUpdated') || 'Recently updated'}</SelectItem>
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                {t('clearFilters') || 'Clear filters'}
              </Button>
            )}
          </div>
        </div>

        {/* Project views */}
        {isError ? (
          <div className="border border-destructive/30 bg-destructive/5 rounded-xl p-6 flex flex-col items-center gap-3 text-center">
            <AlertTriangle className="w-8 h-8 text-destructive" />
            <p className="font-medium">{t('projectsLoadError')}</p>
            <p className="text-sm text-muted-foreground max-w-md">{t('projectsLoadErrorDesc')}</p>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" /> {t('retry')}
            </Button>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> {t('loading')}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title={t('noProjectsFound')}
            description={hasActiveFilters ? (t('noFilterResults') || 'No projects match the current filters.') : t('createFirstProject')}
            actionLabel={canCreate && !hasActiveFilters ? t('newProject') : undefined}
            onAction={canCreate && !hasActiveFilters ? () => setShowForm(true) : undefined}
          />
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                clientName={clientMap[project.client_id]}
              />
            ))}
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <ul className="divide-y divide-border">
              {filtered.map((project) => {
                const meta = timelineMeta[project.id];
                return (
                  <li key={project.id}>
                    <Link
                      to={`/projects/${project.id}`}
                      className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3 hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{project.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {project.clientName || ''}
                          {meta?.latest ? ` · ${format(new Date(meta.latest), 'MMM d, yyyy')}` : ''}
                          {typeof meta?.count === 'number' ? ` · ${meta.count} ${t('timelineEntries') || 'entries'}` : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <StatusBadge status={project.status} />
                        {project.priority && <PriorityBadge priority={project.priority} />}
                        <VisibilityBadge value={project.visibility || 'private'} />
                      </div>
                      <div className="flex items-center gap-2 w-full sm:w-28 shrink-0">
                        <Progress value={getEffectiveProgress(project)} className="h-1.5 flex-1" />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{getEffectiveProgress(project)}%</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                        {project.end_date && (
                          <span className="flex items-center gap-1">
                            <CalendarIcon className="w-3.5 h-3.5" />
                            {format(new Date(project.end_date), 'MMM d, yyyy')}
                          </span>
                        )}
                        {project.managerName && (
                          <span className="flex items-center gap-1 max-w-[140px] truncate">
                            <Users className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{project.managerName}</span>
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <ProjectFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        project={editProject}
        clients={clients}
        managers={managers}
        onSave={handleSave}
      />
    </div>
  );
}
