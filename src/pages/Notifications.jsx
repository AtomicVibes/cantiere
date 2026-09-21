import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import TopBar from '@/components/layout/TopBar';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Archive,
  AlertCircle,
  Bell,
  CheckCheck,
  Loader2,
  RotateCcw,
  Trash2,
  ArrowRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { useUserRole } from '@/hooks/useUserRole';
import { useIsSuperAdmin } from '@/hooks/useIsSuperAdmin';
import { PERMISSIONS } from '@/lib/permissions';
import { handleMutationError } from '@/lib/rbac';
import {
  getNotificationIcon,
  getNotificationLabelKey,
  resolveNotificationDestination,
} from '@/lib/notificationConfig';

const PRIORITY_STYLES = {
  high: 'border-l-destructive',
  medium: 'border-l-amber-400',
  low: 'border-l-border',
};

const PAGE_SIZE = 50;

export default function Notifications() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { user, isLoadingAuth } = useAuth();
  const { role } = useUserRole();
  const canManage = PERMISSIONS.canManageNotifications.includes(role);
  const { isSuperAdmin } = useIsSuperAdmin();

  const [view, setView] = useState('active');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [mutating, setMutating] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const navigate = useNavigate();

  const userId = user?.id;

  // Query key is scoped to the authenticated user so session/user changes
  // refetch automatically and never surface another account's cached rows.
  // The ['notifications'] prefix is kept so the bell can invalidate it.
  const notificationsQueryKey = useMemo(
    () => ['notifications', userId, pageSize],
    [userId, pageSize]
  );

  const {
    data: notifications = [],
    isLoading: notificationsLoading,
    isFetching: notificationsFetching,
    error: notificationsError,
    refetch: refetchNotifications,
  } = useQuery({
    queryKey: notificationsQueryKey,
    // Never query before the authenticated session (and its user id) is ready.
    enabled: !!userId,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        // Explicit per-user predicate for the query; RLS is the real boundary.
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(0, pageSize - 1);
      if (error) throw error;
      return data ?? [];
    },
  });

  const canLoadMore = notifications.length === pageSize;

  const currentNotifications = useMemo(
    () => notifications.filter(n => (view === 'archived' ? n.archived : !n.archived)),
    [notifications, view]
  );

  const handleNotificationClick = useCallback(async (notif) => {
    if (!notif.is_read) {
      try {
        await base44.entities.Notification.update(notif.id, { is_read: true });
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      } catch (err) {
        console.error('Failed to mark notification as read:', err);
      }
    }
    navigate(resolveNotificationDestination(notif, { isSuperAdmin }));
  }, [navigate, queryClient, isSuperAdmin]);

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Notification.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (err) => handleMutationError(err, t, toast),
  });

  const markAllRead = async () => {
    if (!canManage) {
      toast.error(t('accessDenied'));
      return;
    }
    const unread = notifications.filter(n => !n.is_read);
    await Promise.all(unread.map(n => base44.entities.Notification.update(n.id, { is_read: true })));
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const allVisibleSelected = currentNotifications.length > 0 && currentNotifications.every(n => selectedIds.has(n.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(currentNotifications.map(n => n.id)));
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

  const auditNotifications = (ids, actionType) => {
    const rows = notifications.filter(n => ids.includes(n.id));
    Promise.all(rows.map(n => supabase.rpc('write_audit_log', {
      p_action_type: actionType,
      p_message: actionType === 'NOTIFICATION_DELETE'
        ? 'Notification deleted'
        : actionType === 'NOTIFICATION_ARCHIVE'
          ? 'Notification archived'
          : 'Notification restored',
      p_entity_type: 'notification',
      p_entity_id: n.id,
      p_details: { type: n.type, message: n.message, user_id: n.user_id, archived: n.archived },
    }))).catch(() => {});
  };

  const setNotificationsArchived = async (ids, archived) => {
    const idsArr = Array.isArray(ids) ? ids : [ids];
    if (idsArr.length === 0) return;

    const action = archived ? 'archive' : 'restore';
    const doneLabel = archived ? 'Archived' : 'Restored';
    const permissionMessage = `You don't have permission to ${action} this notification.`;

    setMutating(true);
    try {
      const results = await Promise.all(idsArr.map(async (id) => {
        try {
          await base44.entities.Notification.update(id, { archived });
          return { id, ok: true };
        } catch (error) {
          if (error?.code !== 'UPDATE_NOT_APPLIED') return { id, ok: false, error };
          const { data: existing } = await supabase
            .from('notifications')
            .select('id')
            .eq('id', id)
            .maybeSingle();
          return { id, ok: false, error, missing: !existing };
        }
      }));

      const updatedIds = results.filter(r => r.ok).map(r => r.id);
      const missing = results.filter(r => !r.ok && r.missing);
      const denied = results.filter(r => !r.ok && !r.missing);

      if (updatedIds.length > 0) {
        queryClient.setQueryData(notificationsQueryKey, (previous) =>
          (previous || []).map(item => updatedIds.includes(item.id) ? { ...item, archived } : item));
        setSelectedIds(prev => {
          const remaining = new Set(prev);
          updatedIds.forEach(id => remaining.delete(id));
          return remaining;
        });
        auditNotifications(updatedIds, archived ? 'NOTIFICATION_ARCHIVE' : 'NOTIFICATION_RESTORE');
      }
      if (updatedIds.length > 0 || missing.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      }

      if (updatedIds.length === idsArr.length) {
        toast.success(`${doneLabel} ${updatedIds.length} notification${updatedIds.length !== 1 ? 's' : ''}`);
      } else if (updatedIds.length > 0) {
        const details = [];
        if (denied.length > 0) details.push(`${denied.length} could not be updated`);
        if (missing.length > 0) details.push(`${missing.length} no longer exists`);
        toast.warning(`${doneLabel} ${updatedIds.length} of ${idsArr.length} notifications. ${details.join(' and ')}.`);
      } else if (denied.length > 0) {
        toast.error(permissionMessage);
      } else {
        toast.warning('This notification is no longer available. The list has been refreshed.');
      }
    } catch (error) {
      toast.error(error.message || `Unable to ${action} this notification. Please try again.`);
    } finally {
      setMutating(false);
    }
  };

  const executeArchive = (ids) => setNotificationsArchived(ids, true);
  const executeRestore = (ids) => setNotificationsArchived(ids, false);

  const handleDeleteConfirm = (mode, id) => {
    setDeleteTarget({ mode, id });
    setConfirmDeleteOpen(true);
  };

  const executeDelete = async () => {
    const ids = deleteTarget?.mode === 'selected'
      ? [...selectedIds]
      : deleteTarget?.mode === 'single' && deleteTarget.id
        ? [deleteTarget.id]
        : [];

    if (ids.length === 0) {
      setConfirmDeleteOpen(false);
      setDeleteTarget(null);
      return;
    }

    setMutating(true);
    try {
      const results = await Promise.all(ids.map(async (id) => {
        try {
          await base44.entities.Notification.delete(id);
          return { id, dbDeleted: true };
        } catch (error) {
          return { id, dbDeleted: false, error };
        }
      }));

      const deletedIds = results.filter(r => r.dbDeleted).map(r => r.id);
      const deleteFailures = results.filter(r => !r.dbDeleted);

      if (deletedIds.length > 0) {
        queryClient.setQueryData(notificationsQueryKey, (previous) =>
          (previous || []).filter(item => !deletedIds.includes(item.id)));
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
        setSelectedIds(prev => {
          const remaining = new Set(prev);
          deletedIds.forEach(id => remaining.delete(id));
          return remaining;
        });
        auditNotifications(deletedIds, 'NOTIFICATION_DELETE');
      }

      setConfirmDeleteOpen(false);
      setDeleteTarget(null);

      if (deleteFailures.length === 0) {
        toast.success(`Deleted ${deletedIds.length} notification${deletedIds.length !== 1 ? 's' : ''}`);
      } else if (deletedIds.length > 0) {
        toast.warning(`Deleted ${deletedIds.length} of ${ids.length} notification${ids.length !== 1 ? 's' : ''}. ${deleteFailures.length} could not be deleted.`);
      } else {
        const firstError = deleteFailures[0]?.error;
        toast.error(firstError?.code === 'DELETE_NOT_APPLIED'
          ? 'The notification was not deleted. It may have already been removed, or you may not have permission to delete it.'
          : (firstError?.message || 'Failed to delete the notification. Please try again.'));
      }
    } catch (err) {
      toast.error(err.message || 'Failed to delete the notification. Please try again.');
    } finally {
      setMutating(false);
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div>
      <TopBar title={t('notifications')} />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-heading font-semibold">{t('notifications')}</h2>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="bg-primary/10 text-primary">{unreadCount} unread</Badge>
            )}
          </div>
          {unreadCount > 0 && canManage && (
            <Button variant="outline" size="sm" onClick={markAllRead} className="gap-2">
              <CheckCheck className="w-4 h-4" /> Mark all read
            </Button>
          )}
        </div>

        {isSuperAdmin && (
          <div className="flex items-center gap-1 border-b border-border pb-3">
            <button
              onClick={() => handleViewChange('active')}
              className={cn(
                "px-4 py-1.5 text-sm rounded-md transition-colors",
                view === 'active' ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Active
            </button>
            <button
              onClick={() => handleViewChange('archived')}
              className={cn(
                "px-4 py-1.5 text-sm rounded-md transition-colors",
                view === 'archived' ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Archived
            </button>
          </div>
        )}

        {isSuperAdmin && currentNotifications.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAll} />
              Select All
            </label>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              {view === 'active' ? (
                <>
                  <Button variant="outline" size="sm" className="gap-2" disabled={mutating || selectedIds.size === 0} onClick={() => executeArchive([...selectedIds])}>
                    <Archive className="w-3.5 h-3.5" /> Archive Selected
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" disabled={mutating} onClick={() => executeArchive(currentNotifications.map(n => n.id))}>
                    <Archive className="w-3.5 h-3.5" /> Archive All
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" className="gap-2" disabled={mutating || selectedIds.size === 0} onClick={() => executeRestore([...selectedIds])}>
                    <RotateCcw className="w-3.5 h-3.5" /> Restore Selected
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" disabled={mutating} onClick={() => executeRestore(currentNotifications.map(n => n.id))}>
                    <RotateCcw className="w-3.5 h-3.5" /> Restore All
                  </Button>
                </>
              )}
              <Button variant="destructive" size="sm" className="gap-2" disabled={mutating || selectedIds.size === 0} onClick={() => handleDeleteConfirm('selected')}>
                <Trash2 className="w-3.5 h-3.5" /> Delete Selected
              </Button>
            </div>
            {mutating && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
        )}

        {(notificationsLoading || (isLoadingAuth && !userId)) ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">{t('loading')}</span>
          </div>
        ) : notificationsError ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <AlertCircle className="w-8 h-8 text-destructive" />
            <div>
              <p className="text-sm font-medium">Couldn't load your notifications</p>
              <p className="text-sm text-muted-foreground">{notificationsError.message}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchNotifications()}>Try again</Button>
          </div>
        ) : currentNotifications.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications" description={view === 'archived' ? 'No archived notifications' : "You're all caught up!"} />
        ) : (
          <>
            <div className="space-y-2">
            {currentNotifications.map(notif => {
              const Icon = getNotificationIcon(notif.type);
              const labelKey = getNotificationLabelKey(notif.type);
              const label = t(labelKey);
              const showLabel = label && label !== labelKey;
              return (
                <div
                  key={notif.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleNotificationClick(notif)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleNotificationClick(notif); }}
                  className={cn(
                    "bg-card rounded-lg border border-border border-l-4 p-4 flex items-start gap-3 transition-colors cursor-pointer hover:bg-accent/50",
                    !notif.is_read && "bg-primary/[0.02]",
                    PRIORITY_STYLES[notif.priority] || PRIORITY_STYLES.low
                  )}
                >
                  {isSuperAdmin && (
                    <div className="flex items-center gap-1 pt-0.5 flex-shrink-0">
                      <Checkbox
                        checked={selectedIds.has(notif.id)}
                        onCheckedChange={() => toggleSelect(notif.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  )}
                  <div className={cn("p-2 rounded-lg flex-shrink-0", !notif.is_read ? "bg-primary/10" : "bg-muted")}>
                    <Icon className={cn("w-4 h-4", !notif.is_read ? "text-primary" : "text-muted-foreground")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className={cn("text-sm font-medium", !notif.is_read && "font-semibold")}>
                        {showLabel ? label : (notif.title || '')}
                      </h4>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {notif.created_at ? format(new Date(notif.created_at), 'MMM d, h:mm a') : ''}
                      </span>
                    </div>
                    {notif.message && <p className="text-sm text-muted-foreground mt-0.5">{notif.message}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs flex-shrink-0 z-10"
                      onClick={(e) => { e.stopPropagation(); handleNotificationClick(notif); }}
                    >
                      <ArrowRight className="w-3.5 h-3.5 mr-1" /> {t('moreDetails')}
                    </Button>
                    {isSuperAdmin && (
                      <div className="flex flex-col gap-1 z-10">
                        {view === 'active' ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); executeArchive(notif.id); }}
                            disabled={mutating}
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                            title="Archive"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); executeRestore(notif.id); }}
                            disabled={mutating}
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                            title="Restore"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteConfirm('single', notif.id); }}
                          disabled={mutating}
                          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    {!notif.is_read && canManage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs flex-shrink-0 z-10"
                        onClick={(e) => { e.stopPropagation(); updateMutation.mutate({ id: notif.id, data: { is_read: true } }); }}
                      >
                        Mark read
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            </div>
            {canLoadMore && (
              <div className="flex justify-center pt-2">
                <Button variant="outline" size="sm" disabled={notificationsFetching} onClick={() => setPageSize(size => size + PAGE_SIZE)}>
                  {notificationsFetching && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Load more
                </Button>
              </div>
            )}
          </>
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
              onClick={executeDelete}
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