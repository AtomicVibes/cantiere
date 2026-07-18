import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/services/supabase';
import { createProjectRequest, uploadProjectDoc } from '@/services/requestService';
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
  const fileInputRef = useRef(null);
  const [form, setForm] = useState({
    project_name: '',
    description: '',
    category: '',
    budget: '',
    estimated_deadline: '',
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const today = new Date().toISOString().split('T')[0];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.project_name.trim()) return;
    setSubmitting(true);

    try {
      let document_url = '';
      if (file) {
        const { data: { session } } = await supabase.auth.getSession();
        const uploadResult = await uploadProjectDoc(file, session?.user?.id || 'unknown');
        document_url = uploadResult.path;
      }

      await createProjectRequest({
        project_name: form.project_name.trim(),
        description: form.description.trim() || undefined,
        category: form.category || undefined,
        budget: form.budget ? Number(form.budget) : undefined,
        estimated_deadline: form.estimated_deadline || undefined,
        document_url: document_url || undefined,
        client_id: (await supabase.auth.getUser()).data.user?.id,
      });

      setForm({ project_name: '', description: '', category: '', budget: '', estimated_deadline: '' });
      clearFile();
      toast.success(t('requestSubmitted'));

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { data: clientRecord } = await supabase
            .from('clients')
            .select('id')
            .eq('profile_id', session.user.id)
            .maybeSingle();
          if (!clientRecord) {
            toast.info(t('companyDetailsNote'));
          }
        }
      } catch {
        // non-critical post-submission hint
      }

      onSuccess?.();
    } catch {
      toast.error(t('submissionError'));
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
          className="min-h-[44px]"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="req-category" className="text-sm font-medium">{t('category')}</Label>
        <Select value={form.category} onValueChange={set('category')}>
          <SelectTrigger id="req-category" className="min-h-[44px]">
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
        <Label htmlFor="req-budget" className="text-sm font-medium">{t('budgetEuro')}</Label>
        <Input
          id="req-budget"
          type="number"
          min="0"
          step="0.01"
          value={form.budget}
          onChange={(e) => set('budget')(e.target.value)}
          className="min-h-[44px]"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="req-deadline" className="text-sm font-medium">
          Estimated deadline
        </Label>
        <Input
          id="req-deadline"
          type="date"
          value={form.estimated_deadline}
          onChange={(e) => set('estimated_deadline')(e.target.value)}
          min={today}
          className="min-h-[44px]"
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
          >
            <Upload className="w-4 h-4" />
            {t('chooseFile') || t('upload')}
          </label>
          <input
            ref={fileInputRef}
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
      >
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {submitting ? t('submitting') || t('saving') : t('submit')}
      </Button>
    </form>
  );
}
