import { supabase } from './supabase';

const INVITE_USER_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`;
const DELETE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user`;
const CREATE_CLIENT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-client`;

async function callFunction(url, payload) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    let detail;
    try { detail = JSON.parse(text); } catch { detail = text; }
    // Never log secrets: drop the password before tracing the failure.
    const { password: _password, ...safePayload } = payload ?? {};
    console.error(`[${url.split('/').pop()}] ${res.status}`, { payload: safePayload, response: detail });
    throw new Error(detail?.message || detail?.error || `Request failed (${res.status})`);
  }

  return res.json();
}

export async function inviteUserByEmail({ email, username, password, full_name, phone, job_title, department, mode, role_id = null }) {
  return callFunction(INVITE_USER_URL, { email, username, password, role_id, full_name, phone, job_title, department, mode });
}

export async function createClient({ email, password, full_name, phone }) {
  return callFunction(CREATE_CLIENT_URL, { email, password, full_name, phone });
}

export async function deleteUser(userId) {
  if (!userId) throw new Error('userId is required');
  return callFunction(DELETE_URL, { user_id: userId });
}
