import { supabase } from './supabase';
import { normalizeEmail, normalizeUsername } from '@/lib/validation';

// Exact user-facing copy required by the account-creation spec. These strings
// are intentionally NOT translated: they must match byte-for-byte everywhere
// (frontend pre-checks, edge function 409 bodies, DB trigger messages).
export const EMAIL_EXISTS_MESSAGE = 'An account already exists with this email address.';
export const USERNAME_TAKEN_MESSAGE = 'This username is already taken. Please choose another username.';

// Availability probe backed by the SECURITY DEFINER RPC
// account_identity_available(p_email, p_username, p_exclude_id).
// Comparisons are case-insensitive on the server side.
export async function checkAccountIdentity({ email, username, excludeId = null } = {}) {
  const { data, error } = await supabase.rpc('account_identity_available', {
    p_email: email ? normalizeEmail(email) : null,
    p_username: username ? normalizeUsername(username) : null,
    p_exclude_id: excludeId,
  });
  if (error) throw error;
  return {
    emailAvailable: data?.email_available !== false,
    usernameAvailable: data?.username_available !== false,
  };
}

// True for unique-constraint violations and duplicate rejections coming from
// Postgres (23505), Supabase Auth (user_already_exists) or our edge functions (409).
export function isDuplicateError(err) {
  const code = String(err?.code ?? err?.status ?? err?.statusCode ?? '');
  const message = String(err?.message ?? err ?? '').toLowerCase();
  return (
    code === '23505' ||
    code === '409' ||
    message.includes('already exists') ||
    message.includes('already registered') ||
    message.includes('already been registered') ||
    message.includes('already taken') ||
    message.includes('duplicate key') ||
    message.includes('duplicate') ||
    message.includes('user_already_exists')
  );
}

// Best-effort classification of a duplicate error so the UI can show the
// right one of the two exact messages.
export function duplicateErrorField(err) {
  const message = String(err?.message ?? err ?? '').toLowerCase();
  if (message.includes('username')) return 'username';
  if (message.includes('email') || message.includes('user_already_exists') || message.includes('registered')) return 'email';
  return 'email';
}

export function duplicateErrorMessage(err) {
  return duplicateErrorField(err) === 'username' ? USERNAME_TAKEN_MESSAGE : EMAIL_EXISTS_MESSAGE;
}
