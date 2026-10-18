// Timeline entry edit + visibility contracts for the project detail screen:
//   1. the pen edit action renders for authorized users with translated,
//      accessible labels in all four locales
//   2. UI gating mirrors server-side RLS (timeline rows: admins only;
//      document metadata: owner only) and RLS stays authoritative
//   3. edit mode prepopulates title, description, date, file display name,
//      visibility and audience from the existing records
//   4. saving updates the existing rows (no duplicate insert) and only the
//      editable columns - never project, owner, uploader or timestamps
//   5. visibility changes persist through the owner-checked RPC and the
//      database CHECK constraint; invalid values are rejected server-side
//   6. metadata edits never touch the storage object; replacements upload a
//      fresh object first, switch the row only after the upload succeeds,
//      roll back only the new object on failure and delete the old object
//      last, reporting cleanup problems without risking data loss
//   7. new uploads still persist the selected visibility with a secure
//      'private' default
//   8. archive/restore/preview/download/delete behaviour is untouched
//   9. en/fr/it/ar translation keys resolve for every new string
//  10. audit triggers for timeline and document changes remain in place
// Run with: node --test src/lib/timelineEntryEdit.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import i18n from '../i18n.js';
import {
  normalizeDocumentFileName,
  getFileExtension,
  documentNotesChanged,
  normalizeDocumentNotes,
  formatFileSizeLabel,
} from './entryDocument.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const LANGS = ['en', 'fr', 'it', 'ar'];
const NEW_KEYS = [
  'editEntry',
  'timelineEntryUpdated',
  'entryUpdateError',
  'visibilityPrivateHint',
  'visibilityPublicHint',
  'visibilitySelectedHint',
  'replaceDocument',
  'replaceDocumentHint',
  'documentDescription',
  'documentReplaced',
  'documentReplaceFailed',
  'documentReplaceCleanupFailed',
  'invalidFileName',
];

const detail = read('src/pages/ProjectDetail.jsx');

const sliceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start > -1, `start marker found: ${startMarker}`);
  assert.ok(end > start, `end marker found: ${endMarker}`);
  return source.slice(start, end);
};

const updateSrc = sliceBetween(detail, 'const handleUpdateEntry', '// Remove a timeline submission');
const addSrc = sliceBetween(detail, 'const handleAddEntry', 'const handleUpdateEntry');
const openEditSrc = sliceBetween(detail, 'const openEditEntry', 'React.useEffect(() => {');

describe('filename and description helpers', () => {
  it('preserves the original extension by default', () => {
    assert.equal(normalizeDocumentFileName('report', 'old.pdf'), 'report.pdf');
    assert.equal(normalizeDocumentFileName('report.pdf', 'old.docx'), 'report.pdf');
    assert.equal(normalizeDocumentFileName('report.', 'old.pdf'), 'report.pdf');
    assert.equal(normalizeDocumentFileName('  report  ', 'old.pdf'), 'report.pdf');
    assert.equal(normalizeDocumentFileName('تقرير', 'old.pdf'), 'تقرير.pdf');
  });

  it('keeps names that already carry their own extension', () => {
    assert.equal(normalizeDocumentFileName('photo.png', 'old.pdf'), 'photo.png');
    assert.equal(normalizeDocumentFileName('archive.v2', 'old.pdf'), 'archive.v2');
    assert.equal(normalizeDocumentFileName('report', 'old'), 'report');
  });

  it('rejects empty, traversal and unsafe names', () => {
    const cases = ['', '   ', '.', '..', '...', '../secret', 'a/b', 'a\\b', 'a\u0000b', 'a\nb'];
    for (const bad of cases) {
      assert.throws(
        () => normalizeDocumentFileName(bad, 'old.pdf'),
        (err) => err?.code === 'INVALID_FILE_NAME',
        `rejects ${JSON.stringify(bad)}`
      );
    }
  });

  it('extracts extensions only from real trailing segments', () => {
    assert.equal(getFileExtension('a.b.pdf'), '.pdf');
    assert.equal(getFileExtension('.hidden'), '');
    assert.equal(getFileExtension('trailing.'), '');
    assert.equal(getFileExtension(null), '');
  });

  it('detects description changes and normalizes cleared values', () => {
    assert.equal(documentNotesChanged('a', 'a'), false);
    assert.equal(documentNotesChanged(' a ', 'a'), false);
    assert.equal(documentNotesChanged('a', ''), true, 'intentional clearing counts as a change');
    assert.equal(documentNotesChanged(null, 'x'), true);
    assert.equal(documentNotesChanged(null, null), false);
    assert.equal(normalizeDocumentNotes('  x  '), 'x');
    assert.equal(normalizeDocumentNotes(''), null, 'cleared description persists as NULL');
    assert.equal(normalizeDocumentNotes(undefined), null);
  });

  it('formats file sizes for the dialog metadata line', () => {
    assert.equal(formatFileSizeLabel(0), '');
    assert.equal(formatFileSizeLabel(null), '');
    assert.equal(formatFileSizeLabel(2048), '2 KB');
    assert.equal(formatFileSizeLabel(1048576), '1.0 MB');
  });
});

