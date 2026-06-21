import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY")!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function error(message, detail) {
  return new Response(JSON.stringify({ message, detail }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return error('Authentication required', 'Missing or invalid Authorization header');
    }

    const token = authHeader.replace('Bearer ', '');

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      console.error('JWT validation failed', userError?.message);
      return error('Session expired. Please log in again.', userError?.message || 'Invalid token');
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role_id, roles!inner(name)')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return error('Your profile was not found.', profileError?.message);
    }

    if (!['super_admin', 'admin'].includes(profile.roles.name)) {
      return error(
        'You do not have permission to invite users.',
        `User role '${profile.roles.name}' is not allowed. Required: super_admin or admin.`
      );
    }

    const { email, role_id, full_name, phone, job_title, department } = await req.json();

    if (!email) {
      return error('Email address is required.', 'Missing email field');
    }

    if (!role_id) {
      return error('Please select a role for the new user.', 'Missing role_id field');
    }

    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        data: { role_id, full_name, phone, job_title, department },
        redirectTo: `${supabaseUrl}/auth/v1/callback`,
      }
    );

    if (inviteError) {
      console.error('inviteUserByEmail failed', inviteError);
      if (inviteError.message?.includes('already')) {
        return error('This email is already registered.', inviteError.message);
      }
      return error('Failed to send invitation. Please try again.', inviteError.message);
    }

    return new Response(JSON.stringify({ user: inviteData.user }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Unexpected invite error', err);
    return error('Something went wrong. Please try again.', err?.message || 'Unknown error');
  }
});
