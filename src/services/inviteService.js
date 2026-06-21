import { supabase } from './supabase';

export async function inviteUserByEmail({ email, role_id, full_name, phone, job_title, department }) {
  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: { email, role_id, full_name, phone, job_title, department },
  });

  if (error) {
    console.error('[invite-user]', error.detail || error);
    throw new Error(error.message || 'Failed to send invitation. Please try again.');
  }

  return data;
}

export async function deleteUser(userId) {
  const { data, error } = await supabase.functions.invoke('delete-user', {
    body: { user_id: userId },
  });

  if (error) {
    console.error('[delete-user]', error.detail || error);
    throw new Error(error.message || 'Failed to delete user. Please try again.');
  }

  return data;
}
