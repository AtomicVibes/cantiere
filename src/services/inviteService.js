import { supabase } from './supabase';

const INVITE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`;
const DELETE_USER_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user`;

export async function inviteUserByEmail({ email, role_id, full_name, phone, job_title, department }) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !session) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(INVITE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ email, role_id, full_name, phone, job_title, department }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Invite failed (${response.status})`);
  }

  return response.json();
}

export async function deleteUser(userId) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !session) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(DELETE_USER_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ user_id: userId }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Delete failed (${response.status})`);
  }

  return response.json();
}
