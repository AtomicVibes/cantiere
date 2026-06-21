import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import TopBar from '@/components/layout/TopBar';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Search, FileText, Upload, ExternalLink, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { useUserRole } from '@/hooks/useUserRole';
import { useDocumentFormFields } from '@/hooks/useFormSchema';
import { useDirection } from '@/i18n/LanguageProvider';
import { PERMISSIONS } from '@/lib/permissions';
import { handleMutationError } from '@/lib/rbac';

export default function Documents() {
  const { t } = useTranslation();
  const { dir } = useDirection();
  const { role } = useUserRole();
  const canUpload = PERMISSIONS.canUploadDocument.includes(role);
  const canDelete = PERMISSIONS.canDeleteDocument.includes(role);
  const { fields, typeOptions } = useDocumentFormFields();
  const [showUpload, setShowUpload] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'other', notes: '' });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const queryClient = useQueryClient();

  const { data: documents = [] } = useQuery({
    queryKey: ['documents'],
    queryFn: () => base44.entities.Document.list('-created_date'),
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Document.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
    onError: (err) => handleMutationError(err, t, toast),
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Document.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
    onError: (err) => handleMutationError(err, t, toast),
  });

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!canUpload) {
      toast.error(t('accessDenied'));
      return;
    }
    if (!form.name) return;
    setUploading(true);
    let file_url = '';
    if (file) {
      const result = await base44.integrations.Core.UploadFile({ file });
      file_url = result.file_url;
    }
    await createMutation.mutateAsync({
      ...form,
      file_url,
      file_format: file?.name?.split('.').pop() || '',
      file_size: file?.size || 0,
    });
    setUploading(false);
    setShowUpload(false);
    setForm({ name: '', type: 'other', notes: '' });
    setFile(null);
  };

  const filtered = documents.filter(d => {
    const matchesSearch = !search || d.name?.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === 'all' || d.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const getTypeLabel = (type) => DOC_TYPES.find(t => t.value === type)?.label || type;

  return (
    <div>
      <TopBar title={t('documentCenter')} />
      <div className="p-6 space-y-6">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="flex gap-3 flex-1">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder={t('searchDocuments')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder={t('all')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('all')}</SelectItem>
                {DOC_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {canUpload && (
            <Button onClick={() => setShowUpload(true)} className="gap-2">
              <Upload className="w-4 h-4" /> {t('uploadDocument')}
            </Button>
          )}
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={FileText} title={t('noDocuments')} description={t('uploadFirstDocument')} actionLabel={canUpload ? t('uploadDocument') : undefined} onAction={canUpload ? () => setShowUpload(true) : undefined} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(doc => (
              <div key={doc.id} className="bg-card rounded-xl border border-border p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-5 h-5 text-primary flex-shrink-0" />
                    <h3 className="font-medium truncate">{doc.name}</h3>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {doc.file_url && (
                      <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="icon" className="h-7 w-7"><ExternalLink className="w-3.5 h-3.5" /></Button>
                      </a>
                    )}
                    {canDelete && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(doc.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-xs">{getTypeLabel(doc.type)}</Badge>
                  {doc.file_format && <span>.{doc.file_format}</span>}
                  <span>{doc.created_date ? format(new Date(doc.created_date), 'MMM d, yyyy') : ''}</span>
                </div>
                {doc.notes && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{doc.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-heading">{t('uploadDocument')}</DialogTitle></DialogHeader>
          <form onSubmit={handleUpload} className="space-y-4" dir={dir}>
            {fields.filter(f => f.key !== 'type').map(f => (
              <div key={f.key}>
                <Label>{f.label}{f.required ? ' *' : ''}</Label>
                <Input type={f.type} value={form[f.key] || ''} onChange={e => setForm({...form, [f.key]: e.target.value})} required={f.required} />
              </div>
            ))}
            <div>
              <Label>{t('type')}</Label>
              <Select value={form.type} onValueChange={v => setForm({...form, type: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{typeOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>{t('file')}</Label><Input type="file" onChange={e => setFile(e.target.files[0])} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowUpload(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={uploading || !form.name}>{uploading ? t('uploading') : t('upload')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}