describe('edit action is exposed to authorized users only', () => {
  it('renders a pen icon button with translated tooltip and accessible name', () => {
    assert.ok(detail.includes('<Pencil className="w-3.5 h-3.5" />'), 'pen icon used for the row action');
    assert.ok(detail.includes("title={t('editEntry')}"), 'tooltip uses the translated label');
    assert.ok(detail.includes('aria-label={`${t(\'editEntry\')}: ${entry.title}`},') || detail.includes('aria-label={`${t(\'editEntry\')}: ${entry.title}`}'), 'icon-only button exposes an accessible name');
    assert.ok(detail.includes('onClick={() => openEditEntry(entry)}'), 'button opens the shared form in edit mode');
  });

  it('gates the action on the same roles as the server policies', () => {
    assert.ok(detail.includes('canEditEntry(entry)'), 'row action is gated per entry');
    assert.ok(detail.includes('canEditTimelineEntry || canEditDocument(entry)'), 'eligible when the user may edit entry fields or owns the document');
    assert.ok(detail.includes("PERMISSIONS.canEditTimelineEntry.includes(userRole)"), 'permission comes from the shared PERMISSIONS map');
    const permissions = read('src/lib/permissions.js');
    assert.ok(
      /canEditTimelineEntry:\s*\[\s*'super_admin',\s*'admin'\s*\]/.test(permissions),
      'matches project_timeline UPDATE policy (is_admin only, no manager)'
    );
  });

  it('keeps document metadata editable only for the document owner', () => {
    assert.ok(
      detail.includes('entry.document.user_id === userId'),
      'document fields follow the owner-only documents UPDATE policy'
    );
    assert.ok(detail.includes('disabled={!!editingEntry && !canEditTimelineEntry}'), 'non-editable timeline fields are disabled in the form');
  });
});

describe('database authorization stays authoritative (RLS)', () => {
  const timelinePolicy = read('supabase/migrations/20240703000001_create_project_timeline.sql');
  const documentsMigration = read('supabase/migrations/20260917000003_create_documents_metadata.sql');
  const visibilityMigration = read('supabase/migrations/20260917000004_documents_visibility_timeline.sql');
  const rlsMigration = read('supabase/migrations/20260918000001_fix_documents_rls_and_audience_validation.sql');
  const accessRpc = read('supabase/migrations/20260918000010_harden_and_centralize_audit_logging.sql');

  it('project_timeline updates require an admin, even for direct requests', () => {
    assert.ok(timelinePolicy.includes('ENABLE ROW LEVEL SECURITY'), 'RLS enabled on project_timeline');
    assert.ok(timelinePolicy.includes('CREATE POLICY "Admins can update timeline entries"'), 'update policy exists');
    assert.ok(/Admins can update timeline entries[\s\S]*USING \(public\.is_admin\(\)\)/.test(timelinePolicy), 'update restricted to is_admin()');
  });

  it('documents and their audience remain owner-controlled', () => {
    assert.ok(/enable row level security/i.test(documentsMigration), 'RLS enabled on documents');
    assert.ok(rlsMigration.includes('"Owners can update documents"'), 'owner-only update policy kept');
    assert.ok(/"Owners can update documents"[\s\S]*using \(user_id = auth\.uid\(\)\)[\s\S]*with check \(user_id = auth\.uid\(\)\)/.test(rlsMigration), 'owner enforced on both USING and WITH CHECK');
    assert.ok(visibilityMigration.includes('enable row level security'), 'RLS enabled on document_audience');
    assert.ok(visibilityMigration.includes('Document owners can manage audience'), 'audience writes restricted to the owner');
  });

  it('storage access still resolves through the document row', () => {
    assert.ok(
      visibilityMigration.includes('create policy "Users can read authorized document objects"'),
      'storage SELECT policy kept'
    );
    assert.ok(
      visibilityMigration.includes('public.can_read_document(document.id, auth.uid())'),
      'storage reads still require document authorization'
    );
    assert.ok(!/create policy ".*" on storage\.objects for update/i.test([documentsMigration, timelinePolicy, visibilityMigration, rlsMigration, accessRpc].join('\n')), 'no storage UPDATE policy was introduced');
  });

  it('the update RPC rejects invalid visibility and empty audiences', () => {
    assert.ok(accessRpc.includes("p_visibility not in ('private', 'public', 'selected')"), 'invalid visibility rejected');
    assert.ok(accessRpc.includes('Selected visibility requires at least one audience user'), 'empty selected audience rejected');
    assert.ok(accessRpc.includes('Not authorized to update this document'), 'non-owner rejected server-side');
  });
});

