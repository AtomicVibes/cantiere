import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function respond(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return respond({ error: 'Method not allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return respond({ error: 'Authentication required' }, 400);
    }

    const token = authHeader.replace('Bearer ', '');

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return respond({ error: 'Session expired. Please log in again.', detail: userError?.message }, 400);
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role_id, roles!inner(name)')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return respond({ error: 'Your profile was not found.' }, 400);
    }

    if (!['super_admin', 'admin'].includes(profile.roles.name)) {
      return respond(
        { error: 'You do not have permission to review requests.', detail: `Role '${profile.roles.name}' is not allowed.` },
        400
      );
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return respond({ error: 'Invalid request body.' }, 400);
    }

    const { request_id, action } = body;

    if (!request_id) {
      return respond({ error: 'Request ID is required.' }, 400);
    }

    if (!['approved', 'rejected'].includes(action)) {
      return respond({ error: 'Action must be "approved" or "rejected".' }, 400);
    }

    const { data: existingRequest, error: fetchError } = await supabaseAdmin
      .from('project_requests')
      .select('*')
      .eq('id', request_id)
      .single();

    if (fetchError || !existingRequest) {
      return respond({ error: 'Request not found.' }, 400);
    }

    if (existingRequest.status !== 'pending') {
      return respond({ error: `This request has already been ${existingRequest.status}.` }, 400);
    }

    if (action === 'rejected') {
      const { error: updateError } = await supabaseAdmin
        .from('project_requests')
        .update({ status: 'rejected' })
        .eq('id', request_id);

      if (updateError) {
        console.error('Failed to reject request:', updateError);
        return respond({ error: 'Failed to reject request.' }, 400);
      }

      return respond({ request: { ...existingRequest, status: 'rejected' } }, 200);
    }

    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .insert({
        name: existingRequest.project_name,
        client_id: existingRequest.client_id,
        status: 'draft',
      })
      .select()
      .single();

    if (projectError) {
      console.error('Failed to create project from request:', projectError);
      return respond({ error: 'Failed to create project. Please try again.' }, 400);
    }

    const { error: updateError } = await supabaseAdmin
      .from('project_requests')
      .update({ status: 'approved' })
      .eq('id', request_id);

    if (updateError) {
      console.error('Failed to update request status:', updateError);
      return respond({ error: 'Project created but status update failed.', detail: updateError.message }, 400);
    }

    return respond({ request: { ...existingRequest, status: 'approved' }, project }, 200);
  } catch (err) {
    console.error('Unexpected error in review-project-request', err);
    return respond({ error: 'Something went wrong. Please try again.' }, 400);
  }
});
