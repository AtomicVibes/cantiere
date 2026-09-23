import React, { useState, useMemo, useRef } from 'react';
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
import { Search, FileText, Upload, ExternalLink, Archive, RotateCcw, Trash2, Loader2, Download } from 'lucide-react';
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
import { parseGoogleDocLink, getGoogleDocMime } from '@/lib/googleLinks';
import { uploadDocumentFile } from '@/services/documentUploadService';

const DOC_CATEGORIES = [
  'blueprint', 'contract', 'permit', 'invoice', 'photo',
  'video', 'audio_note', 'cad_file', 'report', 'word', 'excel', 'google', 'other',
];

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
  const [addMode, setAddMode] = useState('file');
  const [externalUrl, setExternalUrl] = useState('');
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
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const fileInputRef = useRef(null);
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

  // Files live in the private `documents` bucket: a signed URL is only issued when the
  // storage policies authorise the object for the current user, and those policies
  // resolve access through the document row (owner, public, selected audience or an
  // authorised role). Only the signed URL ever reaches the browser.
  const handleDownload = async (doc) => {
    if (!doc?.storage_path) {
      toast.error('This document has no stored file to download.');
      return;
    }
    const fileName = doc.file_name || doc.name || 'document';
    setDownloadingId(doc.id);
    try {
      const { data, error } = await supabase.storage
        .from('documents')
        .createSignedUrl(doc.storage_path, 300, { download: fileName });
      if (error || !data?.signedUrl) {
        logDocumentError('Signed URL for download failed', error, { documentId: doc.id, visibility: doc.visibility });
        toast.error(getDocumentUserFriendlyError(
          error,
          'Unable to download this document. Please try again.',
          "You don't have permission to download this document."
        ));
        return;
      }
      const link = document.createElement('a');
      link.href = data.signedUrl;
      link.download = fileName;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Fire-and-forget so a slow audit write never blocks the download.
      await supabase.rpc('write_audit_log', {
        p_action_type: 'DOCUMENT_DOWNLOAD',
        p_message: 'Document downloaded',
        p_document_name: doc.file_name,
        p_entity_type: 'document',
        p_entity_id: doc.id,
        p_project_id: doc.project_id || null,
        p_details: { file_name: doc.file_name, mime_type: doc.mime_type, visibility: doc.visibility, project_id: doc.project_id },
      });
    } catch (error) {
      logDocumentError('Download failed', error, { documentId: doc.id });
      toast.error(getDocumentUserFriendlyError(
        error,
        'Unable to download this document. Please try again.',
        "You don't have permission to download this document."
      ));
    } finally {
      setDownloadingId(null);
    }
  };

  const openUploadDialog = () => {
    setShowUpload(true);
    setAddMode('file');
    setExternalUrl('');
    setForm({ name: '', type: 'other', notes: '', project_id: null, visibility: 'private' });
    setSelectedAudience([]);
    setFile(null);
  };

  const closeUploadDialog = () => {
    setShowUpload(false);
    setAddMode('file');
    setExternalUrl('');
    setForm({ name: '', type: 'other', notes: '', project_id: null, visibility: 'private' });
    setSelectedAudience([]);
    setFile(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canUpload) {
      toast.error(t('accessDenied'));
      return;
    }
    if (!form.name) {
      toast.error('Please provide a document name.');
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

      if (addMode === 'link') {
        const parsed = parseGoogleDocLink(externalUrl);
        if (!parsed) {
          toast.error(t('invalidGoogleLink'));
          return;
        }
        debugUpload('LINK START', { url: externalUrl.trim() });
        await createMutation.mutateAsync({
          ...form,
          external_url: externalUrl.trim(),
          external_provider: 'google',
          mime_type: getGoogleDocMime(parsed.subtype),
          file_size: 0,
          project_id: form.project_id || null,
          visibility: form.visibility,
          audience_user_ids: selectedAudience,
        });
        debugUpload('LINK COMPLETE');
        closeUploadDialog();
        toast.success('Google document linked.');
        return;
      }

      if (!file) {
        toast.error('Please select a file.');
        return;
      }

      debugUpload('UPLOAD START');
      debugUpload('FILE SELECTED', {
        name: file.name,
        type: file.type,
        size: file.size,
      });
      debugUpload('SUPABASE STORAGE UPLOAD START');
      const createdDocument = await uploadDocumentFile({
        file,
        name: form.name,
        project_id: form.project_id || null,
        visibility: form.visibility,
        notes: form.notes,
        type: form.type,
        audience_user_ids: selectedAudience,
      });
      debugUpload('SUPABASE STORAGE UPLOAD RESULT', { uploaded: !!createdDocument?.storage_path });
      debugUpload('DATABASE INSERT RESULT', { saved: true, id: createdDocument?.id });
      debugUpload('UPLOAD COMPLETE');
      closeUploadDialog();
    } catch (error) {
      logDocumentError('Upload failed', error, { fileType: file?.type, fileSize: file?.size });
      toast.error(getDocumentUserFriendlyError(
        error,
        addMode === 'link' ? 'Unable to link the document. Please try again.' : 'Unable to upload document. Please try again.',
        "You don't have permission to upload this document."
      ));
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

  // Archive/restore is a metadata update. A zero-row result means either RLS refused
  // the update (the policy is owner-only) or the row is gone, so both outcomes are
  // classified here instead of leaking the raw PostgREST error to the user.
  const setDocumentsArchived = async (ids, archived) => {
    const idsArr = Array.isArray(ids) ? ids : [ids];
    if (idsArr.length === 0) return;

    const action = archived ? 'archive' : 'restore';
    const doneLabel = archived ? 'Archived' : 'Restored';
    const permissionMessage = `You don't have permission to ${action} this document.`;

    setMutating(true);
    try {
      const results = await Promise.all(idsArr.map(async (id) => {
        try {
          await base44.entities.Document.update(id, { archived });
          return { id, ok: true };
        } catch (error) {
          logDocumentError(`${action} failed`, error, { documentId: id, archived });
          if (error?.code !== 'UPDATE_NOT_APPLIED') return { id, ok: false, error };

          // The row is still listed for this user, so it exists; a zero-row update
          // therefore means the update policy refused it. A missing row is reported
          // as such instead of as a permission problem.
          const { data: existing, error: lookupError } = await supabase
            .from('documents')
            .select('id')
            .eq('id', id)
            .maybeSingle();
          if (lookupError && lookupError.code !== 'PGRST116') {
            logDocumentError(`${action} verification failed`, lookupError, { documentId: id });
          }
          return { id, ok: false, error, missing: !existing };
        }
      }));

      const updatedIds = results.filter(result => result.ok).map(result => result.id);
      const missing = results.filter(result => !result.ok && result.missing);
      const denied = results.filter(result => !result.ok && !result.missing);

      if (updatedIds.length > 0) {
        queryClient.setQueryData(['documents', currentUser?.id], (previous) =>
          (previous || []).map(item => (updatedIds.includes(item.id) ? { ...item, archived } : item)));
        setSelectedIds(previous => {
          const remaining = new Set(previous);
          updatedIds.forEach(id => remaining.delete(id));
          return remaining;
        });
      }
      if (updatedIds.length > 0 || missing.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['documents', currentUser?.id] });
      }

      if (updatedIds.length === idsArr.length) {
        toast.success(`${doneLabel} ${updatedIds.length} document${updatedIds.length !== 1 ? 's' : ''}`);
      } else if (updatedIds.length > 0) {
        const details = [];
        if (denied.length > 0) details.push(`${denied.length} could not be updated`);
        if (missing.length > 0) details.push(`${missing.length} no longer exists`);
        toast.warning(`${doneLabel} ${updatedIds.length} of ${idsArr.length} documents. ${details.join(' and ')}.`);
      } else if (denied.length > 0) {
        toast.error(getDocumentUserFriendlyError(denied[0].error, permissionMessage, permissionMessage));
      } else {
        toast.warning('This document is no longer available. The list has been refreshed.');
      }
    } catch (error) {
      logDocumentError(`${action} failed`, error);
      toast.error(getDocumentUserFriendlyError(error, `Unable to ${action} this document. Please try again.`, permissionMessage));
    } finally {
      setMutating(false);
    }
  };

  const executeArchive = (ids) => setDocumentsArchived(ids, true);

  const executeRestore = (ids) => setDocumentsArchived(ids, false);

  const handleBulkDeleteConfirm = (mode, id) => {
    setDeleteTarget({ mode, id });
    setConfirmDeleteOpen(true);
  };

  const executeBulkDelete = async () => {
    const ids = deleteTarget?.mode === 'selected'
      ? [...selectedIds]
      : deleteTarget?.mode === 'single' && deleteTarget.id
        ? [deleteTarget.id]
        : [];

    if (ids.length === 0) {
      setConfirmDeleteOpen(false);
      setDeleteTarget(null);
      return;
    }

    setMutating(true);
    try {
      // The database row is the source of truth: only a DELETE that actually returned
      // the row counts as deleted. The stored object is removed first, while the
      // metadata row still exists, so a storage removal that the policies refuse
      // aborts the deletion instead of leaving a metadata row whose attached file
      // is still present. A missing object (STORAGE_DELETE_NOT_APPLIED) is not an
      // error - it lets orphaned metadata rows be cleaned up truthfully below.
      const results = await Promise.all(ids.map(async (id) => {
        const document = documents.find(item => item.id === id);

        if (document?.storage_path) {
          try {
            await base44.integrations.Core.DeleteFile({ filePath: document.storage_path });
          } catch (storageError) {
            if (storageError?.code === 'STORAGE_DELETE_NOT_APPLIED') {
              // Storage returned nothing: the object is already absent, nothing to remove.
              logDocumentError('Storage object already absent', storageError, { documentId: id, storagePath: document.storage_path });
            } else {
              logDocumentError('Storage deletion failed', storageError, { documentId: id, storagePath: document.storage_path });
              return { id, dbDeleted: false, error: storageError, storageBlocked: true };
            }
          }
        }

        try {
          await base44.entities.Document.delete(id);
        } catch (error) {
          logDocumentError('Database delete failed', error, { documentId: id });
          return { id, dbDeleted: false, error, storageBlocked: false };
        }

        return { id, dbDeleted: true, error: null, storageBlocked: false };
      }));

      const deletedIds = results.filter(result => result.dbDeleted).map(result => result.id);
      const deleteFailures = results.filter(result => !result.dbDeleted);
      const storageBlocked = results.filter(result => result.storageBlocked);

      if (deletedIds.length > 0) {
        // Remove the deleted documents from the current UI state immediately,
        // then refetch once so the list stays in sync with the database.
        queryClient.setQueryData(['documents', currentUser?.id], (previous) =>
          (previous || []).filter(item => !deletedIds.includes(item.id)));
        queryClient.invalidateQueries({ queryKey: ['documents', currentUser?.id] });
        setSelectedIds(previous => {
          const remaining = new Set(previous);
          deletedIds.forEach(id => remaining.delete(id));
          return remaining;
        });
      }

      setConfirmDeleteOpen(false);
      setDeleteTarget(null);

      if (deleteFailures.length === 0) {
        toast.success(`Deleted ${deletedIds.length} document${deletedIds.length !== 1 ? 's' : ''}`);
      } else if (deletedIds.length > 0) {
        const details = [`${deleteFailures.length} could not be deleted`];
        if (storageBlocked.length > 0) details.push(`${storageBlocked.length} file${storageBlocked.length !== 1 ? 's' : ''} could not be removed from storage`);
        toast.warning(`Deleted ${deletedIds.length} of ${ids.length} document${ids.length !== 1 ? 's' : ''}. ${details.join(' and ')}.`);
      } else if (storageBlocked.length === ids.length) {
        toast.error('The stored file could not be removed from storage, so the document was not deleted. Please try again.');
      } else {
        const firstError = deleteFailures[0]?.error;
        toast.error(firstError?.code === 'DELETE_NOT_APPLIED'
          ? 'The document was not deleted. It may have already been removed, or you may not have permission to delete it.'
          : (firstError?.message || 'Failed to delete the document. Please try again.'));
      }
    } catch (err) {
      logDocumentError('Delete failed', err);
      toast.error(err.message || 'Failed to delete the document. Please try again.');
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
            <Button onClick={openUploadDialog} className="gap-2">
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
          <EmptyState icon={FileText} title={t('noDocuments')} description={view === 'archived' ? 'No archived documents' : t('uploadFirstDocument')} actionLabel={canUpload && view === 'active' ? t('uploadDocument') : undefined} onAction={canUpload && view === 'active' ? openUploadDialog : undefined} />
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
                    {doc.storage_path && (
                      <button onClick={() => handleDownload(doc)} disabled={downloadingId === doc.id} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40" title="Download">
                        {downloadingId === doc.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    {doc.file_url && (
                      <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Open document">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Button>
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
                  {doc.external_provider === 'google' && (
                    <span className="inline-flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" /> {t('google')}
                    </span>
                  )}
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

      <Dialog open={showUpload} onOpenChange={open => { if (!open) closeUploadDialog(); }}>
        <DialogContent className="max-h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle className="font-heading">{t('addDocument')}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="flex-1 min-h-0 space-y-4 overflow-y-auto pr-1" dir={dir}>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setAddMode('file'); setFile(null); }}
                className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${addMode === 'file' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-muted-foreground hover:border-primary/60 hover:bg-muted/50'}`}
              >
                <Upload className="w-4 h-4" /> {t('uploadFile')}
              </button>
              <button
                type="button"
                onClick={() => { setAddMode('link'); setExternalUrl(''); }}
                className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${addMode === 'link' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-muted-foreground hover:border-primary/60 hover:bg-muted/50'}`}
              >
                <ExternalLink className="w-4 h-4" /> {t('linkGoogleDocument')}
              </button>
            </div>
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
            {addMode === 'link' ? (
              <div className="space-y-2">
                <Label>{t('googleDocumentLink')} *</Label>
                <Input
                  type="url"
                  value={externalUrl}
                  onChange={e => setExternalUrl(e.target.value)}
                  placeholder="https://docs.google.com/document/d/..."
                  required
                />
                <p className="text-xs text-muted-foreground">{t('googleLinkNote')}</p>
              </div>
            ) : (
              <div>
                <Label>{t('file')}</Label>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDraggingFile(true); }}
                  onDragEnter={(e) => { e.preventDefault(); setIsDraggingFile(true); }}
                  onDragLeave={() => setIsDraggingFile(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(false);
                    const droppedFile = e.dataTransfer?.files?.[0];
                    if (droppedFile) setFile(droppedFile);
                  }}
                  className={`flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-3 py-4 text-center transition-colors ${isDraggingFile ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60 hover:bg-muted/50'}`}
                >
                  <Upload className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Drag &amp; drop a file here, or click to browse</span>
                  <span className="text-[11px] text-muted-foreground">JPG, PNG, WebP, GIF, PDF, MP4, WebM, MOV, DOC, DOCX, XLS, XLSX - up to 50 MB</span>
                  {file ? <span className="max-w-full truncate text-xs font-medium">{file.name}</span> : null}
                </button>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,video/mp4,video/webm,video/quicktime,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={e => setFile(e.target.files?.[0] || null)}
                />
              </div>
            )}
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
                <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                  {audienceMembers.map(member => (
                    <label key={member.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={selectedAudience.includes(member.id)} onChange={() => setSelectedAudience(previous => previous.includes(member.id) ? previous.filter(id => id !== member.id) : [...previous, member.id])} />
                      {member.full_name || member.email}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <DialogFooter className="sticky bottom-0 bg-background pt-2">
              <Button type="button" variant="outline" onClick={closeUploadDialog}>{t('cancel')}</Button>
              <Button type="submit" disabled={uploading || !form.name}>{uploading ? t('uploading') : addMode === 'link' ? t('save') : t('upload')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!accessDocument} onOpenChange={open => !open && setAccessDocument(null)}>
        <DialogContent className="max-h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle>Edit document access</DialogTitle></DialogHeader>
          <div className="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
            <Select value={accessVisibility} onValueChange={setAccessVisibility}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="private">Private</SelectItem><SelectItem value="public">Public</SelectItem><SelectItem value="selected">Selected audience</SelectItem></SelectContent>
            </Select>
            {accessVisibility === 'selected' && (
              <div className="space-y-2 border rounded-md p-3">
                <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                  {audienceMembers.map(member => <label key={member.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={accessAudience.includes(member.id)} onChange={() => setAccessAudience(previous => previous.includes(member.id) ? previous.filter(id => id !== member.id) : [...previous, member.id])} />{member.full_name || member.email}</label>)}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="sticky bottom-0 bg-background pt-2"><Button variant="outline" disabled={accessSaving} onClick={() => setAccessDocument(null)}>Cancel</Button><Button disabled={accessSaving} onClick={saveAccess}>{accessSaving ? 'Saving...' : 'Save access'}</Button></DialogFooter>
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