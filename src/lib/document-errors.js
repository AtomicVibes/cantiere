export function getDocumentUserFriendlyError(
  error,
  fallback = 'Unable to update document access. Please try again.',
  permissionMessage = "You don't have permission to change access for this document.",
  t
) {
  const tr = typeof t === 'function' ? t : (key, defaultValue) => defaultValue;
  const code = error?.code;
  const statusCode = String(error?.statusCode || error?.status || '');
  const message = String(error?.message || '').toLowerCase();

  if (
    code === '42501'
    || statusCode === '403'
    || message.includes('row-level security')
    || message.includes('not authorized')
    || message.includes('unauthorized')
    || message.includes('permission')
  ) {
    return permissionMessage;
  }
  if (message.includes('selected visibility') || message.includes('audience')) {
    return tr('selectAudienceRequired', 'Please select at least one person.');
  }
  if (message.includes('google document link')) {
    return tr('googleLinkInvalid', 'This Google link is not valid. Paste a link to a Google Docs, Sheets or Slides document.');
  }
  if (message.includes('not found') || code === 'PGRST116' || statusCode === '404') {
    return tr('documentNotFound', 'This document could not be found.');
  }
  if (message.includes('network') || message.includes('fetch')) {
    return tr('documentAccessNetworkError', 'Unable to update document access. Please check your connection and try again.');
  }
  return fallback;
}

// Maps the machine-readable codes thrown by validateDocumentFile to translated
// user-facing messages. The service stays i18n-free (it throws codes with
// English defaults); every call site routes through this helper so ZIP and
// size-limit errors are localized too.
export function getDocumentFileValidationError(
  error,
  t,
  fallback = 'Unable to upload document. Please try again.',
) {
  const tr = typeof t === 'function' ? t : (key, defaultValue) => defaultValue;
  switch (error?.code) {
    case 'ARCHIVE_UNSUPPORTED':
      return tr('zipFileUnsupported', 'This archive is not supported.');
    case 'ARCHIVE_TOO_LARGE':
      return tr('zipFileTooLarge', 'This archive is too large. The maximum size is 50 MB.');
    case 'UNSUPPORTED_FILE_TYPE':
      return tr('documentFileTypeUnsupported', 'Unsupported file type. Use JPG, PNG, WebP, GIF, PDF, MP4, WebM, MOV, DOC, DOCX, XLS, XLSX, ZIP, 7Z, 7ZIP, or RAR.');
    case 'FILE_TOO_LARGE':
      return tr('documentFileTooLarge', 'File is too large. The maximum size is 50 MB.');
    case 'FILE_REQUIRED':
      return tr('selectFileRequired', 'Please select a file.');
    default:
      return error?.message || tr('documentUploadError', fallback);
  }
}

export function logDocumentError(context, error, details = {}) {
  console.error(`[Documents] ${context}`, {
    code: error?.code,
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
    ...details,
  });
}
