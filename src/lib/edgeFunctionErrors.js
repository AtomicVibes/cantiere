// Pure helpers for Edge Function error bodies.
//
// Kept free of any supabase/browser import so the behaviour can be exercised
// with `node --test src/lib/edgeFunctionErrors.test.js`.
//
// Two shapes are handled:
//   { error: "…" }                                   <- our Edge Functions
//   { name: "APIError", data: { message, isRetryable, responseBody } }
//                                                     <- upstream providers
// The second one is a transient upstream failure (503 overload / 504 idle
// timeout): it must surface as retryable, never as a data/database problem.

// Statuses that mean "try again", not "your data is broken".
export const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export const RETRYABLE_MESSAGE_RE =
  /temporar(?:y|ily)\s+(?:un)?available|temporarily overloaded|overloaded|idle timeout|timed?\s?out|timeout|service unavailable|try again later|too many requests|rate limit|bad gateway|gateway timeout|connection reset|connection refused|econnreset|socket hang up|unavailable|network\s?error|failed to fetch|fetch resource|could not connect|unreachable|getaddrinfo|dns lookup/i;

const MAX_MESSAGE_CHARS = 400;

// Never echo something token shaped back into the UI (or a log line).
export function sanitizeEdgeMessage(text) {
  if (typeof text !== 'string' || !text) return '';
  return text
    .replace(
      /(access_token|refresh_token|client_secret|secret|password|bearer|api[_-]?key|authorization)\s*[:=]\s*\S+/gi,
      '$1=[redacted]',
    )
    .replace(/\b[A-Za-z0-9._-]{40,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
}

export function parseInnerBody(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Best-effort HTTP status from the response, the payload or the inner body. */
export function edgeStatusFrom(payload, contextStatus = null) {
  const candidates = [
    payload?.status,
    payload?.statusCode,
    payload?.code,
    parseInnerBody(payload?.data?.responseBody)?.code,
    parseInnerBody(payload?.responseBody)?.code,
    contextStatus,
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed >= 100 && parsed <= 599) return parsed;
  }
  return null;
}

/** Extracts the human readable message from every shape we may receive. */
export function edgeMessageFrom(payload, rawMessage = '') {
  let fromPayload = '';
  if (payload && typeof payload === 'object') {
    if (typeof payload.error === 'string') {
      fromPayload = payload.error;
    } else if (payload.error && typeof payload.error === 'object') {
      if (typeof payload.error.message === 'string') fromPayload = payload.error.message;
      else if (typeof payload.error.error_description === 'string') {
        fromPayload = payload.error.error_description;
      }
    } else if (typeof payload.message === 'string') {
      fromPayload = payload.message;
    } else if (payload.data && typeof payload.data === 'object') {
      if (typeof payload.data.message === 'string') fromPayload = payload.data.message;
      else if (typeof payload.data.error === 'string') fromPayload = payload.data.error;
    } else if (typeof payload.details === 'string') {
      fromPayload = payload.details;
    }
  }
  return sanitizeEdgeMessage(fromPayload) || sanitizeEdgeMessage(rawMessage) || '';
}

export function isRetryableEdgeError(payload, status, message) {
  if (payload?.data?.isRetryable === true || payload?.isRetryable === true) return true;
  if (typeof status === 'number' && RETRYABLE_STATUS.has(status)) return true;
  return RETRYABLE_MESSAGE_RE.test(String(message || ''));
}

/**
 * One entry point used by invokeEdgeFunction(): returns the display message
 * plus the flags the UI needs to offer a retry.
 */
export function classifyEdgeError({ payload = null, rawMessage = '', contextStatus = null } = {}) {
  const message = edgeMessageFrom(payload, rawMessage) || 'Request failed.';
  const status = edgeStatusFrom(payload, contextStatus);
  return {
    message,
    status,
    retryable: isRetryableEdgeError(payload, status, message),
  };
}

/** Appends a localized hint to a retryable failure (no-op when not retryable). */
export function withRetryHint(message, retryable, t) {
  if (!retryable || typeof t !== 'function') return message;
  const hint = t('errors.retryableUpstream');
  if (!hint || hint === 'errors.retryableUpstream') return message;
  return `${message} — ${hint}`;
}
