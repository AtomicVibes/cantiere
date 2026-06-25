import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/services/supabase';
import { createProjectRequest } from '@/services/requestService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Upload, X, FileText } from 'lucide-react';
import { toast } from 'sonner';

const CATEGORIES = [
  { value: 'construction', labelKey: 'construction' },
  { value: 'renovation', labelKey: 'renovation' },
  { value: 'architecture', labelKey: 'architecture' },
  { value: 'engineering', labelKey: 'engineering' },
  { value: 'consulting', labelKey: 'consulting' },
  { value: 'other', labelKey: 'other' },
];

export default function ProjectRequestForm({ onSuccess }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    project_name: '',
    description: '',
    category: '',
    address: '',
    budget: '',
  });
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  };

  const clearFile = () => {
    setFile(null);
    const el = document.getElementById('request-doc-upload');
    if (el) el.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.project_name.trim()) return;
    setSubmitting(true);
    try {
      const result = await createProjectRequest({
        project_name: form.project_name.trim(),
        description: form.description.trim() || undefined,
        category: form.category || undefined,
        address: form.address.trim() || undefined,
        budget: form.budget ? Number(form.budget) : undefined,
      });

      if (file && result?.request?.id) {
        const { data: { session } } = await supabase.auth.getSession();
        const { data: clientRecord } = await supabase
          .from('clients')
          .select('id')
          .eq('profile_id', session.user.id)
          .single();

        if (clientRecord) {
          const fileExt = file.name.split('.').pop();
          const fileName = `${clientRecord.id}/${result.request.id}/${Date.now()}.${fileExt}`;
          const { error: uploadError } = await supabase.storage
            .from('project-docs')
            .upload(fileName, file, { cacheControl: '3600', upsert: false });

          if (uploadError) {
            console.error('File upload failed:', uploadError);
            toast.error(t('uploadFailed'));
          }
        }
      }

      setForm({ project_name: '', description: '', category: '', address: '', budget: '' });
      clearFile();
      toast.success(t('requestSubmitted'));
      onSuccess?.();
    } catch (err) {
      console.error('Failed to create request:', err);
      toast.error(err.message || t('error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="req-project_name" className="text-sm font-medium">
          {t('projectName')} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="req-project_name"
          value={form.project_name}
          onChange={(e) => set('project_name')(e.target.value)}
          required
          className="min-h-[44px] text-[clamp(0.875rem,1.5vw,1rem)]"
          style={{ fontSize: 'clamp(0.875rem, 1.5vw, 1rem)' }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="req-category" className="text-sm font-medium">{t('category')}</Label>
        <Select value={form.category} onValueChange={set('category')}>
          <SelectTrigger
            id="req-category"
            className="min-h-[44px]"
            style={{ fontSize: 'clamp(0.875rem, 1.5vw, 1rem)' }}
          >
            <SelectValue placeholder={t('selectCategory') || t('select')} />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                {t(cat.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="req-address" className="text-sm font-medium">{t('address') || 'Address'}</Label>
        <Input
          id="req-address"
          value={form.address}
          onChange={(e) => set('address')(e.target.value)}
          className="min-h-[44px]"
          style={{ fontSize: 'clamp(0.875rem, 1.5vw, 1rem)' }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="req-budget" className="text-sm font-medium">{t('budgetEuro')}</Label>
        <Input
          id="req-budget"
          type="number"
          min="0"
          step="0.01"
          value={form.budget}
          onChange={(e) => set('budget')(e.target.value)}
          className="min-h-[44px]"
          style={{ fontSize: 'clamp(0.875rem, 1.5vw, 1rem)' }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="req-description" className="text-sm font-medium">{t('description')}</Label>
        <Textarea
          id="req-description"
          value={form.description}
          onChange={(e) => set('description')(e.target.value)}
          rows={3}
          className="min-h-[44px] resize-y"
          style={{ fontSize: 'clamp(0.875rem, 1.5vw, 1rem)' }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="request-doc-upload" className="text-sm font-medium">
          {t('uploadDocument')}
        </Label>
        <div className="flex items-center gap-3">
          <label
            htmlFor="request-doc-upload"
            className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-input bg-transparent text-sm font-medium cursor-pointer hover:bg-accent min-h-[44px] transition-colors"
            style={{ fontSize: 'clamp(0.875rem, 1.5vw, 1rem)' }}
          >
            <Upload className="w-4 h-4" />
            {t('chooseFile') || t('upload')}
          </label>
          <input
            id="request-doc-upload"
            type="file"
            onChange={handleFileChange}
            className="hidden"
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.dwg,.dxf,.zip"
          />
        </div>
        {file && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted text-sm">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="truncate flex-1">{file.name}</span>
            <button
              type="button"
              onClick={clearFile}
              className="p-1.5 rounded-md hover:bg-accent transition-colors"
              style={{ minWidth: '44px', minHeight: '44px' }}
              aria-label={t('removeFile') || 'Remove file'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <Button
        type="submit"
        disabled={submitting}
        className="w-full min-h-[44px]"
        style={{ fontSize: 'clamp(0.875rem, 1.5vw, 1rem)' }}
      >
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {submitting ? t('submitting') || t('saving') : t('submit')}
      </Button>
    </form>
  );
}