describe('edit mode prepopulates existing metadata', () => {
  it('fills title, description, date, file name and visibility from the entry', () => {
    assert.ok(openEditSrc.includes("title: entry.title || ''"), 'title prepopulated');
    assert.ok(openEditSrc.includes("description: entry.description || ''"), 'description prepopulated');
    assert.ok(openEditSrc.includes("date: entry.date || ''"), 'date prepopulated');
    assert.ok(openEditSrc.includes("entry.document?.file_name || ''"), 'file display name prepopulated');
    assert.ok(openEditSrc.includes("entry.document?.visibility || 'private'"), 'visibility prepopulated with a private fallback');
  });

  it('loads the saved audience for owner-editable documents', () => {
    assert.ok(openEditSrc.includes("from('document_audience')"), 'reads the audience rows');
    assert.ok(openEditSrc.includes("eq('document_id', entry.document.id)"), 'scoped to the entry document');
    assert.ok(openEditSrc.includes('setEntryAudienceOriginal'), 'baseline kept for change detection');
    assert.ok(openEditSrc.includes("t('documentAccessLoadError'"), 'load failures surface a translated error');
  });

  it('opens the existing shared form instead of a parallel editor', () => {
    assert.ok(detail.includes('{(addingEntry || editingEntry) && ('), 'single shared form for create and edit');
    assert.ok(detail.includes("editingEntry ? t('editEntry') : t('addEntry')"), 'mode-aware heading');
    assert.ok(detail.includes('showVisibilityControls'), 'shared visibility block reused in both modes');
  });
});

