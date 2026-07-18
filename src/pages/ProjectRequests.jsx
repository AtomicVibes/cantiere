import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import TopBar from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, ClipboardList, CheckCircle2, XCircle, Clock, ShieldCheck, Trash2 } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
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
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);

  const effectiveRole = (role || 'client').toLowerCase();
  const canCreate = PERMISSIONS.canCreateRequest.includes(effectiveRole);
  const canDelete = PERMISSIONS.canDeleteRequest.includes(effectiveRole);

  const { data: requests = [] } = useQuery({
    queryKey: ['projectRequests'],
    queryFn: getClientRequests,
    initialData: [],
  });

  const filtered = statusFilter === 'all'
    ? requests
    : requests.filter(r => r.status === statusFilter);

  const handleDelete = async (requestId) => {
    if (!window.confirm(t('confirmDeleteRequest'))) return;
    try {
      await deleteProjectRequest(requestId);
      queryClient.invalidateQueries({ queryKey: ['projectRequests'] });
    } catch {
      // error handled by caller / already logged
    }
  };

  const handleFormSuccess = () => {
    setFormOpen(false);
    queryClient.invalidateQueries({ queryKey: ['projectRequests'] });
  };

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

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <ClipboardList className="w-12 h-12 mb-3" />
            <p className="text-sm">{t('noRequests')}</p>
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
                      <div>
                        <CardTitle className="text-base">{req.project_name}</CardTitle>
                        {req.client?.company_name && (
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {req.client.company_name}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(req.id)}
                            title={t('deleteRequest')}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
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
    </div>
  );
}
