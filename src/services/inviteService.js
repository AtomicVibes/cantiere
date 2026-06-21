import { supabase } from './supabase';

const INVITE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`;
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
    let detail = null;
    try { detail = await res.json(); } catch {}
    console.error(`[${url.split('/').pop()}]`, detail?.detail || detail);
    throw new Error(detail?.message || 'Something went wrong. Please try again.');
  }

  return res.json();
}

export async function inviteUserByEmail({ email, role_id, full_name, phone, job_title, department }) {
  return callFunction(INVITE_URL, { email, role_id, full_name, phone, job_title, department });
}

export async function deleteUser(userId) {
  return callFunction(DELETE_URL, { user_id: userId });
}
