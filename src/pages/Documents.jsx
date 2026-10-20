import React, { useState, useMemo, useCallback } from 'react';
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
import { Search, FileText, Upload, ExternalLink, Archive, RotateCcw, Trash2, Loader2, Download, ShieldCheck, Send } from 'lucide-react';
import VisibilitySelect, { VisibilityBadge } from '@/components/documents/VisibilitySelect';
import AudiencePicker from '@/components/documents/AudiencePicker';
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
import { DocumentDropZone } from '@/components/shared/DocumentDropZone';
import { getDocumentUserFriendlyError, getDocumentFileValidationError, logDocumentError } from '@/lib/document-errors';
import { refreshDocumentList } from '@/lib/documentListRefresh';
import { logAction } from '@/lib/activityTracking';
import { parseGoogleDocLink, getGoogleDocMime } from '@/lib/googleLinks';
import { uploadDocumentsBatch, validateDocumentFile, DOCUMENT_FILE_ACCEPT } from '@/services/documentUploadService';

const DOC_CATEGORIES = [
  'blueprint', 'contract', 'permit', 'invoice', 'photo',
  'video', 'audio_note', 'cad_file', 'report', 'word', 'excel', 'google', 'other',
];

const FILE_VALIDATION_ERROR_CODES = new Set([
  'ZIP_UNSUPPORTED', 'ZIP_TOO_LARGE', 'UNSUPPORTED_FILE_TYPE', 'FILE_TOO_LARGE', 'FILE_REQUIRED',
]);

