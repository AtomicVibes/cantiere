// Agent activity tracking (sessions + heartbeat + action telemetry).
// Encapsulated module: all state lives here, no UI, no layout impact.
// Every write is fire-and-forget and RLS-scoped to the signed-in user,
// so tracking can never block primary render loops or leak across users.
import { supabase } from '@/services/supabase';

export const HEARTBEAT_INTERVAL_MS = 30_000;
const SESSION_STORAGE_KEY = 'geometra-agent-session-id';

let sessionId = null;
let heartbeatTimer = null;
let trackedUserId = null;

function safeSessionId() {
  return sessionId;
}

export function getActiveSessionId() {
  return safeSessionId();
}

export async function startSession(userId) {
  if (!userId) return null;
  if (trackedUserId === userId && sessionId) return sessionId;
  await endSession(true);
  trackedUserId = userId;
  try {
    const { data, error } = await supabase
      .from('agent_sessions')
      .insert({
        user_id: userId,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : null,
      })
      .select('id')
      .single();
    if (error) throw error;
    sessionId = data?.id || null;
    try {
      if (typeof localStorage !== 'undefined' && sessionId) {
        localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      }
    } catch {
      // Storage unavailable: session simply won't survive reloads.
    }
  } catch (err) {
    console.error('[Activity] startSession failed', err?.message || err);
    sessionId = null;
  }
  return sessionId;
}

export async function endSession(silent = false) {
  stopHeartbeat();
  const closingId = sessionId;
  const closingUser = trackedUserId;
  sessionId = null;
  trackedUserId = null;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors on teardown.
  }
  if (!closingId) return;
  try {
    const { error } = await supabase
      .from('agent_sessions')
      .update({ logout_at: new Date().toISOString(), is_active: false })
      .eq('id', closingId);
    if (error) throw error;
  } catch (err) {
    if (!silent) console.error('[Activity] endSession failed', err?.message || err);
  }
  void closingUser;
}

function sendHeartbeat() {
  if (!sessionId) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  supabase
    .from('agent_sessions')
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq('id', sessionId)
    .then(({ error }) => {
      if (error) console.error('[Activity] heartbeat failed', error.message);
    });
}

export function startHeartbeat() {
  stopHeartbeat();
  if (typeof window === 'undefined') return () => {};
  heartbeatTimer = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  const onVisibility = () => {
    if (document.visibilityState === 'visible') sendHeartbeat();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const onUnload = () => {
    endSession(true);
  };
  window.addEventListener('beforeunload', onUnload);
  return () => {
    stopHeartbeat();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('beforeunload', onUnload);
  };
}

export function stopHeartbeat() {
  if (heartbeatTimer !== null && typeof window !== 'undefined') {
    window.clearInterval(heartbeatTimer);
  }
  heartbeatTimer = null;
}

// Fire-and-forget action telemetry. Never throws, never blocks callers.
// Fire-and-forget action telemetry. Never throws, never blocks callers.
//
// @typedef {Object} TelemetryMetadata
// @property {string} [file_name]
// @property {string} [file_type]
// @property {number} [file_size_bytes]
// @property {string} [visibility]
// @property {string} [section_name]
// @property {string} [sub_tab]
// @property {string} [url]
// @property {string} [project_id]
// @property {string} [budget]
// @property {string} [vendor]
// @property {number} [total]
// @property {string} [client_name]
//
// Only JSON-safe primitives survive sanitization (max 25 keys, strings
// capped at 500 chars) so metadata always conforms to the jsonb column.
const MAX_METADATA_KEYS = 25;
const MAX_STRING_LENGTH = 500;

export function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (Object.keys(clean).length >= MAX_METADATA_KEYS) break;
    if (typeof key !== 'string' || key.length === 0) continue;
    if (typeof value === 'string') clean[key] = value.slice(0, MAX_STRING_LENGTH);
    else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === 'boolean') clean[key] = value;
    else if (value === null) clean[key] = null;
  }
  return clean;
}

export function logAction(action, options = {}) {
  if (!action || !trackedUserId) return;
  const payload = {
    session_id: sessionId,
    user_id: trackedUserId,
    action: String(action).slice(0, 120),
    entity_type: options.entityType ? String(options.entityType).slice(0, 60) : null,
    entity_id: options.entityId || null,
    metadata: sanitizeMetadata(options.metadata),
  };
  supabase
    .from('agent_action_logs')
    .insert(payload)
    .then(({ error }) => {
      if (error) console.error('[Activity] logAction failed', error.message);
    });
}
