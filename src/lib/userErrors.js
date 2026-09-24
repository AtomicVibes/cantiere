// Centralized user-friendly error handling.
//
// Pattern (same philosophy as getDocumentUserFriendlyError / logDocumentError):
//   users    -> short, localized, actionable message via getUserFriendlyMessage()
//   developers -> full technical diagnostic via logAppError() (console.error
//               with operation context, codes and IDs - never secrets)
//
// Only whitelisted technical fields are logged (code, message, details, hint,
// status). Tokens, sessions, passwords or API keys must never be passed in.

export function isMissingTableError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '');
  return (
    code === 'PGRST205' ||
    message.includes('could not find the table') ||
    message.includes('in the schema cache')
  );
}

export function isPermissionError(error) {
  const code = String(error?.code || '');
  const status = String(error?.statusCode || error?.status || '');
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42501' ||
    status === '401' ||
    status === '403' ||
    message.includes('permission denied') ||
    message.includes('row-level security') ||
    message.includes('not authorized') ||
    message.includes('unauthorized')
  );
}

export function isNetworkError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed')
  );
}

export function isReminderConstraintError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '23514' ||
    message.includes('events_reminder_frequency_check') ||
    (message.includes('violates check constraint') && message.includes('reminder'))
  );
}

// Maps a technical error to an i18n key for the user-facing message.
// `t` is the react-i18next translate function; `fallbackKey` selects the
// default message when nothing matches. Never returns raw technical text.
export function getUserFriendlyMessage(error, t, fallbackKey = 'errors.generic') {
  const translate =
    typeof t === 'function' ? t : (key, fallback) => fallback ?? key;
  const fallbacks = {
    'errors.generic': 'Something went wrong. Please try again.',
    'errors.saveEvent': "We couldn't save the event. Please try again.",
    'errors.deleteEvent': "We couldn't delete the event. Please try again.",
    'errors.archiveEvent': "We couldn't update the event. Please try again.",
    'errors.eventReminderInvalid':
      "We couldn't save the event. Please check the reminder settings and try again.",
    'errors.eventTypesUnavailable':
      'Event types are temporarily unavailable. Existing event types can still be used.',
    'errors.deleteAuditLogs': "We couldn't delete the selected logs. Please try again.",
    'errors.archiveAuditLogs': "We couldn't archive the selected logs. Please try again.",
    'errors.restoreAuditLogs': "We couldn't restore the selected logs. Please try again.",
    'errors.loadAuditLogs': "We couldn't load the audit logs. Please try again.",
    'errors.permissionDenied': "You don't have permission to perform this action.",
    'errors.network': 'Unable to connect to the server. Please check your connection and try again.',
    'errors.notFound': 'The requested item could not be found.',
  };
  const pick = (key) => translate(key, fallbacks[key] ?? fallbacks['errors.generic']);

  if (!error) return pick(fallbackKey);
  if (isPermissionError(error)) return pick('errors.permissionDenied');
  if (isNetworkError(error)) return pick('errors.network');
  if (isReminderConstraintError(error)) return pick('errors.eventReminderInvalid');
  if (isMissingTableError(error)) return pick('errors.eventTypesUnavailable');

  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '');
  if (code === '23514' || message.includes('violates check constraint')) return pick(fallbackKey);
  if (code === '23503' || message.includes('violates foreign key constraint')) return pick(fallbackKey);
  if (
    message.includes('delete requires a where clause') ||
    message.includes('not found') ||
    code === 'PGRST116'
  ) {
    return pick(code === 'PGRST116' || message.includes('not found') ? 'errors.notFound' : fallbackKey);
  }
  return pick(fallbackKey);
}

// Developer diagnostic: logs operation context + safe technical fields.
// Keys resembling secrets (token, secret, password, apiKey, session, auth,
// credential, bearer) are NEVER logged, even when passed by mistake.
const SENSITIVE_KEY_RE = /token|secret|password|passwd|apikey|api_key|session|credential|bearer|authorization/i;

export function logAppError(context, error, extra = {}) {
  const safeExtra = {};
  for (const [key, value] of Object.entries(extra || {})) {
    if (SENSITIVE_KEY_RE.test(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      safeExtra[key] = value;
    } else if (Array.isArray(value) && value.length <= 50) {
      safeExtra[key] = value.filter((v) => typeof v === 'string' || typeof v === 'number');
    }
  }
  console.error(`[${context}]`, {
    code: error?.code,
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
    status: error?.status ?? error?.statusCode,
    ...safeExtra,
  });
}
