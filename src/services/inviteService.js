import { supabase } from './supabase';

export async function inviteUserByEmail({ email, role_id, full_name, phone, job_title, department }) {
  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: { email, role_id, full_name, phone, job_title, department },
  });

  if (error) {
    throw new Error(error.message || error.error || 'Invite failed');
  }

  return data;
}

export async function deleteUser(userId) {
  const { data, error } = await supabase.functions.invoke('delete-user', {
    body: { user_id: userId },
  });

  if (error) {
    throw new Error(error.message || error.error || 'Delete failed');
  }

  return data;
}
