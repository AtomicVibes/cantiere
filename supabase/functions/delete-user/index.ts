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

function error(message, detail, status = 400) {
  console.error(`[delete-user] ${status}`, { message, detail });
  return respond({ message, detail }, status);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return respond({ message: 'Method not allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return error('Authentication required', 'Missing or invalid Authorization header');
    }

    const token = authHeader.replace('Bearer ', '');

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
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
        'You do not have permission to delete users.',
        `User role '${profile.roles.name}' is not allowed. Required: super_admin or admin.`
      );
    }

    const { user_id } = await req.json();

    if (!user_id) {
      return error('User ID is required.', 'Missing user_id field');
    }

    if (user_id === user.id) {
      return error('You cannot delete your own account.', 'Self-deletion blocked');
    }

    const { error: deleteProfileError } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', user_id);

    if (deleteProfileError) {
      console.error('Profile deletion failed', {
        code: deleteProfileError.code,
        message: deleteProfileError.message,
        details: deleteProfileError.details,
      });

      return error(
        'Unable to delete user. Please try again or contact support.',
        deleteProfileError.message
      );
    }

    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(user_id);

    if (deleteAuthError) {
      console.error('Auth deletion failed', deleteAuthError);
      return error('User profile was removed but auth cleanup failed. Contact support.', deleteAuthError.message);
    }

    return respond({ success: true });
  } catch (err) {
    console.error('Unexpected delete error', err);
    return error('Something went wrong. Please try again.', err?.message || 'Unknown error');
  }
});
