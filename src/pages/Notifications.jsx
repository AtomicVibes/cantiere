import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';
import { base44 } from '@/api/base44Client';
import TopBar from '@/components/layout/TopBar';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Bell, CheckCheck, FolderKanban, Users, DollarSign, AlertTriangle, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { useUserRole } from '@/hooks/useUserRole';
import { PERMISSIONS } from '@/lib/permissions';
import { handleMutationError } from '@/lib/rbac';

const TYPE_ICONS = {
  project_update: FolderKanban,
  team_assignment: Users,
  invoice_change: DollarSign,
  permit_expiry: AlertTriangle,
  deadline_alert: Clock,
  general: Bell,
};

const PRIORITY_STYLES = {
  high: 'border-l-destructive',
  medium: 'border-l-amber-400',
  low: 'border-l-border',
};

export default function Notifications() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { role } = useUserRole();
  const canManage = PERMISSIONS.canManageNotifications.includes(role);

  const navigate = useNavigate();

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => base44.entities.Notification.list('-created_date'),
    initialData: [],
  });

  const handleNotificationClick = useCallback(async (notif) => {
    if (!notif.is_read && canManage) {
      await base44.entities.Notification.update(notif.id, { is_read: true });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }

    if (notif.url) {
      navigate(notif.url);
      return;
    }

    const type = notif.type;

    if (type === 'role_update' || type === 'status_change') {
      navigate('/settings');
      return;
    }

    if (type === 'project_assignment' || type === 'project_update') {
      navigate('/projects');
      return;
    }

    if (type === 'message' || type === 'new_message') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('roles:roles!profiles_role_id_fkey(name)')
        .eq('id', notif.user_id)
        .single();
      const roleName = profile?.roles?.name;
      navigate(roleName === 'super_admin' ? '/admin/messages' : '/messages');
      return;
    }

    const msg = (notif.message || '').toLowerCase();
    if (msg.includes('project')) {
      navigate('/projects');
    } else if (msg.includes('team') || msg.includes('member')) {
      navigate('/teams');
    } else if (msg.includes('invoice') || msg.includes('finance') || msg.includes('budget')) {
      navigate('/finance');
    } else {
      navigate('/dashboard');
    }
  }, [navigate, canManage, queryClient]);

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

        {notifications.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications" description="You're all caught up!" />
        ) : (
          <div className="space-y-2">
            {notifications.map(notif => {
              const Icon = TYPE_ICONS[notif.type] || Bell;
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
                  <div className={cn("p-2 rounded-lg flex-shrink-0", !notif.is_read ? "bg-primary/10" : "bg-muted")}>
                    <Icon className={cn("w-4 h-4", !notif.is_read ? "text-primary" : "text-muted-foreground")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className={cn("text-sm font-medium", !notif.is_read && "font-semibold")}>{notif.title}</h4>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {notif.created_date ? format(new Date(notif.created_date), 'MMM d, h:mm a') : ''}
                      </span>
                    </div>
                    {notif.message && <p className="text-sm text-muted-foreground mt-0.5">{notif.message}</p>}
                  </div>
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}