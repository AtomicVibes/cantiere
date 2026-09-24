import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import TopBar from '@/components/layout/TopBar';
import StatusBadge from '@/components/shared/StatusBadge';
import PriorityBadge from '@/components/shared/PriorityBadge';
import ProjectFormDialog from '@/components/projects/ProjectFormDialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import VisibilitySelect from '@/components/documents/VisibilitySelect';
import AudiencePicker from '@/components/documents/AudiencePicker';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { Input } from '@/components/ui/input';
import DatePicker from '@/components/ui/DatePicker';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import {
  ArrowLeft, Pencil, Calendar, MapPin, DollarSign,
  Plus, Loader2, Archive, ArchiveRestore, Trash2, Upload, X, TrendingUp, Send, User as UserIcon, FileText
} from 'lucide-react';
import { supabase } from '@/services/supabase';
import { getEntity, createEntity, updateEntity } from '@/services/dataService';
import { getEffectiveProgress, isManualProgressMode, computeAutoProgress, getPriorityProgressClass } from '@/lib/projectProgress';
import { logAppError } from '@/lib/userErrors';
import { VisibilityBadge } from '@/components/documents/VisibilitySelect';
import { uploadDocumentFile, DOCUMENT_FILE_ACCEPT } from '@/services/documentUploadService';
import { useAuth } from '@/lib/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';
import { useIsSuperAdmin } from '@/hooks/useIsSuperAdmin';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { getInitials } from '@/lib/avatar';
import { useManagers } from '@/hooks/useManagers';
import { PERMISSIONS } from '@/lib/permissions';
import { handleMutationError } from '@/lib/rbac';
import { getDocumentUserFriendlyError, logDocumentError } from '@/lib/document-errors';
import ProjectAssignmentDropdown from '@/components/projects/ProjectAssignmentDropdown';
import DocumentPreview from '@/components/shared/DocumentPreview';

