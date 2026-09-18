export function getDocumentUserFriendlyError(
  error,
  fallback = 'Unable to update document access. Please try again.',
  permissionMessage = "You don't have permission to change access for this document."
) {
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
    return 'Please select at least one person.';
  }
  if (message.includes('not found') || code === 'PGRST116' || statusCode === '404') {
    return 'This document could not be found.';
  }
  if (message.includes('network') || message.includes('fetch')) {
    return 'Unable to update document access. Please check your connection and try again.';
  }
  return fallback;
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
