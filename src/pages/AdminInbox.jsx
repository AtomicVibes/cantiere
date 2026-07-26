import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import TopBar from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Loader2,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  ClipboardList,
  Archive,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { supabase } from '@/services/supabase';
import {
  verifyProjectRequest,
  approveProjectRequest,
  rejectProjectRequest,
  deleteProjectRequest,
} from '@/services/requestService';
import { REQUEST_STATUSES } from '@/constants';
import { toast } from 'sonner';
import { useIsSuperAdmin } from '@/hooks/useIsSuperAdmin';

const statusConfig = {
  [REQUEST_STATUSES.PENDING]: { icon: Clock, variant: 'secondary', labelKey: 'pending' },
  [REQUEST_STATUSES.VERIFICATION]: { icon: ShieldCheck, variant: 'warning', labelKey: 'verification' },
  [REQUEST_STATUSES.VALIDATED]: { icon: CheckCircle2, variant: 'success', labelKey: 'validated' },
  [REQUEST_STATUSES.REJECTED]: { icon: XCircle, variant: 'destructive', labelKey: 'rejected' },
};

async function fetchAllRequests(archived) {
  const eq = archived !== undefined ? `.eq('archived', ${archived})` : '';
  const queries = [REQUEST_STATUSES.PENDING, REQUEST_STATUSES.VERIFICATION, REQUEST_STATUSES.VALIDATED, REQUEST_STATUSES.REJECTED].map(status =>
    supabase
      .from('project_requests')
      .select('*, client:client_id(company_name)')
      .eq('status', status)
      .eq('archived', archived)
      .order('created_at', { ascending: false })
  );
  const [pendingRes, verificationRes, validatedRes, rejectedRes] = await Promise.all(queries);
  if (pendingRes.error) throw pendingRes.error;
  if (verificationRes.error) throw verificationRes.error;
  if (validatedRes.error) throw validatedRes.error;
  if (rejectedRes.error) throw rejectedRes.error;
  return {
    [REQUEST_STATUSES.PENDING]: pendingRes.data ?? [],
    [REQUEST_STATUSES.VERIFICATION]: verificationRes.data ?? [],
    [REQUEST_STATUSES.VALIDATED]: validatedRes.data ?? [],
    [REQUEST_STATUSES.REJECTED]: rejectedRes.data ?? [],
  };
}

