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
    let body;
    try {
      body = await req.json();
    } catch {
      return respond({ error: 'Invalid request body.', detail: 'Failed to parse JSON' }, 400);
    }
    console.log('invite-user body:', JSON.stringify(body));

    const { email, role_id, full_name, phone, job_title, department, mode } = body;

    if (!email) {
      return respond({ error: 'Email address is required.', detail: 'Missing email field' }, 400);
    }

    if (!role_id) {
      return respond({ error: 'Please select a role for the new user.', detail: 'Missing role_id field' }, 400);
    }

    const userMetadata = {
      full_name: full_name || '',
      phone: phone || '',
      job_title: job_title || '',
      department: department || '',
      role_id,
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
        { error: 'You do not have permission to invite users.', detail: `User role '${profile.roles.name}' is not allowed. Required: super_admin or admin.` },
        400
      );
    }

    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers().catch(() => ({ data: null }));
    const existing = usersData?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) {
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        existing.id,
        { user_metadata: userMetadata }
      );
      if (updateError) {
        return respond({ error: 'Failed to update existing user.', detail: updateError.message }, 400);
      }

      const { error: upsertError } = await supabaseAdmin
        .from('profiles')
        .upsert({
          id: existing.id,
          email: existing.email,
          role_id,
          full_name: full_name || existing.user_metadata?.full_name || '',
          phone: phone || existing.user_metadata?.phone || '',
          job_title: job_title || existing.user_metadata?.job_title || '',
          department: department || existing.user_metadata?.department || '',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

      if (upsertError) {
        return respond({ error: 'Failed to update profile.', detail: upsertError.message }, 400);
      }

      return respond({ user: existing });
    }

    const isDirect = mode !== 'invite';

    if (isDirect) {
      const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: userMetadata,
      });

      if (createError) {
        console.error('DEBUG - Admin API Error:', JSON.stringify(createError, null, 2));
        return respond({ error: 'Failed to create user.', detail: createError.message }, 400);
      }

      return respond({ user: createData.user });
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