export default function ProjectDetail() {
  const { t } = useTranslation();
  const { isAdmin, user } = useAuth();
  const userId = user?.id;
  const { role: userRole } = useUserRole();
  const canEdit = PERMISSIONS.canEditProject.includes(userRole);
  const canAddEntry = PERMISSIONS.canAddTimelineEntry.includes(userRole);
  const { id } = useParams();
  const { isSuperAdmin: isSuperAdminLive } = useIsSuperAdmin();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);
  const [newEntry, setNewEntry] = useState({ title: '', description: '', date: '' });
  const [addingEntry, setAddingEntry] = useState(false);
  const [entryFile, setEntryFile] = useState(null);
  const [entryUploading, setEntryUploading] = useState(false);
  const [entryVisibility, setEntryVisibility] = useState('private');
  const [entryAudience, setEntryAudience] = useState([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState(null);
  const [entryDeleting, setEntryDeleting] = useState(false);
  const [manualProgress, setManualProgress] = useState('');
  const [progressSaving, setProgressSaving] = useState(false);
  const [pendingManagerId, setPendingManagerId] = useState(null);
  const [managerTouched, setManagerTouched] = useState(false);
  const [managerSaving, setManagerSaving] = useState(false);

  React.useEffect(() => {
    setPendingManagerId(null);
    setManagerTouched(false);
  }, [id]);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => getEntity('projects', id),
  });

  const { data: timeline = [] } = useQuery({
    queryKey: ['timeline', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_timeline')
        .select('*, document:documents(*)')
        .eq('project_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return Promise.all((data || []).map(async entry => {
        if (!entry.document?.storage_path) return entry;
        const { data: signed } = await supabase.storage.from('documents').createSignedUrl(entry.document.storage_path, 3600);
        return {
          ...entry,
          document: {
            ...entry.document,
            name: entry.document.file_name,
            file_url: signed?.signedUrl || entry.document.storage_path,
          },
        };
      }));
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients', 'dropdown'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, company_name')
        .order('company_name');
      if (error) throw error;
      const result = (data ?? []).map(c => ({ id: c.id, company_name: c.company_name || '' }));
      return result;
    },
    initialData: [],
  });

  const { data: managers = [] } = useManagers();

  const { data: projectMembers = [] } = useQuery({
    queryKey: ['project-members-list', id],
    queryFn: async () => {
      const { data: members, error: membersErr } = await supabase
        .from('project_members')
        .select('id, assigned_at, profile_id')
        .eq('project_id', id);
      if (membersErr) throw membersErr;
      if (!members?.length) return [];
      const profileIds = [...new Set(members.map(m => m.profile_id))];
      const { data: profiles, error: profilesErr } = await supabase
        .from('profiles')
        .select('id, full_name, email, roles(name)')
        .in('id', profileIds);
      if (profilesErr) throw profilesErr;
      return members.map(m => ({
        ...m,
        profiles: (profiles ?? []).find(p => p.id === m.profile_id),
      }));
    },
    enabled: !!id,
  });

  const { data: currentMember } = useQuery({
    queryKey: ['current-project-member', id, userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('project_members')
        .select('id')
        .eq('project_id', id)
        .eq('profile_id', userId)
        .maybeSingle();
      return data;
    },
    enabled: !!id && !!userId,
  });

  const { data: entryAudienceMembers = [] } = useQuery({
    queryKey: ['documentAudienceMembers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name, email').order('full_name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
  });

  const canSeeTeam = isSuperAdminLive || !!currentMember;

  const updateMutation = useMutation({
    mutationFn: (data) => updateEntity('projects', id, data),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ['project', id] });
      const previous = queryClient.getQueryData(['project', id]);
      queryClient.setQueryData(['project', id], (old) => old ? { ...old, ...data } : old);
      return { previous };
    },
    onError: (_err, _data, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['project', id], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('projects')
        .update({
          status: 'archived',
          status_before_archive: project?.status && project.status !== 'archived' ? project.status : project?.status_before_archive || null,
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      try {
        await supabase.rpc('write_audit_log', {
          p_action_type: 'PROJECT_ARCHIVE',
          p_message: 'Project archived',
          p_entity_type: 'project',
          p_entity_id: id,
          p_project_id: id,
          p_details: {},
        });
      } catch (auditError) {
        logAppError('ProjectDetail', auditError, { operation: 'audit-project-archive' });
      }
      toast.success(t('projectArchived'));
    },
    onError: (err) => {
      logAppError('ProjectDetail', err, { operation: 'archive-project' });
      toast.error(t('errorsProjectArchive') || "We couldn't archive this project. Please try again.");
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('projects')
        .update({ status: project?.status_before_archive || 'draft', status_before_archive: null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      try {
        await supabase.rpc('write_audit_log', {
          p_action_type: 'PROJECT_RESTORE',
          p_message: 'Project restored',
          p_entity_type: 'project',
          p_entity_id: id,
          p_project_id: id,
          p_details: {},
        });
      } catch (auditError) {
        logAppError('ProjectDetail', auditError, { operation: 'audit-project-restore' });
      }
      toast.success(t('projectRestored') || 'Project restored.');
    },
    onError: (err) => {
      logAppError('ProjectDetail', err, { operation: 'restore-project' });
      toast.error(t('errorsProjectRestore') || "We couldn't restore this project. Please try again.");
    },
  });

  const createEntryMutation = useMutation({
    mutationFn: (data) => createEntity('project_timeline', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline', id] });
      setNewEntry({ title: '', description: '', date: '' });
      setEntryFile(null);
      setEntryAudience([]);
      setEntryVisibility('private');
      setAddingEntry(false);
    },
    onError: (err) => handleMutationError(err, t, toast),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: () => supabase.rpc('delete_project', { p_project_id: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success(t('projectDeleted'));
      navigate('/projects');
    },
    onError: (err) => {
      const message = err?.message || '';
      if (message.includes('super_admin')) {
        toast.error(t('accessDenied'));
      } else if (message.includes('not_found') || message.toLowerCase().includes('not found')) {
        toast.error(t('projectNotFound'));
      } else {
        toast.error(t('deleteProjectError'));
      }
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
        <p className="text-muted-foreground">{t('projectNotFound')}</p>
        <Link to="/projects" className="text-primary text-sm mt-2 inline-block">{t('backToProjects')}</Link>
      </div>
    );
  }

  const clientName = clients.find(c => c.id === project.client_id)?.company_name;

  const handleAddEntry = async () => {
    if (!newEntry.title) return;
    if (entryFile && entryVisibility === 'selected' && entryAudience.length === 0) {
      toast.error(t('selectAudienceRequired'));
      return;
    }
    let uploadedDocument = null;
    setEntryUploading(true);
    try {
      if (entryFile) {
        try {
          uploadedDocument = await uploadDocumentFile({
            file: entryFile,
            name: entryFile.name,
            project_id: id,
            visibility: entryVisibility,
            audience_user_ids: entryVisibility === 'selected' ? entryAudience : [],
          });
        } catch (uploadError) {
          logDocumentError('Add entry document upload failed', uploadError, { projectId: id, fileName: entryFile?.name });
          toast.error(getDocumentUserFriendlyError(
            uploadError,
            'Unable to upload the document. Please try again.',
            "You don't have permission to upload a document."
          ));
          return;
        }
      }

      try {
        await createEntryMutation.mutateAsync({
          project_id: id,
          title: newEntry.title,
          description: newEntry.description || null,
          date: newEntry.date || null,
          document_id: uploadedDocument?.id || null,
          submitted_by: userId || null,
        });
        // Canonical audit (best-effort).
        try {
          await supabase.rpc('write_audit_log', {
            p_action_type: 'TIMELINE_CREATE',
            p_message: 'Timeline entry submitted',
            p_entity_type: 'project_timeline',
            p_entity_id: null,
            p_project_id: id,
            p_details: { title: newEntry.title, document_id: uploadedDocument?.id || null },
          });
        } catch (auditError) {
          logAppError('ProjectDetail', auditError, { operation: 'audit-timeline-create' });
        }
        // Notify the project manager of document submissions (isolated:
        // never blocks the submission). In-app + Push via central pipeline.
        if (uploadedDocument?.id && project?.manager_id && project.manager_id !== userId) {
          try {
            await supabase.from('notifications').insert({
              user_id: project.manager_id,
              type: 'project_update',
              message: `New document submitted to project: ${project.name}`,
              url: `/projects/${id}`,
              is_read: false,
            });
          } catch (notifyError) {
            logAppError('ProjectDetail', notifyError, { operation: 'notify-timeline-submission' });
          }
        }
      } catch (error) {
        // The timeline insert failed after a document was uploaded: roll the
        // document back so the project is not left with an orphaned record.
        if (uploadedDocument?.id) {
          try {
            await supabase.from('documents').delete().eq('id', uploadedDocument.id);
          } catch (cleanupError) {
            console.error('[ProjectDetail] failed to clean up uploaded document row:', cleanupError);
          }
          if (uploadedDocument.storage_path) {
            try {
              await supabase.storage.from('documents').remove([uploadedDocument.storage_path]);
            } catch (cleanupError) {
              console.error('[ProjectDetail] failed to clean up uploaded document file:', cleanupError);
            }
          }
        }
        throw error;
      }
    } finally {
      setEntryUploading(false);
    }
  };

  // Remove a timeline submission (association only — the linked document,
  // if any, is preserved). RLS restricts deletion to admins; the button
  // is gated accordingly and failures are user-friendly.
  const handleRemoveEntry = async () => {
    if (!entryToDelete) return;
    setEntryDeleting(true);
    try {
      const { error } = await supabase.from('project_timeline').delete().eq('id', entryToDelete.id);
      if (error) throw error;
      try {
        await supabase.rpc('write_audit_log', {
          p_action_type: 'TIMELINE_DELETE',
          p_message: 'Timeline entry removed',
          p_entity_type: 'project_timeline',
          p_entity_id: entryToDelete.id,
          p_project_id: id,
          p_details: { title: entryToDelete.title },
        });
      } catch (auditError) {
        logAppError('ProjectDetail', auditError, { operation: 'audit-timeline-delete' });
      }
      toast.success(t('timelineEntryRemoved') || 'Timeline entry removed.');
      queryClient.invalidateQueries({ queryKey: ['timeline', id] });
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      setEntryToDelete(null);
    } catch (err) {
      logAppError('ProjectDetail', err, { operation: 'remove-timeline-entry' });
      toast.error(t('errorsTimelineRemove', "We couldn't remove this timeline item. Please try again."));
    } finally {
      setEntryDeleting(false);
    }
  };

  const handleManualProgressSave = async () => {
    const value = Number(manualProgress);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      toast.error(t('progressRangeError') || 'Progress must be between 0 and 100.');
      return;
    }
    setProgressSaving(true);
    try {
      await updateMutation.mutateAsync({ progress_mode: 'manual', manual_progress: Math.round(value), progress: Math.round(value) });
      try {
        await supabase.rpc('write_audit_log', {
          p_action_type: 'PROJECT_PROGRESS_OVERRIDE',
          p_message: 'Project progress manually overridden',
          p_entity_type: 'project',
          p_entity_id: id,
          p_project_id: id,
          p_details: { manual_progress: Math.round(value) },
        });
      } catch (auditError) {
        logAppError('ProjectDetail', auditError, { operation: 'audit-progress-override' });
      }
      toast.success(t('progressSaved') || 'Progress saved.');
    } catch (err) {
      logAppError('ProjectDetail', err, { operation: 'save-manual-progress' });
      toast.error(t('errorsProjectSave', "We couldn't save the project changes. Please try again."));
    } finally {
      setProgressSaving(false);
    }
  };

  const handleAutomaticProgress = async () => {
    setProgressSaving(true);
    try {
      const recalculated = computeAutoProgress(timeline.length);
      await updateMutation.mutateAsync({ progress_mode: 'auto', manual_progress: null, progress: recalculated });
      toast.success(t('progressAutomatic') || 'Automatic progress restored.');
    } catch (err) {
      logAppError('ProjectDetail', err, { operation: 'restore-auto-progress' });
      toast.error(t('errorsProjectSave', "We couldn't save the project changes. Please try again."));
    } finally {
      setProgressSaving(false);
    }
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
          <div className="flex items-center gap-2">
            {isAdmin && project?.status === 'archived' && (
              <Button variant="outline" size="sm" onClick={() => restoreMutation.mutate()} className="gap-2" disabled={restoreMutation.isPending}>
                <ArchiveRestore className="w-3.5 h-3.5" /> {t('restoreProject') || 'Restore'}
              </Button>
            )}
            {isAdmin && project?.status !== 'archived' && (
              <Button variant="outline" size="sm" onClick={() => archiveMutation.mutate()} className="gap-2" disabled={archiveMutation.isPending}>
                <Archive className="w-3.5 h-3.5" /> {t('archive')}
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setShowEdit(true)} className="gap-2">
                <Pencil className="w-3.5 h-3.5" /> {t('edit')}
              </Button>
            )}
            {isSuperAdminLive && (
              <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)} className="gap-2">
                <Trash2 className="w-3.5 h-3.5" /> {t('deleteProject')}
              </Button>
            )}
          </div>
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
                <VisibilityBadge value={project.visibility || 'private'} />
                {clientName && <span className="text-sm text-muted-foreground">{t('clientLabel')}: {clientName}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 w-40">
              <Progress value={getEffectiveProgress(project)} className="h-2" indicatorClassName={getPriorityProgressClass(project?.priority)} />
              <span className="text-sm font-medium whitespace-nowrap">
                {getEffectiveProgress(project)}%
                {isManualProgressMode(project) ? ` ${t('manual') || '(manual)'}` : ''}
              </span>
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

        {/* Progress — automatic from timeline (+5% each, max 100%) with
            super-admin manual override. Authoritative value is database-
            backed (trigger in auto mode, stored override in manual). */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" aria-hidden />
              <h3 className="font-heading font-semibold">{t('progress') || 'Progress'}</h3>
              <span className="text-sm font-medium">{getEffectiveProgress(project)}%</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                {isManualProgressMode(project) ? (t('manual') || 'Manual') : (t('automatic') || 'Automatic')}
              </span>
            </div>
            {isSuperAdminLive && (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={manualProgress}
                  onChange={(e) => setManualProgress(e.target.value)}
                  placeholder={t('manualProgressPlaceholder') || '0–100'}
                  aria-label={t('manualProgressPlaceholder') || 'Manual progress value'}
                  className="w-24 h-8"
                />
                <Button size="sm" variant="outline" disabled={progressSaving} onClick={handleManualProgressSave}>
                  {t('setManual') || 'Set manual'}
                </Button>
                {isManualProgressMode(project) && (
                  <Button size="sm" variant="ghost" disabled={progressSaving} onClick={handleAutomaticProgress}>
                    {t('useAutomatic') || 'Use automatic'}
                  </Button>
                )}
              </div>
            )}
          </div>
          {!isManualProgressMode(project) && (
            <p className="text-xs text-muted-foreground mt-2">
              {t('progressAutoHint') || 'Each timeline submission adds 5% (max 100%).'}
            </p>
          )}
        </div>

        {/* Team Assignment — super admin only. Explicit Save workflow: the
            dropdown only stages a selection; Save persists it, so the
            assignment can never be cleared accidentally. */}
        {isSuperAdminLive && (
        <section>
          <h3 className="font-heading font-semibold mb-3">{t('teamAssignment')}</h3>
          <div className="bg-card rounded-xl border border-border p-4 max-w-sm space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">{t('projectManager')}</label>
              <ProjectAssignmentDropdown
                value={managerTouched ? pendingManagerId : project.manager_id}
                onChange={(newValue) => {
                  setPendingManagerId(newValue);
                  setManagerTouched(true);
                }}
              />
            </div>
            <Button
              size="sm"
              disabled={!managerTouched || managerSaving}
              onClick={async () => {
                setManagerSaving(true);
                try {
                  await updateMutation.mutateAsync({ manager_id: pendingManagerId });
                  try {
                    await supabase.rpc('write_audit_log', {
                      p_action_type: 'TEAM_ASSIGNED',
                      p_message: 'Project team assignment updated',
                      p_entity_type: 'project',
                      p_entity_id: id,
                      p_project_id: id,
                      p_details: { manager_id: pendingManagerId },
                    });
                  } catch (auditError) {
                    console.error('[ProjectDetail] team assignment audit failed:', auditError);
                  }
                  toast.success(t('teamAssignmentSaved') || 'Team assignment saved.');
                  setManagerTouched(false);
                } catch (err) {
                  handleMutationError(err, t, toast);
                } finally {
                  setManagerSaving(false);
                }
              }}
            >
              {managerSaving && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              {t('save')}
            </Button>
          </div>
        </section>
        )}

        {/* Assigned Team Members — super admin or project member */}
        {canSeeTeam && projectMembers.length > 0 && (
        <section>
          <h3 className="font-heading font-semibold mb-3">{t('teamMembers')}</h3>
          <div className="space-y-2">
            {projectMembers.map((pm) => {
              const profile = pm.profiles;
              const roleName = profile?.roles?.name || '';
              return (
                <div key={pm.id} className="bg-card rounded-xl border border-border p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-9 h-9">
                      <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
                        {getInitials(profile?.full_name || profile?.email || '?')}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-sm">{profile?.full_name || profile?.email || t('unknown')}</p>
                      <p className="text-xs text-muted-foreground capitalize">{roleName.replace(/_/g, ' ')}</p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {pm.assigned_at ? format(new Date(pm.assigned_at), 'MMM d, yyyy') : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
        )}

        {/* Project Timeline Section */}
        <section className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-heading font-semibold">{t('projectTimeline')}</h3>
            {canAddEntry && (
              <Button size="sm" variant="outline" onClick={() => setAddingEntry(!addingEntry)} className="gap-2">
                <Plus className="w-3.5 h-3.5" /> {t('addEntry')}
              </Button>
            )}
          </div>

          {addingEntry && (
            <div className="bg-card rounded-xl border border-border p-4 space-y-3 mb-4">
              <Input placeholder={t('entryTitle')} value={newEntry.title} onChange={e => setNewEntry({...newEntry, title: e.target.value})} />
              <Textarea placeholder="Description" value={newEntry.description} onChange={e => setNewEntry({...newEntry, description: e.target.value})} rows={2} />
              <DatePicker value={newEntry.date} onChange={v => setNewEntry({...newEntry, date: v})} />
              <div className="flex items-center gap-2">
                <label className="flex-1 cursor-pointer flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:border-primary/60 hover:bg-muted/50 transition-colors">
                  <Upload className="w-4 h-4" />
                  <span className="truncate">{entryFile ? entryFile.name : t('attachDocument')}</span>
                  <input
                    type="file"
                    accept={DOCUMENT_FILE_ACCEPT}
                    className="hidden"
                    onChange={e => setEntryFile(e.target.files?.[0] || null)}
                  />
                </label>
                {entryFile && (
                  <Button size="sm" variant="ghost" onClick={() => setEntryFile(null)} title={t('removeFile')}>
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
              {entryFile && (
                <div className="space-y-2">
                  <div>
                    <VisibilitySelect
                      id="entry-visibility"
                      value={entryVisibility}
                      onValueChange={value => { setEntryVisibility(value); if (value !== 'selected') setEntryAudience([]); }}
                    />
                  </div>
                  {entryVisibility === 'selected' && (
                    <AudiencePicker
                      idPrefix="entry-audience"
                      members={entryAudienceMembers}
                      selectedIds={entryAudience}
                      onToggle={(id) => setEntryAudience(previous => previous.includes(id) ? previous.filter(memberId => memberId !== id) : [...previous, id])}
                    />
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddEntry} disabled={!newEntry.title || entryUploading}>
                  {entryUploading && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                  {t('save')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setAddingEntry(false); setEntryFile(null); setEntryAudience([]); setEntryVisibility('private'); }}>{t('cancel')}</Button>
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
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="font-semibold flex items-center gap-2 flex-wrap">
                          {entry.document_id ? (
                            <FileText className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
                          ) : (
                            <Send className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
                          )}
                          <span className="truncate">{entry.title}</span>
                          {!isManualProgressMode(project) && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                              +5%
                            </span>
                          )}
                        </h4>
                        {entry.description && <p className="text-sm text-muted-foreground mt-1">{entry.description}</p>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <StatusBadge status={entry.status} />
                        {(isSuperAdminLive || isAdmin) && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title={t('removeFromTimeline') || 'Remove from timeline'}
                            aria-label={`${t('removeFromTimeline') || 'Remove from timeline'}: ${entry.title}`}
                            onClick={() => setEntryToDelete(entry)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {entry.document && <DocumentPreview document={entry.document} />}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {entry.date ? format(new Date(entry.date), 'MMM d, yyyy') : entry.created_at ? format(new Date(entry.created_at), 'MMM d, yyyy') : t('noDate')}
                      </span>
                      {entry.submitted_by && (
                        <span className="flex items-center gap-1">
                          <UserIcon className="w-3 h-3" />
                          {t('submittedBy') || 'Submitted by'}: {entry.submitted_by === userId ? (t('you') || 'You') : entry.submitted_by.slice(0, 8)}
                        </span>
                      )}
                      {entry.responsible_person && (
                        <span>{t('assignedTo')}: {entry.responsible_person}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Documents Section */}
        <section className="mt-8">
          <h3 className="font-heading font-semibold mb-4">{t('documents')}</h3>
          <div className="text-center py-12 text-muted-foreground text-sm">
            {t('projectDetailNoDocuments')}
          </div>
        </section>
      </div>

      <ProjectFormDialog
        open={showEdit}
        onOpenChange={setShowEdit}
        project={project}
        clients={clients}
        managers={managers}
        onSave={async (data) => {
          const saved = await updateMutation.mutateAsync(data);
          return saved;
        }}
      />

      <AlertDialog open={!!entryToDelete} onOpenChange={(open) => !open && setEntryToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removeFromTimeline') || 'Remove from timeline'}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('removeFromTimelineDesc') || 'This removes the timeline entry only. The linked document, if any, is preserved.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={entryDeleting}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={entryDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                handleRemoveEntry();
              }}
            >
              {entryDeleting && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              {t('remove') || 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteProjectTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteProjectDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProjectMutation.isPending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteProjectMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                deleteProjectMutation.mutate();
              }}
            >
              {deleteProjectMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              {t('deleteProjectConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}