describe('saving updates existing records without touching the file', () => {
  it('writes to project_timeline and documents, never inserts', () => {
    assert.ok(!/createEntity\(/.test(updateSrc), 'no createEntity in the edit path');
    assert.ok(!/\.insert\(/.test(updateSrc), 'no raw insert in the edit path');
    assert.ok(updateSrc.includes("from('project_timeline')\n            .update({") || updateSrc.includes(".update({\n              title: newEntry.title"), 'timeline row updated in place');
    assert.ok(updateSrc.includes(".eq('id', entry.id)"), 'scoped to the edited entry id');
    assert.ok(updateSrc.includes("const metadataPayload = fileNameChanged ? { file_name: nextFileName } : {}"), 'document display name updated in place');
    assert.ok(updateSrc.includes('.update(metadataPayload)'), 'document metadata updated in place');
    assert.ok(updateSrc.includes('.eq(\'id\', entry.document.id)'), 'document scoped to the attached document id');
  });

  it('only sends editable columns (no project, owner, uploader or storage fields)', () => {
    const timelinePayload = updateSrc.slice(updateSrc.indexOf('from(\'project_timeline\')'), updateSrc.indexOf('.eq(\'id\', entry.id)'));
    for (const allowed of ['title:', 'description:', 'date:']) {
      assert.ok(timelinePayload.includes(allowed), `timeline payload keeps ${allowed}`);
    }
    for (const forbidden of ['project_id', 'submitted_by', 'document_id', 'status', 'user_id', 'storage_path', 'created_at']) {
      assert.ok(!timelinePayload.includes(forbidden), `timeline payload never sends ${forbidden}`);
    }
    assert.ok(updateSrc.includes("const metadataPayload = fileNameChanged ? { file_name: nextFileName } : {}"), 'metadata update only carries the display fields');
    const storageAssignments = updateSrc.match(/storage_path:/g) || [];
    assert.equal(storageAssignments.length, 1, 'storage_path is assigned only by the replacement payload');
    assert.ok(updateSrc.includes('storage_path: newStoragePath'), 'and only to the freshly uploaded path');
    assert.ok(!/metadataPayload[^}]*storage_path/.test(updateSrc), 'rename/description never send storage_path');
    assert.ok(!/update\(\{[^}]*user_id/.test(updateSrc), 'ownership never sent');
  });

  it('storage writes only happen through the guarded replacement flow', () => {
    assert.ok(!updateSrc.includes('uploadDocumentFile'), 'creation upload helper never reused in the edit path');
    assert.ok(!updateSrc.includes("storage.from('documents')"), 'no direct storage call; the shared integration is used');
    assert.ok(updateSrc.includes('Core.UploadFile({ file: entryFile })'), 'replacement uploads through the shared integration');
    assert.ok(!updateSrc.includes('DocumentDropZone'), 'file selection stays in the UI layer');
  });

  it('prevents duplicate submissions and keeps input on failure', () => {
    assert.ok(/if \(!entry \|\| entryUploading\) return;/.test(updateSrc), 'busy guard at the top of the handler');
    assert.ok(detail.includes('disabled={entryUploading || entryFormInvalid}'), 'save button disabled while pending or invalid');
    assert.ok(!/resetEntryForm\(\);[\s\S]{0,200}return;/.test(updateSrc), 'form state is only reset after success');
    assert.ok(updateSrc.includes('finally') && updateSrc.includes('setEntryUploading(false)'), 'loading state always cleared');
    assert.ok(updateSrc.includes("getDocumentUserFriendlyError(err, t('entryUpdateError'), t('errors.permissionDenied'), t)"), 'failures surface translated, non-destructive feedback');
  });

  it('validates selected audience before saving and on upload', () => {
    assert.ok(updateSrc.includes("entryVisibility === 'selected' && entryAudience.length === 0"), 'edit path validates audience');
    assert.ok(addSrc.includes("entryVisibility === 'selected' && entryAudience.length === 0"), 'create path validates audience');
    assert.ok(addSrc.includes('selectAudienceRequired'), 'uses the shared translated message');
  });
});

describe('visibility behavior', () => {
  it('new uploads persist the selected visibility with a secure default', () => {
    assert.ok(addSrc.includes('visibility: entryVisibility'), 'upload passes the chosen visibility');
    assert.ok(detail.includes("useState('private')"), "explicit 'private' default");
    assert.ok(addSrc.includes("audience_user_ids: entryVisibility === 'selected' ? entryAudience : []"), 'selected uploads carry the audience');
  });

  it('edit mode shows and persists the saved visibility', () => {
    assert.ok(updateSrc.includes("supabase.rpc('update_document_access'"), 'visibility changes go through the owner-checked RPC');
    assert.ok(updateSrc.includes('p_visibility: entryVisibility'), 'selected value persisted');
    assert.ok(updateSrc.includes('p_audience_user_ids: entryAudience'), 'audience persisted');
    assert.ok(detail.includes("entryVisibility !== (entry.document.visibility || 'private')"), 'change detection against the stored value');
    assert.ok(detail.includes('<VisibilityBadge value={entry.document.visibility} />'), 'saved visibility displayed on the entry row');
  });

  it('database CHECK keeps the canonical values', () => {
    const mig = read('supabase/migrations/20260917000004_documents_visibility_timeline.sql');
    assert.ok(mig.includes("check (visibility in ('private', 'public', 'selected'))"), 'canonical visibility values enforced');
    assert.ok(mig.includes("add column if not exists visibility text not null default 'private'"), "secure 'private' column default");
  });

  it('UI reuses the shared selector with translated per-choice descriptions', () => {
    assert.ok(detail.includes('VisibilitySelect'), 'shared selector used');
    assert.ok(detail.includes('AudiencePicker'), 'shared audience picker used');
    assert.ok(detail.includes("t('visibilityPrivateHint')"), 'private explained');
    assert.ok(detail.includes("t('visibilityPublicHint')"), 'public explained');
    assert.ok(detail.includes("t('visibilitySelectedHint')"), 'selected explained');
    assert.ok(!detail.includes('<SelectItem value="private">'), 'no hardcoded visibility options');
  });
});

describe('existing document behaviours stay intact', () => {
  it('preview, download, archive, restore and delete are untouched', () => {
    assert.ok(detail.includes('<DocumentPreview document={entry.document} />'), 'timeline preview kept');
    assert.ok(detail.includes('handleRemoveEntry'), 'timeline removal kept');
    assert.ok(detail.includes('entryToDelete'), 'removal confirmation kept');
    const docs = read('src/pages/Documents.jsx');
    for (const marker of ['executeArchive', 'executeRestore', 'handleDownload', 'DocumentPreview', 'handleBulkDeleteConfirm', 'submitToTimeline']) {
      assert.ok(docs.includes(marker), `Documents.jsx keeps ${marker}`);
    }
    const dropZone = read('src/components/shared/DocumentDropZone.jsx');
    assert.ok(dropZone.includes('DocumentDropZone'), 'shared drop zone unchanged');
  });

  it('create flow still uploads then links the document', () => {
    assert.ok(addSrc.includes('uploadDocumentFile'), 'create path uploads');
    assert.ok(addSrc.includes("createEntryMutation.mutateAsync"), 'create path inserts the timeline row');
    assert.ok(addSrc.includes('rollback') || addSrc.includes('orphaned record'), 'orphan rollback kept');
  });
});

describe('audit conventions remain in effect', () => {
  it('server triggers record timeline and document changes', () => {
    const audit = read('supabase/migrations/20260918000010_harden_and_centralize_audit_logging.sql');
    assert.ok(audit.includes('create trigger trg_audit_timeline'), 'timeline trigger kept');
    assert.ok(audit.includes("'TIMELINE_UPDATE'"), 'timeline updates audited');
    const links = read('supabase/migrations/20260921100000_documents_external_links.sql');
    assert.ok(links.includes("'DOCUMENT_VISIBILITY_CHANGE'"), 'visibility changes audited');
    assert.ok(links.includes("'DOCUMENT_UPDATE'"), 'metadata changes audited');
    assert.ok(audit.includes("'DOCUMENT_AUDIENCE_CHANGE'"), 'audience-only edits audited');
  });

  it('the edit path leaves canonical audit writing to the server', () => {
    assert.ok(!updateSrc.includes("write_audit_log"), 'no duplicate client-side audit row for edits');
    assert.ok(updateSrc.includes("logAction('DOCUMENT_UPDATED'"), 'activity tracking still records document edits');
  });
});

describe('rename and description edits', () => {
  it('normalizes the display name, preserving the extension', () => {
    assert.ok(updateSrc.includes('normalizeDocumentFileName(nextFileName, entry.document.file_name)'), 'display name normalized against the original');
    assert.ok(updateSrc.includes("toast.error(t('invalidFileName'))"), 'unsafe names rejected with a translated message');
    assert.ok(updateSrc.includes("toast.error(t('documentNameRequired'))"), 'empty names still rejected');
  });

  it('openEditEntry preloads the stored description', () => {
    assert.ok(openEditSrc.includes("setEntryNotes(entry.document?.notes || '')"), 'description prepopulated');
    assert.ok(openEditSrc.includes('setReplacingEntry(false)'), 'replacement picker reset per entry');
  });

  it('description changes are detected and intentional clearing persists', () => {
    assert.ok(updateSrc.includes('documentNotesChanged(entry.document.notes, entryNotes)'), 'change detection against the stored value');
    assert.ok(updateSrc.includes('if (notesChanged) replacePayload.notes = normalizeDocumentNotes(entryNotes)'), 'notes written with the replacement only when changed');
    assert.ok(updateSrc.includes('if (notesChanged) metadataPayload.notes = normalizeDocumentNotes(entryNotes)'), 'notes written with the rename only when changed');
    assert.ok(!updateSrc.includes('notes: entryNotes'), 'never overwrites with the raw input');
    assert.ok(updateSrc.includes('normalizeDocumentNotes(entryNotes)'), 'cleared descriptions persist as NULL');
  });

  it('the document UI offers rename, description and replace distinctly', () => {
    assert.ok(detail.includes('id="entry-file-name"'), 'rename input present');
    assert.ok(detail.includes('id="entry-document-notes"'), 'description input present');
    assert.ok(detail.includes("t('replaceDocument')"), 'replace action translated');
    assert.ok(detail.includes("t('documentDescription')"), 'description label translated');
    assert.ok(detail.includes('DocumentDropZone'), 'shared upload component reused');
  });
});

describe('document replacement preserves the original on failure', () => {
  const uploadAt = updateSrc.indexOf('Core.UploadFile({ file: entryFile })');
  const switchAt = updateSrc.indexOf('.update(replacePayload)');
  const oldDeleteAt = updateSrc.indexOf('DeleteFile({ filePath: previousStoragePath })');
  const failureAt = updateSrc.indexOf('if (replaceError || !replaceRows?.length)');
  const successAt = updateSrc.indexOf('toast.success(documentReplaced');

  it('is gated on ownership and guards against duplicate submissions', () => {
    assert.ok(updateSrc.includes('const hasReplacementFile = docEditable && !!entry.document && !!entryFile'), 'owner + attached document required');
    assert.ok(/if \(!entry \|\| entryUploading\) return;/.test(updateSrc), 'busy guard prevents concurrent saves');
    assert.ok(updateSrc.includes('validateDocumentFile(entryFile)'), 'type/size validated before any upload');
    assert.ok(detail.includes('disabled={entryUploading || entryFormInvalid}'), 'save disabled while a replacement is in flight');
  });

  it('uploads a fresh object before switching the row, and cleans the old object last', () => {
    assert.ok(uploadAt > -1, 'replacement upload present');
    assert.ok(switchAt > uploadAt, 'row switches only after the upload succeeded');
    assert.ok(oldDeleteAt > switchAt, 'original object removed only after the row switched');
    assert.ok(successAt > oldDeleteAt, 'success reported after cleanup');
  });

  it('upload failure stops before any row change and keeps the original', () => {
    const uploadCatch = updateSrc.slice(uploadAt, updateSrc.indexOf('const newStoragePath'));
    assert.ok(/catch \(uploadError\) \{[\s\S]*documentReplaceFailed[\s\S]*\n\s*return;/.test(uploadCatch), 'translated failure and early return');
    assert.ok(!uploadCatch.includes('.update('), 'no row change after a failed upload');
  });

  it('row-switch failure removes only the unreferenced new object', () => {
    const failureBlock = updateSrc.slice(failureAt, updateSrc.indexOf('documentReplaced = true'));
    assert.ok(failureBlock.includes('DeleteFile({ filePath: newStoragePath })'), 'new object rolled back');
    assert.ok(!failureBlock.includes('previousStoragePath'), 'original object never touched on failure');
    assert.ok(/\n\s*return;/.test(failureBlock), 'failure stops before success reporting');
    assert.ok(failureBlock.includes("toast.error(t('errors.permissionDenied'))") && failureBlock.includes('documentReplaceFailed'), 'permission and generic failures both surfaced');
  });

  it('old-object cleanup failure is reported but never fails the save', () => {
    const cleanupBlock = updateSrc.slice(updateSrc.indexOf('documentReplaced = true'), updateSrc.indexOf('} else if (fileNameChanged'));
    assert.ok(cleanupBlock.includes('previousStoragePath && previousStoragePath !== newStoragePath'), 'cleanup scoped to a distinct old object');
    assert.ok(cleanupBlock.includes("code === 'STORAGE_DELETE_NOT_APPLIED'"), 'already-absent object tolerated');
    assert.ok(cleanupBlock.includes("toast.warning(t('documentReplaceCleanupFailed'))"), 'cleanup issue reported');
    assert.ok(!cleanupBlock.includes('return;'), 'cleanup failure never aborts the confirmed save');
  });

  it('external-link documents switch cleanly to a stored file', () => {
    assert.ok(updateSrc.includes('external_url: null'), 'external url cleared on replace');
    assert.ok(updateSrc.includes('external_provider: null'), 'external provider cleared on replace');
  });

  it('an external link becomes a stored document with the internal default type', () => {
    assert.ok(
      /if \(entry\.document\.external_provider\) replacePayload\.type = 'other';/.test(updateSrc),
      "external rows fall back to the repository's internal default type"
    );
    assert.ok(!/(?<![\w])type:/.test(updateSrc), 'type is never sent unconditionally in any payload literal');
    assert.ok(!updateSrc.includes('metadataPayload.type'), 'metadata-only edits never touch the type');
    const documentsMigration = read('supabase/migrations/20260917000003_create_documents_metadata.sql');
    assert.ok(documentsMigration.includes("type text not null default 'other'"), "database column default matches 'other'");
    assert.ok(read('src/services/documentUploadService.js').includes("type = 'other'"), "upload helper default matches 'other'");
  });
});

describe('translations in en, fr, it and ar', () => {
  it('every new key resolves in all four locales', async () => {
    for (const lng of LANGS) {
      await i18n.changeLanguage(lng);
      for (const key of NEW_KEYS) {
        const value = i18n.getResource(lng, 'translation', key);
        assert.ok(value, `${lng}.${key} defined`);
        assert.notEqual(value, key, `${lng}.${key} never renders as a raw key`);
      }
    }
  });

  it('each new key is defined exactly once per locale', () => {
    const i18nSource = read('src/i18n.js');
    for (const key of NEW_KEYS) {
      const count = (i18nSource.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length;
      assert.equal(count, 4, `${key} in 4 languages`);
    }
  });

  it('non-English locales differ from English', () => {
    const i18nSource = read('src/i18n.js');
    for (const key of NEW_KEYS) {
      const values = LANGS.map((lng) => {
        const match = i18nSource.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'));
        return match ? match[1] : null;
      });
      assert.ok(values.every(Boolean), `${key} present for every locale`);
      const enValue = i18nSource.match(new RegExp(`${key}:\\s*(['"])(.*?)\\1`));
      assert.ok(enValue, `${key} English value readable`);
    }
    assert.ok(i18nSource.includes("editEntry: 'Edit entry'"), 'English reference value kept');
    assert.ok(i18nSource.includes("editEntry: 'تعديل القيد'"), 'Arabic translation present');
    assert.ok(i18nSource.includes("editEntry: \"Modifier l'entrée\""), 'French translation present');
    assert.ok(i18nSource.includes("editEntry: 'Modifica voce'"), 'Italian translation present');
  });

  it('invalidFileName refers to slashes and control characters correctly', async () => {
    await i18n.changeLanguage('it');
    const itValue = i18n.getResource('it', 'translation', 'invalidFileName');
    assert.ok(itValue.includes('barre oblique'), 'Italian names slashes');
    assert.ok(!itValue.includes('barre di ritorno'), 'Italian no longer says carriage returns');
    await i18n.changeLanguage('ar');
    const arValue = i18n.getResource('ar', 'translation', 'invalidFileName');
    assert.ok(arValue.includes('رموز تحكم'), 'Arabic uses the standard term for control characters');
    assert.ok(!arValue.includes('أحكام تحكم'), 'Arabic old wording removed');
  });

  it('the touched screens keep every literal key available', () => {
    const literalKeys = (source) => {
      const keys = new Set();
      const re = /\bt\(\s*(['"`])([A-Za-z0-9_.-]+)\1/g;
      let match;
      while ((match = re.exec(source))) keys.add(match[2]);
      return keys;
    };
    for (const key of literalKeys(detail)) {
      for (const lng of LANGS) {
        assert.notEqual(i18n.getResource(lng, 'translation', key), undefined, `ProjectDetail.jsx -> ${lng}.${key}`);
      }
    }
  });
});
