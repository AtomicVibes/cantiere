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

    const { request_id, action, rejection_reason } = body;

    if (!request_id) {
      return respond({ error: 'Request ID is required.' }, 400);
    }

    if (!['verify', 'approve', 'reject'].includes(action)) {
      return respond({ error: 'Action must be "verify", "approve", or "reject".' }, 400);
    }

    const { data: existingRequest, error: fetchError } = await supabaseAdmin
      .from('project_requests')
      .select('*')
      .eq('id', request_id)
      .single();

    if (fetchError || !existingRequest) {
      return respond({ error: 'Request not found.' }, 400);
    }

    if (action === 'verify') {
      if (existingRequest.status !== 'pending') {
        return respond({ error: `Cannot verify a request with status "${existingRequest.status}".` }, 400);
      }

      const { error: updateError } = await supabaseAdmin
        .from('project_requests')
        .update({ status: 'verification' })
        .eq('id', request_id);

      if (updateError) {
        console.error('Failed to verify request:', updateError);
        return respond({ error: 'Failed to verify request.' }, 400);
      }

      return respond({ request: { ...existingRequest, status: 'verification' } }, 200);
    }

    if (action === 'reject') {
      if (existingRequest.status !== 'pending' && existingRequest.status !== 'verification') {
        return respond({ error: `Cannot reject a request with status "${existingRequest.status}".` }, 400);
      }

      const { error: updateError } = await supabaseAdmin
        .from('project_requests')
        .update({
          status: 'rejected',
          rejection_reason: rejection_reason?.trim() || null,
        })
        .eq('id', request_id);

      if (updateError) {
        console.error('Failed to reject request:', updateError);
        return respond({ error: 'Failed to reject request.' }, 400);
      }

      return respond({ request: { ...existingRequest, status: 'rejected', rejection_reason } }, 200);
    }

    if (action === 'approve') {
      if (existingRequest.status !== 'verification') {
        return respond({ error: 'Request must be in verification status to approve.' }, 400);
      }

      const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
        'validate_project_request',
        { p_request_id: request_id }
      );

      if (rpcError) {
        console.error('Failed to approve request via RPC:', rpcError);
        return respond({ error: 'Failed to approve request.', detail: rpcError.message }, 400);
      }

      if (!rpcResult?.success) {
        return respond({ error: rpcResult?.error || 'Failed to validate request.' }, 400);
      }

      return respond({
        request: { ...existingRequest, status: 'validated' },
        project_id: rpcResult.project_id,
      }, 200);
    }

    return respond({ error: 'Unknown action.' }, 400);
  } catch (err) {
    console.error('Unexpected error in review-project-request', err);
    return respond({ error: 'Something went wrong. Please try again.' }, 400);
  }
});