export default function Documents() {
  const { t } = useTranslation();
  const docTypeOptions = useMemo(() => DOC_CATEGORIES.map(c => ({ value: c, label: t(c) })), [t]);
  const { dir } = useDirection();
  const { role } = useUserRole();
  const { user: currentUser } = useAuth();
  const { isSuperAdmin } = useIsSuperAdmin();
  const canUpload = PERMISSIONS.canUploadDocument.includes(role);
  const canSubmitToTimeline = PERMISSIONS.canAddTimelineEntry.includes(role);
  const [submittingId, setSubmittingId] = useState(null);

  // Submit a project-linked document to its project timeline (reference
  // only — the physical document is never duplicated). The timeline's
  // unique document constraint makes this naturally idempotent.
  const submitToTimeline = async (doc) => {
    if (!doc?.project_id || submittingId) return;
    setSubmittingId(doc.id);
    try {
      const { error } = await supabase.from('project_timeline').insert({
        project_id: doc.project_id,
        title: doc.name || doc.file_name || 'Document',
        description: null,
        date: new Date().toISOString().slice(0, 10),
        document_id: doc.id,
        submitted_by: currentUser?.id || null,
      });
      if (error) throw error;
      try {
        await supabase.rpc('write_audit_log', {
          p_action_type: 'TIMELINE_CREATE',
          p_message: 'Document submitted to project timeline',
          p_entity_type: 'project_timeline',
          p_entity_id: null,
          p_project_id: doc.project_id,
          p_details: { document_id: doc.id, title: doc.name || doc.file_name },
        });
      } catch (auditError) {
        logDocumentError('Timeline submission audit failed', auditError, { documentId: doc.id });
      }
      toast.success(t('timelineSubmitSuccess') || 'Submitted to project timeline.');
      queryClient.invalidateQueries({ queryKey: ['timeline', doc.project_id] });
      // Notify the project manager (isolated: never blocks the submission).
      try {
        const { data: proj } = await supabase.from('projects').select('id, manager_id').eq('id', doc.project_id).maybeSingle();
        if (proj?.manager_id && proj.manager_id !== currentUser?.id) {
          await supabase.from('notifications').insert({
            user_id: proj.manager_id,
            type: 'project_update',
            message: `New document submitted to project timeline.`,
            url: `/projects/${doc.project_id}`,
            is_read: false,
          });
        }
      } catch (notifyError) {
        logDocumentError('Timeline submission notification failed', notifyError, { documentId: doc.id });
      }
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      const code = String(err?.code || '');
      if (code === '23505' || msg.includes('duplicate') || msg.includes('unique')) {
        toast.info(t('timelineAlreadySubmitted') || 'This document is already on the project timeline.');
      } else {
        logDocumentError('Submit to timeline failed', err, { documentId: doc.id });
        toast.error(getDocumentUserFriendlyError(err, t('timelineSubmitError') || 'We couldn\'t add this item to the project timeline. Please try again.', t('errors.permissionDenied'), t));
      }
    } finally {
      setSubmittingId(null);
    }
  };
  const canDelete = PERMISSIONS.canDeleteDocument.includes(role);
  const { fields, typeOptions } = useDocumentFormFields();
  const [showUpload, setShowUpload] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'other', notes: '', project_id: null, visibility: 'private' });
  const [file, setFile] = useState(null);
  const [files, setFiles] = useState([]);
  const [fileErrors, setFileErrors] = useState([]);
  const [batchResults, setBatchResults] = useState(null);
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
  const [fileError, setFileError] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  // Validation runs on selection so the drop zone can show the state right
  // away; the submit path still validates through uploadDocumentFile.
  const pickFile = useCallback((nextFile) => {
    setFile(nextFile);
    if (!nextFile) {
      setFileError(null);
      return;
    }
    try {
      validateDocumentFile(nextFile);
      setFileError(null);
    } catch (err) {
      setFileError(err.message);
    }
  }, []);

  // Multi-file selection: every file is validated up front and rejected files
  // stay visible with their reason instead of being silently discarded.
  const pickFiles = useCallback((nextFiles) => {
    const filesArray = Array.isArray(nextFiles) ? nextFiles : [];
    setFiles(filesArray);
    const errors = [];
    filesArray.forEach((f, idx) => {
      try {
        validateDocumentFile(f);
      } catch (err) {
        errors.push({ index: idx, name: f.name, message: err.message });
      }
    });
    setFileErrors(errors);
    setFile(null);
    setFileError(null);
    setBatchResults(null);
  }, []);

  const removeFileFromSelection = useCallback((idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
    setFileErrors(prev => prev.filter(e => e.index !== idx).map((e, newIdx) => ({ ...e, index: newIdx })));
    setBatchResults(null);
  }, []);
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
      toast.error(t('selectAudienceRequired'));
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
        toast.error(getDocumentUserFriendlyError(error, t('documentAccessUpdateError', 'Unable to update document access. Please try again.'), t('documentAccessPermissionError', "You don't have permission to change access for this document."), t));
        return;
      }
      console.info('[Documents] update_document_access success', { documentId: data?.id, visibility: data?.visibility });
      logAction('DOCUMENT_UPDATED', {
        entityType: 'documents',
        entityId: accessDocument.id,
        metadata: { file_name: accessDocument.file_name || accessDocument.name || null, visibility: accessVisibility },
      });
      setAccessDocument(null);
      queryClient.invalidateQueries({ queryKey: ['documents', currentUser?.id] });
      toast.success(t('documentAccessUpdated'));
    } catch (error) {
      logDocumentError('Failed to update document access', error, { documentId: accessDocument.id });
      toast.error(getDocumentUserFriendlyError(error, t('documentAccessUpdateError', 'Unable to update document access. Please try again.'), t('documentAccessPermissionError', "You don't have permission to change access for this document."), t));
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
      toast.error(t('documentNoFile'));
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
          t('documentDownloadError'),
          t('documentDownloadPermissionError'),
          t
        ));
        return;
      }
      const link = document.createElement('a');
      link.href = data.signedUrl;
      link.download = fileName;
      link.rel = 'noopener';
      logAction('document_view', { entityType: 'document', entityId: doc.id });
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
        t('documentDownloadError'),
        t('documentDownloadPermissionError'),
        t
      ));
    } finally {
      setDownloadingId(null);
    }
  };

  const resetUploadState = () => {
    setForm({ name: '', type: 'other', notes: '', project_id: null, visibility: 'private' });
    setSelectedAudience([]);
    setFile(null);
    setFiles([]);
    setFileErrors([]);
    setFileError(null);
    setBatchResults(null);
  };

  const openUploadDialog = () => {
    setShowUpload(true);
    setAddMode('file');
    setExternalUrl('');
    resetUploadState();
  };

  const closeUploadDialog = () => {
    setShowUpload(false);
    setAddMode('file');
    setExternalUrl('');
    resetUploadState();
  };

  const resultErrorMessage = (entry) => {
    if (entry?.error && FILE_VALIDATION_ERROR_CODES.has(entry.error.code)) {
      return getDocumentFileValidationError(entry.error, t);
    }
    return getDocumentUserFriendlyError(entry?.error, t('uploadFailed'), t('documentUploadPermissionError'), t);
  };

  // Retry only the files that actually failed to upload. Each retry goes
  // through uploadDocumentFile again, which mints a fresh UUID storage path,
  // so a retried file can never duplicate an already-succeeded record.
  const retryFailedFiles = async () => {
    if (!batchResults || uploading) return;
    const failedEntries = batchResults.results.filter(entry => entry.status === 'failed');
    if (failedEntries.length === 0) return;
    const failedIndices = failedEntries.map(entry => entry.index);
    setUploading(true);
    try {
      setBatchResults(prev => prev && {
        ...prev,
        results: prev.results.map(entry => (
          entry.status === 'failed'
            ? { ...entry, status: 'pending', error: null }
            : entry
        )),
      });
      const { results: retryResults } = await uploadDocumentsBatch({
        files: failedIndices.map(index => batchResults.results[index].file),
        name: form.name,
        project_id: form.project_id || null,
        visibility: form.visibility,
        notes: form.notes,
        type: form.type,
        audience_user_ids: selectedAudience,
        onFileStatus: (index, status, error) => {
          const originalIndex = failedIndices[index];
          setBatchResults(prev => prev && {
            ...prev,
            results: prev.results.map(entry => (
              entry.index === originalIndex ? { ...entry, status, error } : entry
            )),
          });
        },
      });
      setBatchResults(prev => {
        if (!prev) return prev;
        const retryByIndex = new Map(retryResults.map((result, i) => [failedIndices[i], result]));
        const merged = prev.results.map(entry => {
          if (!retryByIndex.has(entry.index)) return entry;
          const retried = retryByIndex.get(entry.index);
          return { ...entry, status: retried.status, document: retried.document, error: retried.error };
        });
        const successCount = merged.filter(entry => entry.status === 'succeeded').length;
        return { results: merged, successCount, failedCount: merged.length - successCount };
      });
      await refreshDocumentList({ queryClient, userId: currentUser?.id, t, toast });
      const retriedSuccess = retryResults.filter(result => result.status === 'succeeded').length;
      const retriedFailed = retryResults.length - retriedSuccess;
      if (retriedFailed === 0) {
        toast.success(t('batchAllSuccess', { count: retriedSuccess }));
      } else if (retriedSuccess > 0) {
        toast.warning(t('batchPartialSuccess', { success: retriedSuccess, total: retryResults.length }));
      } else {
        toast.error(t('uploadFailed'));
      }
    } catch (error) {
      logDocumentError('Retry failed', error);
      toast.error(getDocumentUserFriendlyError(error, t('documentUploadError'), t('documentUploadPermissionError'), t));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (uploading) return;
    if (!canUpload) {
      toast.error(t('accessDenied'));
      return;
    }
    if (!form.name) {
      toast.error(t('documentNameRequired'));
      return;
    }
    if (form.visibility === 'selected' && selectedAudience.length === 0) {
      toast.error(t('selectAudienceRequired'));
      return;
    }

    if (addMode === 'link') {
      const parsed = parseGoogleDocLink(externalUrl);
      if (!parsed) {
        toast.error(t('invalidGoogleLink'));
        return;
      }
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
      closeUploadDialog();
      toast.success(t('googleDocumentLinked'));
      return;
    }

    const filesToUpload = files.length > 0 ? files : (file ? [file] : []);
    if (filesToUpload.length === 0) {
      toast.error(t('selectFileRequired'));
      return;
    }

    setUploading(true);
    setBatchResults({
      results: filesToUpload.map((f, i) => ({ index: i, file: f, status: 'pending', document: null, error: null })),
      successCount: 0,
      failedCount: 0,
    });
    try {
      const { results, successCount, failedCount } = await uploadDocumentsBatch({
        files: filesToUpload,
        name: form.name,
        project_id: form.project_id || null,
        visibility: form.visibility,
        notes: form.notes,
        type: form.type,
        audience_user_ids: selectedAudience,
        onFileStatus: (index, status, error) => {
          setBatchResults(prev => prev && {
            ...prev,
            results: prev.results.map(entry => (
              entry.index === index ? { ...entry, status, error } : entry
            )),
          });
        },
      });
      setBatchResults({ results, successCount, failedCount });
      await refreshDocumentList({ queryClient, userId: currentUser?.id, t, toast });
      if (failedCount === 0) {
        closeUploadDialog();
        toast.success(t('batchAllSuccess', { count: successCount }));
      } else if (successCount > 0) {
        toast.warning(t('batchPartialSuccess', { success: successCount, total: filesToUpload.length }));
      } else {
        toast.error(t('uploadFailed'));
      }
    } catch (error) {
      logDocumentError('Upload failed', error);
      toast.error(getDocumentUserFriendlyError(
        error,
        addMode === 'link' ? t('documentLinkError') : t('documentUploadError'),
        t('documentUploadPermissionError'),
        t
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
    const doneLabel = archived ? t('archived') : t('restored');
    const permissionMessage = archived ? t('documentArchivePermissionError') : t('documentRestorePermissionError');

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
        toast.success(`${doneLabel} ${updatedIds.length} ${updatedIds.length !== 1 ? t('documents') : t('document')}`);
      } else if (updatedIds.length > 0) {
        const details = [];
        if (denied.length > 0) details.push(`${denied.length} ${t('couldNotBeUpdated')}`);
        if (missing.length > 0) details.push(`${missing.length} ${t('noLongerExists')}`);
        toast.warning(`${doneLabel} ${updatedIds.length}/${idsArr.length} ${idsArr.length !== 1 ? t('documents') : t('document')}. ${details.join(` ${t('and')} `)}.`);
      } else if (denied.length > 0) {
        toast.error(getDocumentUserFriendlyError(denied[0].error, permissionMessage, permissionMessage, t));
      } else {
        toast.warning(t('documentNoLongerAvailable'));
      }
    } catch (error) {
      logDocumentError(`${action} failed`, error);
      toast.error(getDocumentUserFriendlyError(error, archived ? t('documentArchiveError') : t('documentRestoreError'), permissionMessage, t));
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
      // the row counts as deleted. The stored object is removed first, while the metadata
      // row still exists, so a storage removal that the policies refuse
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
        for (const deleted of results.filter(result => result.dbDeleted)) {
          const document = documents.find(item => item.id === deleted.id);
          logAction('DOCUMENT_DELETED', {
            entityType: 'documents',
            entityId: deleted.id,
            metadata: { file_name: document?.file_name || document?.name || null },
          });
        }
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
        toast.success(`${t('deleted')} ${deletedIds.length} ${deletedIds.length !== 1 ? t('documents') : t('document')}`);
      } else if (deletedIds.length > 0) {
        const details = [`${deleteFailures.length} ${t('couldNotBeDeleted')}`];
        if (storageBlocked.length > 0) details.push(`${storageBlocked.length} ${storageBlocked.length !== 1 ? t('filesCouldNotBeRemoved') : t('fileCouldNotBeRemoved')}`);
        toast.warning(`${t('deleted')} ${deletedIds.length}/${ids.length} ${ids.length !== 1 ? t('documents') : t('document')}. ${details.join(` ${t('and')} `)}.`);
      } else if (storageBlocked.length === ids.length) {
        toast.error(t('documentStorageDeleteBlocked'));
      } else {
        const firstError = deleteFailures[0]?.error;
        toast.error(firstError?.code === 'DELETE_NOT_APPLIED'
          ? t('documentDeleteNotApplied')
          : (firstError?.message || t('documentDeleteError')));
      }
    } catch (err) {
      logDocumentError('Delete failed', err);
      toast.error(err.message || t('documentDeleteError'));
    } finally {
      setMutating(false);
    }
  };

  const getTypeLabel = (type) => docTypeOptions.find(t => t.value === type)?.label || type;

  const completedUploadCount = batchResults
    ? batchResults.results.filter(entry => entry.status === 'succeeded' || entry.status === 'failed').length
    : 0;

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
              {t('active')}
            </button>
            <button
              onClick={() => handleViewChange('archived')}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${view === 'archived' ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t('archived')}
            </button>
          </div>
        )}

        {isSuperAdmin && filtered.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAll} />
              {t('selectAll')}
            </label>
            <div className="flex items-center gap-2 ml-auto">
              {view === 'active' ? (
                <>
                  <Button variant="outline" size="sm" className="gap-2" disabled={mutating || selectedIds.size === 0} onClick={() => executeArchive([...selectedIds])}>
                    <Archive className="w-3.5 h-3.5" /> {t('archiveSelected')}
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" disabled={mutating} onClick={() => executeArchive(filtered.map(d => d.id))}>
                    <Archive className="w-3.5 h-3.5" /> {t('archiveAll')}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" className="gap-2" disabled={mutating || selectedIds.size === 0} onClick={() => executeRestore([...selectedIds])}>
                    <RotateCcw className="w-3.5 h-3.5" /> {t('restoreSelected')}
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" disabled={mutating} onClick={() => executeRestore(filtered.map(d => d.id))}>
                    <RotateCcw className="w-3.5 h-3.5" /> {t('restoreAll')}
                  </Button>
                </>
              )}
              <Button variant="destructive" size="sm" className="gap-2" disabled={mutating || selectedIds.size === 0} onClick={() => handleBulkDeleteConfirm('selected')}>
                <Trash2 className="w-3.5 h-3.5" /> {t('deleteSelected')}
              </Button>
              {mutating && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState icon={FileText} title={t('noDocuments')} description={view === 'archived' ? t('noArchivedDocuments') : t('uploadFirstDocument')} actionLabel={canUpload && view === 'active' ? t('uploadDocument') : undefined} onAction={canUpload && view === 'active' ? openUploadDialog : undefined} />
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
                      <button onClick={() => handleDownload(doc)} disabled={downloadingId === doc.id} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40" title={t('download')}>
                        {downloadingId === doc.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    {doc.file_url && (
                      <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title={t('openDocument')}>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Button>
                      </a>
                    )}
                    {doc.project_id && canSubmitToTimeline && (
                      <button
                        onClick={() => submitToTimeline(doc)}
                        disabled={submittingId === doc.id}
                        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                        title={t('submitToTimeline') || 'Submit to Project Timeline'}
                        aria-label={`${t('submitToTimeline') || 'Submit to Project Timeline'}: ${doc.name || doc.file_name || ''}`}
                      >
                        {submittingId === doc.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    {isSuperAdmin && (
                      view === 'active' ? (
                        <button onClick={() => executeArchive(doc.id)} disabled={mutating} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40" title={t('archive')}>
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button onClick={() => executeRestore(doc.id)} disabled={mutating} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40" title={t('restore')}>
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )
                    )}
                    {canDelete && (
                      <button onClick={() => handleBulkDeleteConfirm('single', doc.id)} disabled={mutating} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40" title={t('delete')}>
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
                  {doc.visibility && <VisibilityBadge value={doc.visibility} />}
                  <span>{doc.created_at ? format(new Date(doc.created_at), 'MMM d, yyyy') : ''}</span>
                </div>
                {doc.project_id && <p className="text-xs text-primary mt-1">{projects.find(project => project.id === doc.project_id)?.name || t('projectAssigned')}</p>}
                {doc.user_id === currentUser?.id && (
                  <div className="flex gap-2 mt-2">
                    <Button type="button" size="sm" variant="outline" onClick={async () => {
                      const { data: audience, error } = await supabase.from('document_audience').select('user_id').eq('document_id', doc.id);
                      if (error) {
                        logDocumentError('Loading document audience failed', error, { documentId: doc.id });
                        toast.error(getDocumentUserFriendlyError(error, t('documentAccessLoadError', 'Unable to load document access. Please try again.'), t('documentAccessPermissionError', "You don't have permission to change access for this document."), t));
                        return;
                      }
                      setAccessDocument(doc);
                      setAccessVisibility(doc.visibility || 'private');
                      setAccessAudience((audience || []).map(item => item.user_id));
                    }}>{t('editAccess')}</Button>
                    {doc.project_id && <Button type="button" size="sm" variant="ghost" onClick={() => removeProject(doc)}>{t('removeProject')}</Button>}
                  </div>
                )}
                {doc.notes && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{doc.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showUpload} onOpenChange={open => { if (!open && !uploading) closeUploadDialog(); }}>
        <DialogContent className="max-h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle className="font-heading">{t('addDocument')}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="flex-1 min-h-0 space-y-4 overflow-y-auto pe-1" dir={dir}>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setAddMode('file'); resetUploadState(); }}
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
              <div className="space-y-2">
                <Label>{t('file')}</Label>
                <DocumentDropZone
                  files={files}
                  file={file}
                  fileError={fileError || (fileErrors.length > 0 ? fileErrors[0].message : null)}
                  fileErrors={fileErrors}
                  uploading={uploading}
                  accept={DOCUMENT_FILE_ACCEPT}
                  multiple={true}
                  onFilesSelect={pickFiles}
                  onFileSelect={pickFile}
                  onFileRemove={(idx) => {
                    if (typeof idx === 'number') {
                      removeFileFromSelection(idx);
                    } else {
                      setFile(null);
                      setFileError(null);
                    }
                  }}
                  id="document-file-input"
                  aria-label={t('uploadFile')}
                  aria-describedby="document-file-hint"
                />
                {files.length > 1 && (
                  <p className="text-xs text-muted-foreground">
                    {t('batchSettingsApplyToAll', { count: files.length, defaultValue: 'These settings apply to all {{count}} files.' })}
                  </p>
                )}
              </div>
            )}
            <div>
              <Label>{t('project')}</Label>
              <Select value={form.project_id || 'none'} onValueChange={value => setForm({...form, project_id: value === 'none' ? null : value})}>
                <SelectTrigger><SelectValue placeholder={t('noProject')} /></SelectTrigger>
                <SelectContent><SelectItem value="none">{t('noProject')}</SelectItem>{projects.map(project => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <VisibilitySelect
              id="doc-visibility"
              value={form.visibility}
              onValueChange={value => { setForm({...form, visibility: value}); if (value !== 'selected') setSelectedAudience([]); }}
            />
            {form.visibility === 'selected' && (
              <AudiencePicker
                idPrefix="doc-upload"
                members={audienceMembers}
                selectedIds={selectedAudience}
                onToggle={(id) => setSelectedAudience(previous => previous.includes(id) ? previous.filter(memberId => memberId !== id) : [...previous, id])}
              />
            )}
            {batchResults && (
              <div className="text-xs space-y-1 mb-2" role="status" aria-live="polite">
                {uploading && batchResults.results.length > 0 && (
                  <div className="text-primary">
                    {t('uploadInProgress', { current: completedUploadCount, total: batchResults.results.length, defaultValue: 'Uploading... {{current}} of {{total}}' })}
                  </div>
                )}
                {!uploading && batchResults.failedCount > 0 && (
                  <div className="text-destructive">
                    {t('batchSomeFailed', { failed: batchResults.failedCount, defaultValue: '{{failed}} files failed to upload' })}
                  </div>
                )}
                {batchResults.results.filter(entry => entry.status === 'failed' || entry.status === 'invalid').map(entry => (
                  <div key={entry.index} className="flex justify-between items-center gap-2">
                    <span className="truncate max-w-[200px]">{entry.file.name}</span>
                    <span className="text-destructive text-end">{resultErrorMessage(entry)}</span>
                  </div>
                ))}
                {!uploading && batchResults.failedCount > 0 && (
                  <Button type="button" size="sm" variant="outline" onClick={retryFailedFiles} className="gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> {t('retryUpload')}
                  </Button>
                )}
              </div>
            )}
            <DialogFooter className="sticky bottom-0 bg-background pt-2">
              <Button type="button" variant="outline" onClick={closeUploadDialog} disabled={uploading}>{t('cancel')}</Button>
              <Button type="submit" disabled={uploading || !form.name}>
                {uploading && <Loader2 className="w-4 h-4 me-2 animate-spin" aria-hidden />}
                {uploading ? t('uploading') : addMode === 'link' ? t('save') : t('upload')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!accessDocument} onOpenChange={open => !open && setAccessDocument(null)}>
        <DialogContent className="max-h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle className="font-heading flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-muted-foreground" aria-hidden />{t('editAccess', 'Edit document access')}</DialogTitle></DialogHeader>
          <div className="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
            <VisibilitySelect
              id="doc-access-visibility"
              value={accessVisibility}
              onValueChange={setAccessVisibility}
            />
            {accessVisibility === 'selected' && (
              <AudiencePicker
                idPrefix="doc-access"
                members={audienceMembers}
                selectedIds={accessAudience}
                onToggle={(id) => setAccessAudience(previous => previous.includes(id) ? previous.filter(memberId => memberId !== id) : [...previous, id])}
              />
            )}
          </div>
          <DialogFooter className="sticky bottom-0 bg-background pt-2"><Button variant="outline" disabled={accessSaving} onClick={() => setAccessDocument(null)}>{t('cancel')}</Button><Button disabled={accessSaving} onClick={saveAccess}>{accessSaving ? t('saving') : t('saveAccess')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('documentDeleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('documentDeleteConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutating}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeBulkDelete}
              disabled={mutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {mutating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('confirmDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
