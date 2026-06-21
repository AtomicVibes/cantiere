import { supabase } from './supabase';

const INVITE_USER_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`;
const INVITE_CLIENT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-client`;
const DELETE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user`;

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
    console.error(`[${url.split('/').pop()}] ${res.status}`, { payload, response: detail });
    throw new Error(detail?.error || `Request failed (${res.status})`);
  }

  return res.json();
}

export async function inviteUserByEmail({ email, role_id, full_name, phone, job_title, department, mode }) {
  return callFunction(INVITE_USER_URL, { email, role_id, full_name, phone, job_title, department, mode });
}

export async function inviteClientByEmail({ email, full_name, phone, mode }) {
  return callFunction(INVITE_CLIENT_URL, { email, full_name, phone, mode });
}

export async function deleteUser(userId) {
  return callFunction(DELETE_URL, { user_id: userId });
}
