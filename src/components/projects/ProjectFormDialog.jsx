import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import DatePicker from '@/components/ui/DatePicker';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { PERMISSIONS } from '@/lib/permissions';
import { handleMutationError } from '@/lib/rbac';
import { supabase } from '@/services/supabase';
import { logAppError } from '@/lib/userErrors';
import VisibilitySelect from '@/components/documents/VisibilitySelect';
import AudiencePicker from '@/components/documents/AudiencePicker';

const STANDARD_STATUSES = ['draft', 'planning', 'in_progress', 'on_hold', 'completed'];
const CUSTOM_STATUS_VALUE = '__custom__';

const defaultForm = {
  name: '',
  type: 'construction',
  status: 'draft',
  customStatus: '',
  priority: 'medium',
  description: '',
  client_id: '',
  manager_id: '',
  start_date: '',
  end_date: '',
  location: '',
  budget: '',
  progress: 0,
  visibility: 'private',
  audienceIds: [],
};

export default function ProjectFormDialog({ open, onOpenChange, project, clients, managers, onSave }) {
  const { t } = useTranslation();
  const { role } = useUserRole();
  const TYPE_OPTIONS = [
    { value: 'construction', label: t('construction') },
    { value: 'renovation', label: t('renovation') },
    { value: 'apartment_sale', label: t('apartmentSale') },
    { value: 'property_rental', label: t('propertyRental') },
    { value: 'property_management', label: t('propertyMgmt') },
    { value: 'consulting', label: t('consulting') },
    { value: 'land_acquisition', label: t('landAcquisition') },
    { value: 'architectural_study', label: t('architecturalStudy') },
    { value: 'investment', label: t('investment') },
    { value: 'other', label: t('other') },
  ];
  const STATUS_OPTIONS = [
    { value: 'draft', label: t('draft') },
    { value: 'planning', label: t('planning') },
    { value: 'in_progress', label: t('inProgress') },
    { value: 'on_hold', label: t('onHold') },
    { value: 'completed', label: t('completed') },
  ];
  const PRIORITY_OPTIONS = [
    { value: 'low', label: t('low') },
    { value: 'medium', label: t('medium') },
    { value: 'high', label: t('high') },
    { value: 'critical', label: t('critical') },
  ];
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [audienceMembers, setAudienceMembers] = useState([]);
  const isEditing = !!project;
  const isCustomStatus = form.status === CUSTOM_STATUS_VALUE;
  const effectiveStatus = isCustomStatus ? form.customStatus.trim() : form.status;

  useEffect(() => {
    if (open) {
      if (project) {
        const storedStatus = project.status || 'draft';
        const isStandard = STANDARD_STATUSES.includes(storedStatus);
        setForm({
          name: project.name || '',
          type: project.type || 'construction',
          status: isStandard ? storedStatus : CUSTOM_STATUS_VALUE,
          customStatus: isStandard ? '' : storedStatus,
          priority: project.priority || 'medium',
          description: project.description || '',
          client_id: project.client_id || '',
          manager_id: project.manager_id || '',
          start_date: project.start_date || '',
          end_date: project.end_date || '',
          location: project.location || '',
          budget: project.budget ?? '',
          progress: project.progress ?? 0,
          visibility: project.visibility || 'private',
          audienceIds: [],
        });
        // Preserve the existing audience so saving without changes never
        // clears it; loaded under audience RLS (admins manage audience).
        if (project.id) {
          supabase
            .from('project_audience')
            .select('user_id')
            .eq('project_id', project.id)
            .then(({ data, error }) => {
              if (error) {
                logAppError('ProjectForm', error, { operation: 'load-audience' });
                return;
              }
              setForm((prev) => ({ ...prev, audienceIds: (data ?? []).map((r) => r.user_id) }));
            });
        }
      } else {
        setForm(defaultForm);
      }
      supabase
        .from('profiles')
        .select('id, full_name, email')
        .order('full_name')
        .then(({ data, error }) => {
          if (error) {
            logAppError('ProjectForm', error, { operation: 'load-audience-members' });
            return;
          }
          setAudienceMembers(data ?? []);
        });
    }
  }, [open, project]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const perm = isEditing ? PERMISSIONS.canEditProject : PERMISSIONS.canCreateProject;
    if (!perm.includes(role)) {
      toast.error(t('accessDenied'));
      return;
    }
    if (isCustomStatus && !effectiveStatus) {
      toast.error(t('customStatusRequired') || 'Please enter a custom status.');
      return;
    }
    if (form.visibility === 'selected' && form.audienceIds.length === 0) {
      toast.error(t('selectAudienceRequired'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name || undefined,
        type: form.type || undefined,
        status: effectiveStatus || undefined,
        priority: form.priority || undefined,
        description: form.description || null,
        budget: form.budget ? Number(form.budget) : undefined,
        client_id: form.client_id && form.client_id !== 'none' ? form.client_id : null,
        manager_id: form.manager_id && form.manager_id !== 'none' ? form.manager_id : null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        location: form.location || null,
        progress: form.progress === '' || form.progress == null ? undefined : Number(form.progress),
        visibility: form.visibility || 'private',
      };
      const saved = await onSave(payload);
      const savedId = saved?.id || project?.id;
      // Sync the selected audience (replace set; clearing when the
      // visibility is no longer 'selected'). Isolated from the save above.
      if (savedId) {
        try {
          const { error: clearError } = await supabase
            .from('project_audience')
            .delete()
            .eq('project_id', savedId);
          if (clearError) throw clearError;
          if (form.visibility === 'selected' && form.audienceIds.length > 0) {
            const { error: insertError } = await supabase
              .from('project_audience')
              .insert(form.audienceIds.map((user_id) => ({ project_id: savedId, user_id })));
            if (insertError) throw insertError;
          }
        } catch (audError) {
          logAppError('ProjectForm', audError, { operation: 'save-audience', projectId: savedId });
          toast.error(t('audienceSaveError') || 'Project saved, but the audience could not be updated.');
        }
      }
      // Canonical audit trail (best-effort; never blocks the save).
      try {
        await supabase.rpc('write_audit_log', {
          p_action_type: isEditing ? 'PROJECT_UPDATE' : 'PROJECT_CREATE',
          p_message: isEditing ? 'Project updated' : 'Project created',
          p_entity_type: 'project',
          p_entity_id: savedId || null,
          p_project_id: savedId || null,
          p_details: { name: form.name, status: effectiveStatus, visibility: form.visibility },
        });
      } catch (auditError) {
        logAppError('ProjectForm', auditError, { operation: 'audit-project-save' });
      }
      onOpenChange(false);
    } catch (err) {
      if (!handleMutationError(err, t, toast)) {
        console.error('Failed to save project:', err);
      }
    } finally {
      setSaving(false);
    }
  };

  const set = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('editProject') : t('createProject')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t('projectName')}</Label>
            <Input id="name" value={form.name} onChange={(e) => set('name')(e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">{t('projectType')}</Label>
              <Select value={form.type} onValueChange={set('type')}>
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="client">{t('client')}</Label>
              <Select value={form.client_id} onValueChange={set('client_id')}>
                <SelectTrigger id="client">
                  <SelectValue placeholder={t('none')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('none')}</SelectItem>
                  {(clients ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.company_name || ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            </div>

          <div className="space-y-3 p-4 rounded-lg border border-border bg-card mb-6">
            <Label className="text-sm font-semibold">{t('teamAssignment') || 'Team Assignment'}</Label>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('projectManager') || 'Project Manager'}</Label>
              <Select value={form.manager_id} onValueChange={set('manager_id')}>
                <SelectTrigger id="manager">
                  <SelectValue placeholder={t('none')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('none')}</SelectItem>
                  {(managers ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.full_name || ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="status">{t('status')}</Label>
              <Select
                value={STATUS_OPTIONS.some((o) => o.value === form.status) ? form.status : CUSTOM_STATUS_VALUE}
                onValueChange={(v) => setForm((prev) => ({ ...prev, status: v }))}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_STATUS_VALUE}>{t('createCustomStatus') || '+ Create custom status'}</SelectItem>
                </SelectContent>
              </Select>
              {isCustomStatus && (
                <Input
                  value={form.customStatus}
                  onChange={(e) => set('customStatus')(e.target.value)}
                  placeholder={t('customStatusPlaceholder') || 'e.g. Awaiting Municipality Approval'}
                  maxLength={60}
                  aria-label={t('customStatusPlaceholder') || 'Custom status'}
                />
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="priority">{t('priority')}</Label>
              <Select value={form.priority} onValueChange={set('priority')}>
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t('description')}</Label>
            <textarea
              id="description"
              value={form.description}
              onChange={(e) => set('description')(e.target.value)}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start_date">{t('startDate')}</Label>
              <DatePicker id="start_date" value={form.start_date} onChange={(v) => set('start_date')(v)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_date">{t('endDate')}</Label>
              <DatePicker id="end_date" value={form.end_date} onChange={(v) => set('end_date')(v)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="location">{t('location')}</Label>
              <Input id="location" value={form.location} onChange={(e) => set('location')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="budget">{t('budgetEuro')}</Label>
              <Input id="budget" type="number" min="0" step="0.01" value={form.budget} onChange={(e) => set('budget')(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="progress">{t('progressPercentage')}</Label>
            <Input id="progress" type="number" min="0" max="100" value={form.progress} onChange={(e) => set('progress')(e.target.value)} />
          </div>

          <VisibilitySelect
            id="project-visibility"
            value={form.visibility}
            onValueChange={(v) => setForm((prev) => ({ ...prev, visibility: v, audienceIds: v === 'selected' ? prev.audienceIds : [] }))}
          />
          {form.visibility === 'selected' && (
            <AudiencePicker
              idPrefix="project-audience"
              members={audienceMembers}
              selectedIds={form.audienceIds}
              titleKey="projectAudienceTitle"
              titleFallback="Who can see the project?"
              helpKey="projectAudienceHelp"
              helpFallback="Only the selected people can view this project."
              onToggle={(id) => setForm((prev) => ({
                ...prev,
                audienceIds: prev.audienceIds.includes(id)
                  ? prev.audienceIds.filter((memberId) => memberId !== id)
                  : [...prev.audienceIds, id],
              }))}
            />
          )}

          <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-border">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isEditing ? t('saveChanges') : t('createProject')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
