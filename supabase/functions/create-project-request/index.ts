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

    if (!['client', 'super_admin', 'admin'].includes(profile.roles.name)) {
      return respond({ error: 'Only clients and admins can submit project requests.' }, 400);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return respond({ error: 'Invalid request body.' }, 400);
    }

    const {
      project_name,
      description,
      category,
      address,
      budget,
      estimated_deadline,
      document_url,
      client_id,
    } = body;

    if (!project_name?.trim()) {
      return respond({ error: 'Project name is required.' }, 400);
    }

    let resolvedClientId = client_id || null;

    if (profile.roles.name === 'client') {
      const { data: clientRecord, error: clientError } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('profile_id', user.id)
        .single();

      if (clientError || !clientRecord) {
        return respond({ error: 'Client record not found.' }, 400);
      }

      resolvedClientId = clientRecord.id;
    }

    const { data: newRequest, error: insertError } = await supabaseAdmin
      .from('project_requests')
      .insert({
        client_id: resolvedClientId,
        project_name: project_name.trim(),
        description: description?.trim() || null,
        category: category || null,
        address: address?.trim() || null,
        budget: budget != null ? Number(budget) : null,
        estimated_deadline: estimated_deadline || null,
        document_url: document_url || null,
        status: 'pending',
      })
      .select()
      .single();

    if (insertError) {
      console.error('Failed to create project request:', insertError);
      return respond({ error: 'Failed to submit request.' }, 400);
    }

    return respond({ request: newRequest }, 200);
  } catch (err) {
    console.error('Unexpected error in create-project-request', err);
    return respond({ error: 'Something went wrong. Please try again.' }, 400);
  }
});
