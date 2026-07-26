import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/services/supabase';
import TopBar from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, ClipboardList, CheckCircle2, XCircle, Clock, ShieldCheck, Archive, RotateCcw, Trash2, Loader2 } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { useIsSuperAdmin } from '@/hooks/useIsSuperAdmin';
import { PERMISSIONS } from '@/lib/permissions';
import { getRequestStatuses, REQUEST_STATUSES } from '@/constants';
import { getClientRequests, deleteProjectRequest } from '@/services/requestService';
import ProjectRequestForm from '@/components/projects/ProjectRequestForm';

const statusConfig = {
  [REQUEST_STATUSES.PENDING]: { icon: Clock, variant: 'secondary' },
  [REQUEST_STATUSES.VERIFICATION]: { icon: ShieldCheck, variant: 'warning' },
  [REQUEST_STATUSES.VALIDATED]: { icon: CheckCircle2, variant: 'success' },
  [REQUEST_STATUSES.REJECTED]: { icon: XCircle, variant: 'destructive' },
};

export default function ProjectRequests() {
  const { t } = useTranslation();
  const { role } = useUserRole();
  const { isSuperAdmin } = useIsSuperAdmin();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [view, setView] = useState('active');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [mutating, setMutating] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const effectiveRole = (role || 'client').toLowerCase();
  const canCreate = PERMISSIONS.canCreateRequest.includes(effectiveRole);
  const canDelete = PERMISSIONS.canDeleteRequest.includes(effectiveRole);

  const { data: requests = [] } = useQuery({
    queryKey: ['projectRequests'],
    queryFn: getClientRequests,
    initialData: [],
  });

  const currentRequests = view === 'archived'
    ? requests.filter(r => r.archived)
    : requests.filter(r => !r.archived);

  const filtered = statusFilter === 'all'
    ? currentRequests
    : currentRequests.filter(r => r.status === statusFilter);

  const allVisibleSelected = filtered.length > 0 && filtered.every(r => selectedIds.has(r.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(r => r.id)));
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleViewChange = (v) => {
    setView(v);
    setSelectedIds(new Set());
  };

  const deleteMut = useMutation({
    mutationFn: deleteProjectRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectRequests'] });
      toast.success('Request deleted');
    },
    onError: (err) => toast.error(err.message),
  });

  const archiveMut = useMutation({
    mutationFn: async (ids) => {
      const idsArr = Array.isArray(ids) ? ids : [ids];
      const { error } = await supabase.from('project_requests').update({ archived: true }).in('id', idsArr);
      if (error) throw error;
    },
    onSuccess: (_data, ids) => {
      const count = Array.isArray(ids) ? ids.length : 1;
      toast.success(`Archived ${count} request${count !== 1 ? 's' : ''}`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['projectRequests'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const restoreMut = useMutation({
    mutationFn: async (ids) => {
      const idsArr = Array.isArray(ids) ? ids : [ids];
      const { error } = await supabase.from('project_requests').update({ archived: false }).in('id', idsArr);
      if (error) throw error;
    },
    onSuccess: (_data, ids) => {
      const count = Array.isArray(ids) ? ids.length : 1;
      toast.success(`Restored ${count} request${count !== 1 ? 's' : ''}`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['projectRequests'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const handleDeleteConfirm = (mode, id) => {
    setDeleteTarget({ mode, id });
    setConfirmDeleteOpen(true);
  };

  const executeBulkDelete = async () => {
    setMutating(true);
    try {
      if (deleteTarget.mode === 'selected') {
        await Promise.all([...selectedIds].map(id => deleteProjectRequest(id)));
      } else if (deleteTarget.mode === 'single') {
        await deleteProjectRequest(deleteTarget.id);
      }
      toast.success('Deleted');
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['projectRequests'] });
    } catch (err) {
      toast.error(err.message || 'Failed to delete');
    } finally {
      setMutating(false);
      setConfirmDeleteOpen(false);
      setDeleteTarget(null);
    }
  };

  const handleFormSuccess = () => {
    setFormOpen(false);
    queryClient.invalidateQueries({ queryKey: ['projectRequests'] });
  };

  useEffect(() => {
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'project_requests' },
        (payload) => {
          queryClient.setQueryData(['projectRequests'], (old) => {
            if (!old) return old;
            return old.map((req) =>
              req.id === payload.new.id ? { ...req, ...payload.new } : req
            );
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  useEffect(() => {
    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const notification = payload.new;
          supabase.auth.getUser().then(({ data: { user } }) => {
            if (user && notification.user_id === user.id) {
              toast(notification.title || notification.message, {
                description: notification.message,
              });
            }
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div>
      <TopBar title={t('projectRequests')} />
      <div className="p-6 space-y-6">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="flex gap-3 items-center">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t('allStatuses')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                {getRequestStatuses(t).map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canCreate && (
            <Dialog open={formOpen} onOpenChange={setFormOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 min-h-[44px]">
                  <Plus className="w-4 h-4" />
                  {t('newRequest')}
                </Button>
              </DialogTrigger>
              <DialogContent
                className="sm:max-w-lg"
                style={{ maxHeight: '100dvh', overflowY: 'auto' }}
              >
                <DialogHeader>
                  <DialogTitle>{t('newRequest')}</DialogTitle>
                </DialogHeader>
                <ProjectRequestForm onSuccess={handleFormSuccess} />
              </DialogContent>
            </Dialog>
          )}
        </div>

        {isSuperAdmin && (
          <div className="flex items-center gap-1 border-b border-border pb-3">
            <button
              onClick={() => handleViewChange('active')}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${view === 'active' ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Active
            </button>
            <button
              onClick={() => handleViewChange('archived')}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${view === 'archived' ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Archived
            </button>
          </div>
        )}

        {isSuperAdmin && filtered.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAll} />
              Select All
            </label>
            <div className="flex items-center gap-2 ml-auto">
              {view === 'active' ? (
                <>
                  <Button variant="outline" size="sm" className="gap-2" disabled={mutating || selectedIds.size === 0} onClick={() => archiveMut.mutate([...selectedIds])}>
                    <Archive className="w-3.5 h-3.5" /> Archive Selected
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" disabled={mutating} onClick={() => archiveMut.mutate(filtered.map(r => r.id))}>
                    <Archive className="w-3.5 h-3.5" /> Archive All
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" className="gap-2" disabled={mutating || selectedIds.size === 0} onClick={() => restoreMut.mutate([...selectedIds])}>
                    <RotateCcw className="w-3.5 h-3.5" /> Restore Selected
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" disabled={mutating} onClick={() => restoreMut.mutate(filtered.map(r => r.id))}>
                    <RotateCcw className="w-3.5 h-3.5" /> Restore All
                  </Button>
                </>
              )}
              <Button variant="destructive" size="sm" className="gap-2" disabled={mutating || selectedIds.size === 0} onClick={() => handleDeleteConfirm('selected')}>
                <Trash2 className="w-3.5 h-3.5" /> Delete Selected
              </Button>
              {mutating && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <ClipboardList className="w-12 h-12 mb-3" />
            <p className="text-sm">{view === 'archived' ? 'No archived requests' : t('noRequests')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(req => {
              const StatusIcon = statusConfig[req.status]?.icon || Clock;
              const statusVariant = statusConfig[req.status]?.variant || 'secondary';
              return (
                <Card key={req.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {isSuperAdmin && (
                          <Checkbox checked={selectedIds.has(req.id)} onCheckedChange={() => toggleSelect(req.id)} />
                        )}
                        <div>
                          <CardTitle className="text-base">{req.project_name}</CardTitle>
                          {req.client?.company_name && (
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {req.client.company_name}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isSuperAdmin && (
                          view === 'active' ? (
                            <button onClick={() => archiveMut.mutate(req.id)} disabled={mutating} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40" title="Archive">
                              <Archive className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button onClick={() => restoreMut.mutate(req.id)} disabled={mutating} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40" title="Restore">
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )
                        )}
                        {canDelete && (
                          <button onClick={() => handleDeleteConfirm('single', req.id)} disabled={mutating} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40" title={t('deleteRequest')}>
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </button>
                        )}
                        <Badge variant={statusVariant} className="gap-1">
                          <StatusIcon className="w-3 h-3" />
                          {t(req.status)}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  {req.description && (
                    <CardContent className="pb-3">
                      <p className="text-sm text-muted-foreground">{req.description}</p>
                    </CardContent>
                  )}
                  {req.rejection_reason && (
                    <CardContent className="pb-3">
                      <p className="text-xs text-destructive">
                        {t('rejectionReason')}: {req.rejection_reason}
                      </p>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Permanent Deletion</AlertDialogTitle>
            <AlertDialogDescription>
              This action is permanent and will delete everything permanently. Do you still wish to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeBulkDelete}
              disabled={mutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {mutating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirm Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
