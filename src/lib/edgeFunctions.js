import { supabase } from '@/services/supabase';
import { classifyEdgeError, withRetryHint } from '@/lib/edgeFunctionErrors';

/**
 * Edge Functions answer errors as JSON (`{ error }`) on the response body.
 * supabase-js only exposes the message "Edge function returned a non-2xx
 * status code", so the body is read from the attached Response
 * (see @supabase/functions-js: `error.context.json()`).
 *
 * Upstream provider failures arrive as
 * `{ name: 'APIError', data: { message, isRetryable, responseBody } }`
 * (503 overload / 504 idle timeout). Those are transient upstream problems
 * and are reported with `retryable: true` instead of being collapsed into a
 * generic "something went wrong" — the caller stays stable and can offer a
 * retry. Parsing/classification lives in `@/lib/edgeFunctionErrors` so it is
 * unit tested.
 */

/**
 * Invokes an Edge Function and always resolves with
 * `{ ok, data, message, retryable, status }` so callers never have to catch.
 * Pass the translate function as `t` to append a localized "temporary
 * problem, retry" hint to retryable upstream failures.
 */
export async function invokeEdgeFunction(
  name,
  body = {},
  fallbackMessage = 'Request failed.',
  t,
) {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
      const context = error?.context;
      const contextStatus = typeof context?.status === 'number' ? context.status : null;

      let payload = null;
      try {
        if (context && typeof context.json === 'function') payload = await context.json();
      } catch {
        // The body may not be JSON: fall through to the generic message.
        payload = null;
      }

      const classified = classifyEdgeError({
        payload,
        rawMessage: error?.message,
        contextStatus,
      });
      const message =
        classified.message === 'Request failed.' && fallbackMessage
          ? fallbackMessage
          : classified.message;

      return {
        ok: false,
        data: null,
        message: withRetryHint(message, classified.retryable, t),
        retryable: classified.retryable,
        status: classified.status,
      };
    }
    return { ok: true, data, message: null, retryable: false, status: 200 };
  } catch (err) {
    const classified = classifyEdgeError({ rawMessage: err?.message });
    const message =
      classified.message === 'Request failed.' && fallbackMessage
        ? fallbackMessage
        : classified.message;
    return {
      ok: false,
      data: null,
      message: withRetryHint(message, classified.retryable, t),
      retryable: classified.retryable,
      status: classified.status,
    };
  }
}