export default function AdminInbox() {
  const { t } = useTranslation();
  const { isSuperAdmin } = useIsSuperAdmin();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(REQUEST_STATUSES.PENDING);
  const [rejectDialog, setRejectDialog] = useState({ open: false, requestId: null });
  const [rejectionReason, setRejectionReason] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState('active');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [mutating, setMutating] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: grouped = {}, isLoading } = useQuery({
    queryKey: ['adminRequests', view],
    queryFn: () => fetchAllRequests(view === 'archived'),
  });

  const verifyMut = useMutation({
    mutationFn: verifyProjectRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminRequests', view] });
      toast.success(t('requestVerified') || 'Request moved to verification');
    },
    onError: (err) => toast.error(err.message),
  });

  const approveMut = useMutation({
    mutationFn: approveProjectRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminRequests', view] });
      toast.success(t('requestApproved') || 'Request approved and project created');
    },
    onError: (err) => toast.error(err.message),
  });

  const rejectMut = useMutation({
    mutationFn: ({ request_id, rejection_reason }) =>
      rejectProjectRequest(request_id, rejection_reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminRequests', view] });
      toast.success(t('requestRejected') || 'Request rejected');
      setRejectDialog({ open: false, requestId: null });
      setRejectionReason('');
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
      queryClient.invalidateQueries({ queryKey: ['adminRequests', view] });
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
      queryClient.invalidateQueries({ queryKey: ['adminRequests', view] });
    },
    onError: (err) => toast.error(err.message),
  });

  const currentList = grouped[activeTab] ?? [];
  const filtered = searchQuery
    ? currentList.filter((r) =>
        r.project_name?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : currentList;

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
    setActiveTab(REQUEST_STATUSES.PENDING);
  };

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
      queryClient.invalidateQueries({ queryKey: ['adminRequests', view] });
    } catch (err) {
      toast.error(err.message || 'Failed to delete');
    } finally {
      setMutating(false);
      setConfirmDeleteOpen(false);
      setDeleteTarget(null);
    }
  };

  const tabs = [
    { value: REQUEST_STATUSES.PENDING, label: t('pending'), count: grouped[REQUEST_STATUSES.PENDING]?.length ?? 0 },
    { value: REQUEST_STATUSES.VERIFICATION, label: t('verification'), count: grouped[REQUEST_STATUSES.VERIFICATION]?.length ?? 0 },
    { value: REQUEST_STATUSES.VALIDATED, label: t('validated'), count: grouped[REQUEST_STATUSES.VALIDATED]?.length ?? 0 },
    { value: REQUEST_STATUSES.REJECTED, label: t('rejected'), count: grouped[REQUEST_STATUSES.REJECTED]?.length ?? 0 },
  ];

  const isPending = activeTab === REQUEST_STATUSES.PENDING;
  const isVerification = activeTab === REQUEST_STATUSES.VERIFICATION;
  const canApprove = isVerification;
  const canVerify = isPending;
  const canReject = isPending || isVerification;

  return (
    <div className="min-h-screen bg-background" style={{ minHeight: '100dvh' }}>
      <TopBar title={t('requestManagement')} />
      <div className="p-4 md:p-6 space-y-6" style={{ padding: 'clamp(1rem, 2.5vw, 1.5rem)' }}>
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="flex gap-1 bg-muted p-1 rounded-lg overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => { setActiveTab(tab.value); setSelectedIds(new Set()); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors min-h-[44px] ${
                  activeTab === tab.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                style={{ fontSize: 'clamp(0.75rem, 1.2vw, 0.875rem)' }}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-xs font-semibold">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('search') + '...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 min-h-[44px]"
                style={{ fontSize: 'clamp(0.875rem, 1.5vw, 1rem)' }}
              />
            </div>
          </div>
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

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <ClipboardList className="w-12 h-12 mb-3" />
            <p className="text-sm">{view === 'archived' ? 'No archived requests' : t('noRequests')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((req) => {
              const cfg = statusConfig[req.status] || statusConfig[REQUEST_STATUSES.PENDING];
              const StatusIcon = cfg.icon;
              return (
                <Card key={req.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {isSuperAdmin && (
                          <Checkbox checked={selectedIds.has(req.id)} onCheckedChange={() => toggleSelect(req.id)} />
                        )}
                        <div>
                          <CardTitle className="text-base truncate">{req.project_name}</CardTitle>
                          {req.client?.company_name && (
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {req.client.company_name}
                            </p>
                          )}
                          {req.category && (
                            <p className="text-xs text-muted-foreground mt-1">{t(req.category)}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
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
                        {isSuperAdmin && (
                          <button onClick={() => handleDeleteConfirm('single', req.id)} disabled={mutating} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <Badge variant={cfg.variant} className="gap-1 shrink-0">
                          <StatusIcon className="w-3 h-3" />
                          {t(cfg.labelKey)}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  {(req.description || req.address || req.budget) && (
                    <CardContent className="pb-3 space-y-1">
                      {req.description && (
                        <p className="text-sm text-muted-foreground">{req.description}</p>
                      )}
                      {req.address && (
                        <p className="text-xs text-muted-foreground">
                          {t('address') || 'Address'}: {req.address}
                        </p>
                      )}
                      {req.budget != null && (
                        <p className="text-xs text-muted-foreground">
                          {t('budgetEuro')}: €{Number(req.budget).toLocaleString()}
                        </p>
                      )}
                      {req.rejection_reason && (
                        <p className="text-xs text-destructive">
                          {t('rejectionReason')}: {req.rejection_reason}
                        </p>
                      )}
                    </CardContent>
                  )}
                  <CardContent className="flex flex-wrap gap-2 pt-0">
                    {canVerify && req.status === REQUEST_STATUSES.PENDING && (
                      <Button
                        size="sm"
                        variant="default"
                        className="gap-1 min-h-[44px]"
                        onClick={() => verifyMut.mutate(req.id)}
                        disabled={verifyMut.isPending}
                        style={{ fontSize: 'clamp(0.75rem, 1.2vw, 0.875rem)' }}
                      >
                        {verifyMut.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="w-4 h-4" />
                        )}
                        {t('verify')}
                      </Button>
                    )}
                    {canApprove && req.status === REQUEST_STATUSES.VERIFICATION && (
                      <Button
                        size="sm"
                        variant="default"
                        className="gap-1 min-h-[44px]"
                        onClick={() => approveMut.mutate(req.id)}
                        disabled={approveMut.isPending}
                        style={{ fontSize: 'clamp(0.75rem, 1.2vw, 0.875rem)' }}
                      >
                        {approveMut.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" />
                        )}
                        {t('approve')}
                      </Button>
                    )}
                    {canReject && (req.status === REQUEST_STATUSES.PENDING || req.status === REQUEST_STATUSES.VERIFICATION) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-destructive border-destructive hover:bg-destructive/10 min-h-[44px]"
                        onClick={() => {
                          setRejectionReason('');
                          setRejectDialog({ open: true, requestId: req.id });
                        }}
                        disabled={rejectMut.isPending}
                        style={{ fontSize: 'clamp(0.75rem, 1.2vw, 0.875rem)' }}
                      >
                        <XCircle className="w-4 h-4" />
                        {t('reject')}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Dialog
          open={rejectDialog.open}
          onOpenChange={(open) => {
            if (!open) {
              setRejectDialog({ open: false, requestId: null });
              setRejectionReason('');
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('rejectionReason')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="rejection-reason">{t('rejectionReason')}</Label>
                <textarea
                  id="rejection-reason"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={3}
                  className="flex min-h-[44px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                  placeholder={t('rejectionReason') + '...'}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setRejectDialog({ open: false, requestId: null });
                  setRejectionReason('');
                }}
                className="min-h-[44px]"
              >
                {t('cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (rejectDialog.requestId) {
                    rejectMut.mutate({
                      request_id: rejectDialog.requestId,
                      rejection_reason: rejectionReason.trim(),
                    });
                  }
                }}
                disabled={rejectMut.isPending}
                className="min-h-[44px]"
              >
                {rejectMut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t('reject')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
