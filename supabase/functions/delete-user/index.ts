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

// Accounts that may never delete anyone, whatever their role. Taken from the
// verified JWT (never from the request body); override with the
// DELETE_BLOCKED_EMAILS env var (comma-separated).
const DEFAULT_DELETE_BLOCKED_EMAILS = ['amministrazionegeombelluscio@gmail.com'];
const deleteBlockedEmails = (() => {
  const fromEnv = Deno.env.get('DELETE_BLOCKED_EMAILS');
  if (!fromEnv) return DEFAULT_DELETE_BLOCKED_EMAILS;
  const parsed = fromEnv.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return parsed.length ? parsed : DEFAULT_DELETE_BLOCKED_EMAILS;
})();

// Same rank table the UI uses (EditMemberDialog.ROLE_RANK); roles not listed
// (project_manager, secretary) and missing roles rank 0.
const ROLE_RANK: Record<string, number> = { super_admin: 4, admin: 3, manager: 2, client: 1 };

function roleRank(name?: string | null) {
  return name ? ROLE_RANK[name] ?? 0 : 0;
}

function respond(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function error(message, detail, status = 400, extra = {}) {
  console.error(`[delete-user] ${status}`, { message, detail, ...extra });
  return respond({ message, detail, ...extra }, status);
}

async function audit(actor, payload) {
  const { error } = await supabaseAdmin.rpc('write_audit_log', {
    p_actor: actor,
    ...payload,
  });
  if (error) {
    console.error('[audit] write_audit_log failed:', error.message, payload);
  }
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

    // Hard-blocked accounts are refused before any lookup or deletion.
    // Denial is logged with the user id only - never the email.
    const callerEmail = (user.email ?? '').trim().toLowerCase();
    if (deleteBlockedEmails.includes(callerEmail)) {
      console.error('[delete-user] delete request denied for blocked account', { user_id: user.id });
      return error('Forbidden', 'This account is not allowed to delete users.', 403);
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

    const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, role_id, roles(name)')
      .eq('id', user_id)
      .maybeSingle();

    if (targetProfileError) {
      return error('Failed to load target user profile', targetProfileError.message);
    }

    if (!targetProfile) {
      return respond({ success: true, note: 'User was already removed or never existed.' });
    }

    // PostgREST answers a to-one embed as an object, but the generated types
    // can infer an array: accept both shapes before making the decision.
    const targetRoleName = Array.isArray(targetProfile.roles)
      ? targetProfile.roles[0]?.name
      : targetProfile.roles?.name;

    // A super_admin is never deletable, whatever the caller's role.
    if (targetRoleName === 'super_admin') {
      return error('You do not have permission to delete users.', 'This account cannot be removed.', 403);
    }

    // Rank check: equal or higher rank than the caller can never be deleted.
    if (roleRank(targetRoleName) >= roleRank(profile.roles?.name)) {
      return error('You do not have permission to delete users.', 'Target user has equal or higher privileges.', 403);
    }

    const { error: deleteProfileError } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', user_id);

    if (deleteProfileError) {
      return error(
        'Profile deletion failed',
        deleteProfileError.message,
        400,
        { code: deleteProfileError.code, details: deleteProfileError.details, hint: deleteProfileError.hint }
      );
    }

    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(user_id);

    if (deleteAuthError) {
      return error(
        'Auth deletion failed',
        deleteAuthError.message,
        400,
        { code: deleteAuthError.code, details: deleteAuthError.details, hint: deleteAuthError.hint }
      );
    }

    await audit(user.id, {
      p_action_type: 'MEMBER_REMOVE',
      p_message: 'User removed from workspace',
      p_entity_type: 'profile',
      p_entity_id: user_id,
      p_details: {
        profile_id: user_id,
        email: targetProfile.email,
        full_name: targetProfile.full_name,
        role_id: targetProfile.role_id,
      },
      p_old_values: {
        email: targetProfile.email,
        full_name: targetProfile.full_name,
        role_id: targetProfile.role_id,
      },
    });

    return respond({ success: true });
  } catch (err) {
    console.error('Unexpected delete error', err);
    return error('Something went wrong. Please try again.', err?.message || 'Unknown error');
  }
});
