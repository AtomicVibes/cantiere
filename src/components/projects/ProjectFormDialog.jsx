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

const defaultForm = {
  name: '',
  type: 'construction',
  status: 'draft',
  priority: 'medium',
  description: '',
  client_id: '',
  start_date: '',
  end_date: '',
  location: '',
  budget: '',
  progress: 0,
};

export default function ProjectFormDialog({ open, onOpenChange, project, clients, onSave }) {
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
  const isEditing = !!project;

  useEffect(() => {
    if (open) {
      if (project) {
        setForm({
          name: project.name || '',
          type: project.type || 'construction',
          status: project.status || 'draft',
          priority: project.priority || 'medium',
          description: project.description || '',
          client_id: project.client_id || '',
          start_date: project.start_date || '',
          end_date: project.end_date || '',
          location: project.location || '',
          budget: project.budget ?? '',
          progress: project.progress ?? 0,
        });
      } else {
        setForm(defaultForm);
      }
    }
  }, [open, project]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const perm = isEditing ? PERMISSIONS.canEditProject : PERMISSIONS.canCreateProject;
    if (!perm.includes(role)) {
      toast.error(t('accessDenied'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        budget: form.budget ? Number(form.budget) : null,
        progress: Number(form.progress) || 0,
      };
      if (!payload.start_date) delete payload.start_date;
      if (!payload.end_date) delete payload.end_date;
      if (!payload.location) delete payload.location;
      if (!payload.client_id) delete payload.client_id;
      await onSave(payload);
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
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="status">{t('status')}</Label>
              <Select value={form.status} onValueChange={set('status')}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Input id="start_date" type="date" value={form.start_date} onChange={(e) => set('start_date')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_date">{t('endDate')}</Label>
              <Input id="end_date" type="date" value={form.end_date} onChange={(e) => set('end_date')(e.target.value)} />
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

          <div className="flex justify-end gap-3 pt-2">
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
