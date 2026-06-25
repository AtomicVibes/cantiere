import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import TopBar from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { Plus, Loader2, ClipboardList, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { PERMISSIONS } from '@/lib/permissions';
import { getRequestStatuses, REQUEST_STATUSES } from '@/constants';
import { createProjectRequest, reviewProjectRequest, getClientRequests } from '@/services/requestService';

const statusConfig = {
  [REQUEST_STATUSES.PENDING]: { icon: Clock, variant: 'secondary' },
  [REQUEST_STATUSES.APPROVED]: { icon: CheckCircle2, variant: 'success' },
  [REQUEST_STATUSES.REJECTED]: { icon: XCircle, variant: 'destructive' },
};

export default function ProjectRequests() {
  const { t } = useTranslation();
  const { role } = useUserRole();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ project_name: '', description: '' });
  const [submitting, setSubmitting] = useState(false);

  const canCreate = PERMISSIONS.canCreateRequest.includes(role);
  const canReview = PERMISSIONS.canReviewRequest.includes(role);

  const { data: requests = [] } = useQuery({
    queryKey: ['projectRequests'],
    queryFn: getClientRequests,
    initialData: [],
  });

  const reviewMutation = useMutation({
    mutationFn: ({ request_id, action }) => reviewProjectRequest({ request_id, action }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projectRequests'] }),
  });

  const filtered = statusFilter === 'all'
    ? requests
    : requests.filter(r => r.status === statusFilter);

  const handleSubmitRequest = async (e) => {
    e.preventDefault();
    if (!form.project_name.trim()) return;
    setSubmitting(true);
    try {
      await createProjectRequest({
        project_name: form.project_name.trim(),
        description: form.description.trim() || undefined,
      });
      setForm({ project_name: '', description: '' });
      setFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ['projectRequests'] });
    } catch (err) {
      console.error('Failed to create request:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReview = async (request_id, action) => {
    try {
      await reviewMutation.mutateAsync({ request_id, action });
    } catch (err) {
      console.error('Failed to review request:', err);
    }
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
                <Button className="gap-2">
                  <Plus className="w-4 h-4" />
                  {t('newRequest')}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t('newRequest')}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmitRequest} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="project_name">{t('projectName')}</Label>
                    <Input
                      id="project_name"
                      value={form.project_name}
                      onChange={e => setForm({ ...form, project_name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">{t('description')}</Label>
                    <Textarea
                      id="description"
                      value={form.description}
                      onChange={e => setForm({ ...form, description: e.target.value })}
                      rows={3}
                    />
                  </div>
                  <div className="flex justify-end gap-3">
                    <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                      {t('cancel')}
                    </Button>
                    <Button type="submit" disabled={submitting}>
                      {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      {t('submit')}
                    </Button>
                  </div>
                </form>
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
                  {canReview && req.status === REQUEST_STATUSES.PENDING && (
                    <CardContent className="flex gap-2 pt-0">
                      <Button
                        size="sm"
                        variant="default"
                        className="gap-1"
                        onClick={() => handleReview(req.id, 'approved')}
                        disabled={reviewMutation.isPending}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        {t('approve')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-destructive border-destructive hover:bg-destructive/10"
                        onClick={() => handleReview(req.id, 'rejected')}
                        disabled={reviewMutation.isPending}
                      >
                        <XCircle className="w-4 h-4" />
                        {t('reject')}
                      </Button>
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
