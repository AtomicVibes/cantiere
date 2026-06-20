import React, { useState } from 'react';
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
import { findEntity, getEntity, createEntity, updateEntity } from '@/services/dataService';

export default function ProjectDetail() {
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
    queryFn: () => findEntity('timeline_entries', { project_id: id }, { order: { column: 'date', direction: 'desc' } }),
    initialData: [],
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => listEntities('clients'),
    initialData: [],
  });

  const updateMutation = useMutation({
    mutationFn: (data) => updateEntity('projects', id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', id] }),
  });

  const createEntryMutation = useMutation({
    mutationFn: (data) => createEntity('timeline_entries', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline', id] });
      setNewEntry({ title: '', description: '', date: '' });
      setAddingEntry(false);
    },
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
        <p className="text-muted-foreground">Project not found</p>
        <Link to="/projects" className="text-primary text-sm mt-2 inline-block">Back to Projects</Link>
      </div>
    );
  }

  const clientName = clients.find(c => c.id === project.client_id)?.name;

  const handleAddEntry = async () => {
    if (!newEntry.title) return;
    await createEntryMutation.mutateAsync({
      ...newEntry,
      project_id: id,
      date: newEntry.date || new Date().toISOString().split('T')[0],
    });
  };

  return (
    <div>
      <TopBar title={project.name} />
      <div className="p-6 space-y-6">
        {/* Back + Actions */}
        <div className="flex items-center justify-between">
          <Link to="/projects" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Projects
          </Link>
          <Button variant="outline" size="sm" onClick={() => setShowEdit(true)} className="gap-2">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Button>
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
                {clientName && <span className="text-sm text-muted-foreground">Client: {clientName}</span>}
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
                <p className="text-xs text-muted-foreground">Budget</p>
                <p className="font-semibold flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5" />€{project.budget?.toLocaleString()}
                </p>
              </div>
            )}
            {project.start_date && (
              <div>
                <p className="text-xs text-muted-foreground">Start Date</p>
                <p className="font-semibold flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />{format(new Date(project.start_date), 'MMM d, yyyy')}
                </p>
              </div>
            )}
            {project.end_date && (
              <div>
                <p className="text-xs text-muted-foreground">End Date</p>
                <p className="font-semibold flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />{format(new Date(project.end_date), 'MMM d, yyyy')}
                </p>
              </div>
            )}
            {project.location && (
              <div>
                <p className="text-xs text-muted-foreground">Location</p>
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
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-semibold">Project Timeline</h3>
              <Button size="sm" variant="outline" onClick={() => setAddingEntry(!addingEntry)} className="gap-2">
                <Plus className="w-3.5 h-3.5" /> Add Entry
              </Button>
            </div>

            {addingEntry && (
              <div className="bg-card rounded-xl border border-border p-4 space-y-3">
                <Input placeholder="Entry title" value={newEntry.title} onChange={e => setNewEntry({...newEntry, title: e.target.value})} />
                <Textarea placeholder="Description" value={newEntry.description} onChange={e => setNewEntry({...newEntry, description: e.target.value})} rows={2} />
                <Input type="date" value={newEntry.date} onChange={e => setNewEntry({...newEntry, date: e.target.value})} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleAddEntry} disabled={!newEntry.title}>Save</Button>
                  <Button size="sm" variant="outline" onClick={() => setAddingEntry(false)}>Cancel</Button>
                </div>
              </div>
            )}

            {timeline.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No timeline entries yet</div>
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
                          {entry.date ? format(new Date(entry.date), 'MMM d, yyyy') : 'No date'}
                        </span>
                        {entry.responsible_person && (
                          <span>Assigned to: {entry.responsible_person}</span>
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
              Documents for this project will appear here
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <ProjectFormDialog
        open={showEdit}
        onOpenChange={setShowEdit}
        project={project}
        clients={clients}
        onSave={async (data) => {
          await updateMutation.mutateAsync(data);
        }}
      />
    </div>
  );
}