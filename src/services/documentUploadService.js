import { base44 } from '@/api/base44Client';
import { logAction } from '@/lib/activityTracking';

export const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024;

// Browsers report archives inconsistently (application/zip,
// application/x-zip-compressed, application/x-zip, application/x-7z-compressed,
// application/7z, application/x-rar-compressed, application/rar, or an
// empty/octet-stream fallback), so validation accepts the union and never
// trusts the client MIME type alone: an archive filename paired with a known
// non-archive MIME type is rejected as a mislabeled (potentially executable)
// upload. MIME sniffing does not prove an archive is safe; archives are stored
// as opaque files and never extracted or executed.
export const ZIP_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
]);

export const SEVEN_ZIP_MIME_TYPES = new Set([
  'application/x-7z-compressed',
  'application/7z',
]);

export const RAR_MIME_TYPES = new Set([
  'application/x-rar-compressed',
  'application/rar',
]);

export const ARCHIVE_MIME_TYPES = new Set([
  ...ZIP_MIME_TYPES,
  ...SEVEN_ZIP_MIME_TYPES,
  ...RAR_MIME_TYPES,
]);

export const ARCHIVE_EXTENSIONS = ['.zip', '.7z', '.7zip', '.rar'];

const ARCHIVE_AMBIGUOUS_MIMES = new Set(['', 'application/octet-stream']);

export const SUPPORTED_DOCUMENT_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'video/mp4', 'video/webm', 'video/quicktime',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ...ARCHIVE_MIME_TYPES,
]);

export const DOCUMENT_FILE_ACCEPT = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'video/mp4', 'video/webm', 'video/quicktime',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ...ARCHIVE_MIME_TYPES,
  '.zip', '.7z', '.7zip', '.rar',
].join(',');

export function hasArchiveExtension(name) {
  if (!name) return false;
  const lower = String(name).toLowerCase();
  return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isZipArchive(file) {
  if (!file) return false;
  const name = (file.name || '').toLowerCase();
  return name.endsWith('.zip') || ZIP_MIME_TYPES.has(file.type || '');
}

export function isArchiveFile(file) {
  if (!file) return false;
  const name = (file.name || '').toLowerCase();
  return hasArchiveExtension(name) || ARCHIVE_MIME_TYPES.has((file.type || '').toLowerCase());
}

function fileValidationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function validateDocumentFile(file) {
  if (!file) throw fileValidationError('A file is required', 'FILE_REQUIRED');
  const name = (file.name || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();
  const looksLikeArchive = isArchiveFile(file);

  // An archive filename paired with a recognized non-archive MIME type is a
  // mislabeled upload rather than an archive; reject it instead of storing it.
  if (hasArchiveExtension(name) && mime && !ARCHIVE_MIME_TYPES.has(mime) && !ARCHIVE_AMBIGUOUS_MIMES.has(mime)) {
    throw fileValidationError(
      'This archive is not supported.',
      'ARCHIVE_UNSUPPORTED',
    );
  }

  const isSupportedType = SUPPORTED_DOCUMENT_TYPES.has(mime) || looksLikeArchive;
  if (!isSupportedType) {
    throw fileValidationError(
      'Unsupported file type. Use JPG, PNG, WebP, GIF, PDF, MP4, WebM, MOV, DOC, DOCX, XLS, XLSX, ZIP, 7Z, 7ZIP, or RAR.',
      'UNSUPPORTED_FILE_TYPE',
    );
  }
  if (file.size > MAX_DOCUMENT_SIZE) {
    if (looksLikeArchive) {
      throw fileValidationError(
        'This archive is too large. The maximum size is 50 MB.',
        'ARCHIVE_TOO_LARGE',
      );
    }
    throw fileValidationError(
      'File is too large. The maximum size is 50 MB.',
      'FILE_TOO_LARGE',
    );
  }
}

export async function uploadDocumentFile({
  file,
  name,
  project_id = null,
  visibility = 'private',
  type = 'other',
  notes = null,
  audience_user_ids = [],
}) {
  validateDocumentFile(file);

  const { file_url } = await base44.integrations.Core.UploadFile({ file });

  let createdDocument;
  try {
    createdDocument = await base44.entities.Document.create({
      name: name || file.name,
      file_url,
      mime_type: file?.type || 'application/octet-stream',
      file_size: file?.size || 0,
      project_id: project_id || null,
      visibility,
      type,
      notes,
      audience_user_ids,
    });
  } catch (error) {
    try {
      await base44.integrations.Core.DeleteFile({ filePath: file_url });
    } catch (cleanupError) {
      console.error('[documentUploadService] failed to clean up uploaded file:', cleanupError);
    }
    throw error;
  }

  logAction('DOCUMENT_UPLOADED', {
    entityType: 'documents',
    entityId: createdDocument?.id || null,
    metadata: {
      file_name: createdDocument?.name || file.name,
      file_type: file?.type || createdDocument?.mime_type || null,
      file_size_bytes: file?.size ?? createdDocument?.file_size ?? null,
      visibility,
      project_id: project_id || null,
    },
  });

  return createdDocument;
}

// Batch upload built on the single-file primitive: every file gets its own
// storage path (generated with a UUID by the storage helper) and its own
// document row. Files run sequentially so per-file status stays truthful and a
// failure never interrupts the remaining files. Each entry tracks
// pending -> uploading -> succeeded | failed | invalid so the UI can show the
// real state, retry only failures, and never report a partial batch as a full
// success. Validation runs before any upload starts so rejected files are
// identified with a reason instead of being silently discarded.
export async function uploadDocumentsBatch({
  files,
  name,
  project_id = null,
  visibility = 'private',
  type = 'other',
  notes = null,
  audience_user_ids = [],
  onFileStatus,
}) {
  const list = Array.isArray(files) ? files : [];
  const emit = (entry) => {
    onFileStatus?.(entry.index, entry.status, entry.error || null);
  };

  const results = list.map((file, index) => {
    try {
      validateDocumentFile(file);
      return { index, file, status: 'pending', document: null, error: null };
    } catch (error) {
      const entry = { index, file, status: 'invalid', document: null, error };
      emit(entry);
      return entry;
    }
  });

  for (const entry of results) {
    if (entry.status === 'invalid') continue;
    entry.status = 'uploading';
    emit(entry);
    try {
      entry.document = await uploadDocumentFile({
        file: entry.file,
        name: name || entry.file.name,
        project_id,
        visibility,
        type,
        notes,
        audience_user_ids,
      });
      entry.status = 'succeeded';
      entry.error = null;
    } catch (error) {
      entry.status = 'failed';
      entry.error = error;
    }
    emit(entry);
  }

  const successCount = results.filter((entry) => entry.status === 'succeeded').length;
  const failedCount = results.length - successCount;
  return { results, successCount, failedCount };
}
