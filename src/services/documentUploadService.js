import { base44 } from '@/api/base44Client';

export const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024;

export const SUPPORTED_DOCUMENT_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'video/mp4', 'video/webm', 'video/quicktime',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export const DOCUMENT_FILE_ACCEPT = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'video/mp4', 'video/webm', 'video/quicktime',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',');

export function validateDocumentFile(file) {
  if (!file) throw new Error('A file is required');
  if (!SUPPORTED_DOCUMENT_TYPES.has(file.type)) {
    throw new Error('Unsupported file type. Use JPG, PNG, WebP, GIF, PDF, MP4, WebM, MOV, DOC, DOCX, XLS, or XLSX.');
  }
  if (file.size > MAX_DOCUMENT_SIZE) {
    throw new Error('File is too large. The maximum size is 50 MB.');
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

  return createdDocument;
}