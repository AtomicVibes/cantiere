import { FunctionsHttpError } from '@supabase/supabase-js';

function extractError(err) {
  if (err instanceof FunctionsHttpError) {
    const ctx = err.context;
    console.error(`[${err.name}]`, ctx?.detail || ctx);
    return ctx?.message || 'Something went wrong. Please try again.';
  }
  console.error('[FunctionError]', err);
  return err.message || 'Something went wrong. Please try again.';
}

export async function inviteUserByEmail({ email, role_id, full_name, phone, job_title, department }) {
  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: { email, role_id, full_name, phone, job_title, department },
  });

  if (error) throw new Error(extractError(error));

  return data;
}

export async function deleteUser(userId) {
  const { data, error } = await supabase.functions.invoke('delete-user', {
    body: { user_id: userId },
  });

  if (error) throw new Error(extractError(error));

  return data;
}
