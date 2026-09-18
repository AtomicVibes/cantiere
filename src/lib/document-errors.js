export function getDocumentUserFriendlyError(error, fallback = 'Unable to update document access. Please try again.') {
  const code = error?.code;
  const message = String(error?.message || '').toLowerCase();

  if (code === '42501' || message.includes('row-level security') || message.includes('not authorized') || message.includes('permission')) {
    return "You don't have permission to change access for this document.";
  }
  if (message.includes('selected visibility') || message.includes('audience')) {
    return 'Please select at least one person.';
  }
  if (message.includes('not found') || code === 'PGRST116') {
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
