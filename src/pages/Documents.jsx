import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import TopBar from '@/components/layout/TopBar';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Search, FileText, Upload, ExternalLink, Archive, RotateCcw, Trash2, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { useUserRole } from '@/hooks/useUserRole';
import { useIsSuperAdmin } from '@/hooks/useIsSuperAdmin';
import { useDocumentFormFields } from '@/hooks/useFormSchema';
import { useDirection } from '@/i18n/LanguageProvider';
import { PERMISSIONS } from '@/lib/permissions';
import { handleMutationError } from '@/lib/rbac';

const DOC_CATEGORIES = [
  'blueprint', 'contract', 'permit', 'invoice', 'photo',
  'video', 'audio_note', 'cad_file', 'report', 'other',
];

export default function Documents() {
  const { t } = useTranslation();
  const docTypeOptions = useMemo(() => DOC_CATEGORIES.map(c => ({ value: c, label: t(c) })), [t]);
  const { dir } = useDirection();
  const { role } = useUserRole();
  const { isSuperAdmin } = useIsSuperAdmin();
  const canUpload = PERMISSIONS.canUploadDocument.includes(role);
  const canDelete = PERMISSIONS.canDeleteDocument.includes(role);
  const { fields, typeOptions } = useDocumentFormFields();
  const [showUpload, setShowUpload] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'other', notes: '' });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [view, setView] = useState('active');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [mutating, setMutating] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Document deleted');
    },
    onError: (err) => {
      if (!handleMutationError(err, t, toast)) {
        toast.error('Failed to delete document. Please try again.');
      }
    },
  });

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!canUpload) {
      toast.error(t('accessDenied'));
      return;
    }
    if (!form.name) return;
    setUploading(true);
    try {
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
      setShowUpload(false);
      setForm({ name: '', type: 'other', notes: '' });
      setFile(null);
    } catch {
    } finally {
      setUploading(false);
    }
  };

  const currentDocs = useMemo(() => {
    return documents.filter(d => view === 'archived' ? d.archived : !d.archived);
  }, [documents, view]);

  const filtered = currentDocs.filter(d => {
    const matchesSearch = !search || d.name?.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === 'all' || d.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const allVisibleSelected = filtered.length > 0 && filtered.every(d => selectedIds.has(d.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(d => d.id)));
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

  const executeArchive = async (ids) => {
    setMutating(true);
    try {
      const idsArr = Array.isArray(ids) ? ids : [ids];
      await Promise.all(idsArr.map(id => base44.entities.Document.update(id, { archived: true })));
      toast.success(`Archived ${idsArr.length} document${idsArr.length !== 1 ? 's' : ''}`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    } catch (err) {
      toast.error(err.message || 'Failed to archive');
    } finally {
      setMutating(false);
    }
  };

  const executeRestore = async (ids) => {
    setMutating(true);
    try {
      const idsArr = Array.isArray(ids) ? ids : [ids];
      await Promise.all(idsArr.map(id => base44.entities.Document.update(id, { archived: false })));
      toast.success(`Restored ${idsArr.length} document${idsArr.length !== 1 ? 's' : ''}`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    } catch (err) {
      toast.error(err.message || 'Failed to restore');
    } finally {
      setMutating(false);
    }
  };

  const handleBulkDeleteConfirm = (mode, id) => {
    setDeleteTarget({ mode, id });
    setConfirmDeleteOpen(true);
  };

  const executeBulkDelete = async () => {
    setMutating(true);
    try {
      let ids = [];
      if (deleteTarget.mode === 'selected') ids = [...selectedIds];
      else if (deleteTarget.mode === 'single') ids = [deleteTarget.id];
      await Promise.all(ids.map(id => base44.entities.Document.delete(id)));
      toast.success(`Deleted ${ids.length} document${ids.length !== 1 ? 's' : ''}`);
      setSelectedIds(new Set());
      setConfirmDeleteOpen(false);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    } catch (err) {
      toast.error(err.message || 'Failed to delete');
    } finally {
      setMutating(false);
    }
  };

  const getTypeLabel = (type) => docTypeOptions.find(t => t.value === type)?.label || type;

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
                {docTypeOptions.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {canUpload && (
            <Button onClick={() => setShowUpload(true)} className="gap-2">
              <Upload className="w-4 h-4" /> {t('uploadDocument')}
            </Button>
          )}
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
                  <Button variant="outline" size="sm" className="gap-2" disabled={mutating || selectedIds.size === 0} onClick={() => executeArchive([...selectedIds])}>
                    <Archive className="w-3.5 h-3.5" /> Archive Selected
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" disabled={mutating} onClick={() => executeArchive(filtered.map(d => d.id))}>
                    <Archive className="w-3.5 h-3.5" /> Archive All
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" className="gap-2" disabled={mutating || selectedIds.size === 0} onClick={() => executeRestore([...selectedIds])}>
                    <RotateCcw className="w-3.5 h-3.5" /> Restore Selected
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" disabled={mutating} onClick={() => executeRestore(filtered.map(d => d.id))}>
                    <RotateCcw className="w-3.5 h-3.5" /> Restore All
                  </Button>
                </>
              )}
              <Button variant="destructive" size="sm" className="gap-2" disabled={mutating || selectedIds.size === 0} onClick={() => handleBulkDeleteConfirm('selected')}>
                <Trash2 className="w-3.5 h-3.5" /> Delete Selected
              </Button>
              {mutating && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState icon={FileText} title={t('noDocuments')} description={view === 'archived' ? 'No archived documents' : t('uploadFirstDocument')} actionLabel={canUpload && view === 'active' ? t('uploadDocument') : undefined} onAction={canUpload && view === 'active' ? () => setShowUpload(true) : undefined} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(doc => (
              <div key={doc.id} className="bg-card rounded-xl border border-border p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {isSuperAdmin && (
                      <Checkbox checked={selectedIds.has(doc.id)} onCheckedChange={() => toggleSelect(doc.id)} className="mr-1" />
                    )}
                    <FileText className="w-5 h-5 text-primary flex-shrink-0" />
                    <h3 className="font-medium truncate">{doc.name}</h3>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {doc.file_url && (
                      <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="icon" className="h-7 w-7"><ExternalLink className="w-3.5 h-3.5" /></Button>
                      </a>
                    )}
                    {isSuperAdmin && (
                      view === 'active' ? (
                        <button onClick={() => executeArchive(doc.id)} disabled={mutating} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40" title="Archive">
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button onClick={() => executeRestore(doc.id)} disabled={mutating} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40" title="Restore">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )
                    )}
                    {canDelete && (
                      <button onClick={() => handleBulkDeleteConfirm('single', doc.id)} disabled={mutating} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
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