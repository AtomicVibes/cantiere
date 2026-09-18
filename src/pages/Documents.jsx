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
import { useAuth } from '@/lib/AuthContext';
import { useDocumentFormFields } from '@/hooks/useFormSchema';
import { useDirection } from '@/i18n/LanguageProvider';
import { PERMISSIONS } from '@/lib/permissions';
import { handleMutationError } from '@/lib/rbac';
import { supabase } from '@/services/supabase';
import DocumentPreview from '@/components/shared/DocumentPreview';
import { getDocumentUserFriendlyError, logDocumentError } from '@/lib/document-errors';

const DOC_CATEGORIES = [
  'blueprint', 'contract', 'permit', 'invoice', 'photo',
  'video', 'audio_note', 'cad_file', 'report', 'other',
];

const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024;
const SUPPORTED_DOCUMENT_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'video/mp4', 'video/webm', 'video/quicktime',
]);

export default function Documents() {
  const { t } = useTranslation();
  const docTypeOptions = useMemo(() => DOC_CATEGORIES.map(c => ({ value: c, label: t(c) })), [t]);
  const { dir } = useDirection();
  const { role } = useUserRole();
  const { user: currentUser } = useAuth();
  const { isSuperAdmin } = useIsSuperAdmin();
  const canUpload = PERMISSIONS.canUploadDocument.includes(role);
  const canDelete = PERMISSIONS.canDeleteDocument.includes(role);
  const { fields, typeOptions } = useDocumentFormFields();
  const [showUpload, setShowUpload] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'other', notes: '', project_id: null, visibility: 'private' });
  const [file, setFile] = useState(null);
  const [selectedAudience, setSelectedAudience] = useState([]);
  const [accessDocument, setAccessDocument] = useState(null);
  const [accessVisibility, setAccessVisibility] = useState('private');
  const [accessAudience, setAccessAudience] = useState([]);
  const [accessSaving, setAccessSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [view, setView] = useState('active');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [mutating, setMutating] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const queryClient = useQueryClient();

  const { data: projects = [] } = useQuery({
    queryKey: ['documentProjects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id, name').order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentUser,
  });

  const { data: audienceMembers = [] } = useQuery({
    queryKey: ['documentAudienceMembers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name, email').order('full_name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentUser,
  });

  const { data: documents = [] } = useQuery({
    queryKey: ['documents', currentUser?.id],
    enabled: !!currentUser,
    queryFn: () => base44.entities.Document.list('-created_date'),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Document.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents', currentUser?.id] }),
    onError: (err) => handleMutationError(err, t, toast),
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Document.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', currentUser?.id] });
      toast.success('Document deleted');
    },
    onError: (err) => {
      if (!handleMutationError(err, t, toast)) {
        toast.error('Failed to delete document. Please try again.');
      }
    },
  });

  const saveAccess = async () => {
    if (!accessDocument) return;
    if (accessVisibility === 'selected' && accessAudience.length === 0) {
      toast.error('Please select at least one audience member.');
      return;
    }
    setAccessSaving(true);
    try {
      const { data, error } = await supabase.rpc('update_document_access', {
        p_document_id: accessDocument.id,
        p_visibility: accessVisibility,
        p_audience_user_ids: accessAudience,
      });
      if (error) {
        logDocumentError('update_document_access failed', error, {
          documentId: accessDocument.id,
          visibility: accessVisibility,
          selectedUserIds: accessAudience,
        });
        toast.error(getDocumentUserFriendlyError(error));
        return;
      }
      console.info('[Documents] update_document_access success', { documentId: data?.id, visibility: data?.visibility });
      setAccessDocument(null);
      queryClient.invalidateQueries({ queryKey: ['documents', currentUser?.id] });
      toast.success('Document access updated.');
    } catch (error) {
      logDocumentError('Failed to update document access', error, { documentId: accessDocument.id });
      toast.error(getDocumentUserFriendlyError(error));
    } finally {
      setAccessSaving(false);
    }
  };

  const removeProject = async (document) => {
    const { error } = await supabase.rpc('remove_document_project', { p_document_id: document.id });
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ['documents', currentUser?.id] });
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!canUpload) {
      toast.error(t('accessDenied'));
      return;
    }
    if (!form.name || !file) {
      toast.error('Please provide a document name and select a file.');
      return;
    }
    if (form.visibility === 'selected' && selectedAudience.length === 0) {
      toast.error('Please select at least one audience member.');
      return;
    }
    setUploading(true);
    try {
      const debugUpload = (message, details = {}) => {
        if (import.meta.env.DEV) console.info(`[Documents] ${message}`, details);
      };

      debugUpload('UPLOAD START');
      let file_url = '';
      let uploadedPath = '';
      if (file) {
        if (!SUPPORTED_DOCUMENT_TYPES.has(file.type)) {
          throw new Error('Unsupported file type. Use JPG, PNG, WebP, GIF, PDF, MP4, WebM, or MOV.');
        }
        if (file.size > MAX_DOCUMENT_SIZE) {
          throw new Error('File is too large. The maximum size is 50 MB.');
        }
        debugUpload('FILE SELECTED', {
          name: file.name,
          type: file.type,
          size: file.size,
        });
        debugUpload('SUPABASE STORAGE UPLOAD START');
        const result = await base44.integrations.Core.UploadFile({ file });
        file_url = result.file_url;
        uploadedPath = file_url;
        debugUpload('SUPABASE STORAGE UPLOAD RESULT', { uploaded: !!file_url });
      }
      debugUpload('DATABASE INSERT START');
      let createdDocument;
      try {
        createdDocument = await createMutation.mutateAsync({
          ...form,
          file_url,
          mime_type: file?.type || 'application/octet-stream',
          file_format: file?.name?.split('.').pop() || '',
          file_size: file?.size || 0,
          project_id: form.project_id || null,
          visibility: form.visibility,
          audience_user_ids: selectedAudience,
        });
      } catch (error) {
        if (uploadedPath) {
          try {
            await base44.integrations.Core.DeleteFile({ filePath: uploadedPath });
          } catch (cleanupError) {
            console.error('[Documents] failed to clean up uploaded file:', cleanupError);
          }
        }
        throw error;
      }
      debugUpload('DATABASE INSERT RESULT', { saved: true, id: createdDocument?.id });
      debugUpload('UPLOAD COMPLETE');
      setShowUpload(false);
      setForm({ name: '', type: 'other', notes: '', project_id: null, visibility: 'private' });
      setSelectedAudience([]);
      setFile(null);
    } catch (error) {
      logDocumentError('Upload failed', error, { fileType: file?.type, fileSize: file?.size });
      toast.error(getDocumentUserFriendlyError(error, 'Unable to upload document. Please try again.'));
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
      queryClient.invalidateQueries({ queryKey: ['documents', currentUser?.id] });
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
      queryClient.invalidateQueries({ queryKey: ['documents', currentUser?.id] });
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
      await Promise.all(ids.map(async (id) => {
        const document = documents.find(item => item.id === id);
        await base44.entities.Document.delete(id);
        if (document?.storage_path) {
          await base44.integrations.Core.DeleteFile({ filePath: document.storage_path });
        }
      }));
      toast.success(`Deleted ${ids.length} document${ids.length !== 1 ? 's' : ''}`);
      setSelectedIds(new Set());
      setConfirmDeleteOpen(false);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['documents', currentUser?.id] });
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
                    <DocumentPreview document={doc} compact />
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
                  {doc.visibility && <span className="capitalize">{doc.visibility}</span>}
                  <span>{doc.created_at ? format(new Date(doc.created_at), 'MMM d, yyyy') : ''}</span>
                </div>
                {doc.project_id && <p className="text-xs text-primary mt-1">{projects.find(project => project.id === doc.project_id)?.name || 'Project assigned'}</p>}
                {doc.user_id === currentUser?.id && (
                  <div className="flex gap-2 mt-2">
                    <Button type="button" size="sm" variant="outline" onClick={async () => {
                      const { data: audience, error } = await supabase.from('document_audience').select('user_id').eq('document_id', doc.id);
                      if (error) {
                        logDocumentError('Loading document audience failed', error, { documentId: doc.id });
                        toast.error(getDocumentUserFriendlyError(error, 'Unable to load document access. Please try again.'));
                        return;
                      }
                      setAccessDocument(doc);
                      setAccessVisibility(doc.visibility || 'private');
                      setAccessAudience((audience || []).map(item => item.user_id));
                    }}>Edit access</Button>
                    {doc.project_id && <Button type="button" size="sm" variant="ghost" onClick={() => removeProject(doc)}>Remove project</Button>}
                  </div>
                )}
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
            <div><Label>{t('file')}</Label><Input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,video/mp4,video/webm,video/quicktime" onChange={e => setFile(e.target.files[0])} /></div>
            <div>
              <Label>Project</Label>
              <Select value={form.project_id || 'none'} onValueChange={value => setForm({...form, project_id: value === 'none' ? null : value})}>
                <SelectTrigger><SelectValue placeholder="No project" /></SelectTrigger>
                <SelectContent><SelectItem value="none">No project</SelectItem>{projects.map(project => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Visibility</Label>
              <Select value={form.visibility} onValueChange={value => { setForm({...form, visibility: value}); if (value !== 'selected') setSelectedAudience([]); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="private">Private</SelectItem><SelectItem value="public">Public</SelectItem><SelectItem value="selected">Selected audience</SelectItem></SelectContent>
              </Select>
            </div>
            {form.visibility === 'selected' && (
              <div className="space-y-2 border rounded-md p-3">
                <Label>Select audience</Label>
                {audienceMembers.map(member => (
                  <label key={member.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={selectedAudience.includes(member.id)} onChange={() => setSelectedAudience(previous => previous.includes(member.id) ? previous.filter(id => id !== member.id) : [...previous, member.id])} />
                    {member.full_name || member.email}
                  </label>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowUpload(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={uploading || !form.name}>{uploading ? t('uploading') : t('upload')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!accessDocument} onOpenChange={open => !open && setAccessDocument(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit document access</DialogTitle></DialogHeader>
          <Select value={accessVisibility} onValueChange={setAccessVisibility}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="private">Private</SelectItem><SelectItem value="public">Public</SelectItem><SelectItem value="selected">Selected audience</SelectItem></SelectContent>
          </Select>
          {accessVisibility === 'selected' && <div className="space-y-2 border rounded-md p-3">{audienceMembers.map(member => <label key={member.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={accessAudience.includes(member.id)} onChange={() => setAccessAudience(previous => previous.includes(member.id) ? previous.filter(id => id !== member.id) : [...previous, member.id])} />{member.full_name || member.email}</label>)}</div>}
          <DialogFooter><Button variant="outline" disabled={accessSaving} onClick={() => setAccessDocument(null)}>Cancel</Button><Button disabled={accessSaving} onClick={saveAccess}>{accessSaving ? 'Saving...' : 'Save access'}</Button></DialogFooter>
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