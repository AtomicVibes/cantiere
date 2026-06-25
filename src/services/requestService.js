import { supabase } from './supabase';

const CREATE_REQUEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-project-request`;
const REVIEW_REQUEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/review-project-request`;

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

export async function createProjectRequest({ project_name, description }) {
  return callFunction(CREATE_REQUEST_URL, { project_name, description });
}

export async function reviewProjectRequest({ request_id, action }) {
  return callFunction(REVIEW_REQUEST_URL, { request_id, action });
}

export async function getClientRequests() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const { data: profile } = await supabase
    .from('profiles')
    .select('roles!inner(name)')
    .eq('id', session.user.id)
    .single();

  const isAdmin = ['super_admin', 'admin'].includes(profile?.roles?.name);

  let query = supabase
    .from('project_requests')
    .select('*, client:client_id(company_name)')
    .order('created_at', { ascending: false });

  if (!isAdmin) {
    const { data: clientRecord } = await supabase
      .from('clients')
      .select('id')
      .eq('profile_id', session.user.id)
      .single();

    if (!clientRecord) return [];
    query = query.eq('client_id', clientRecord.id);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
