import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY")!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

const CLIENT_ROLE_ID = "f3e7c0d7-d41f-486f-89fd-732d1c9cc200";

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
    let body;
    try {
      body = await req.json();
    } catch {
      return respond({ error: 'Invalid request body.', detail: 'Failed to parse JSON' }, 400);
    }
    console.log('invite-client body:', JSON.stringify(body));

    const { email, full_name, phone } = body;

    if (!email) {
      return respond({ error: 'Email address is required.', detail: 'Missing email field' }, 400);
    }

    const userMetadata = {
      full_name: full_name || '',
      phone: phone || '',
      role_id: CLIENT_ROLE_ID,
    };

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return respond({ error: 'Authentication required', detail: 'Missing or invalid Authorization header' }, 400);
    }

    const token = authHeader.replace('Bearer ', '');

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      console.error('JWT validation failed', userError?.message);
      return respond({ error: 'Session expired. Please log in again.', detail: userError?.message || 'Invalid token' }, 400);
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role_id, roles!inner(name)')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return respond({ error: 'Your profile was not found.', detail: profileError?.message }, 400);
    }

    if (!['super_admin', 'admin'].includes(profile.roles.name)) {
      return respond(
        { error: 'You do not have permission to invite clients.', detail: `User role '${profile.roles.name}' is not allowed. Required: super_admin or admin.` },
        400
      );
    }

    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers().catch(() => ({ data: null }));
    const existing = usersData?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) {
      return respond({ error: 'This email has already been invited or registered.', detail: `Email ${email} already exists in auth.users` }, 400);
    }

    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        data: userMetadata,
        redirectTo: `${supabaseUrl}/auth/v1/callback`,
      }
    );

    if (inviteError) {
      console.error('DEBUG - Admin API Error:', JSON.stringify(inviteError, null, 2));
      return respond({ error: 'Invitation failed', detail: inviteError.message }, 400);
    }

    return respond({ user: inviteData.user });
  } catch (err) {
    console.error('Unexpected invite error', err);
    return respond({ error: 'Something went wrong. Please try again.', detail: err?.message || 'Unknown error' }, 400);
  }
});
