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

// Exact copy required by the account-creation spec (409 bodies).
const EMAIL_EXISTS_MESSAGE = 'An account already exists with this email address.';
const USERNAME_TAKEN_MESSAGE = 'This username is already taken. Please choose another username.';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-z0-9_.-]{3,30}$/;

// The application's canonical "User" role. EditMemberDialog labels
// roles.name = 'manager' as "User"; the other names are tolerated so a
// differently-seeded database still resolves to a non-privileged default.
const DEFAULT_ROLE_PREFERENCE = ['manager', 'user', 'member'];
// Never assignable through this endpoint: elevation stays exclusive to the
// existing Edit Member flow (profiles update guarded by RLS + rank rules).
const ELEVATED_ROLES = ['super_admin', 'admin'];

function respond(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

async function roleName(roleId) {
  if (!roleId) return null;
  const { data } = await supabaseAdmin.from('roles').select('name').eq('id', roleId).maybeSingle();
  return data?.name ?? null;
}

async function listRoles() {
  const { data, error } = await supabaseAdmin.from('roles').select('id, name');
  if (error) {
    console.error('[invite-user] roles lookup failed:', error.message);
    return [];
  }
  return data ?? [];
}

// Canonical default role for every new member created here.
async function resolveDefaultUserRoleId() {
  const roles = await listRoles();
  for (const name of DEFAULT_ROLE_PREFERENCE) {
    const hit = roles.find((r) => String(r.name || '').toLowerCase() === name);
    if (hit) return hit.id;
  }
  return null;
}

// A client-supplied role id is honored only when it exists AND is not
// elevated; anything missing/malformed/elevated falls back to the default
// User role. Add Member never sends a role at all.
async function resolveRoleId(requestedRoleId) {
  if (!requestedRoleId) return resolveDefaultUserRoleId();
  const roles = await listRoles();
  const requested = roles.find((r) => r.id === requestedRoleId);
  if (!requested || ELEVATED_ROLES.includes(String(requested.name || ''))) {
    return resolveDefaultUserRoleId();
  }
  return requested.id;
}

// Case-insensitive availability probe (RPC from 20261017120000).
// Fails OPEN: the unique indexes + auth error mapping remain authoritative,
// so a missing migration degrades the message but never the guarantee.
async function identityAvailability(email, username) {
  const { data, error } = await supabaseAdmin.rpc('account_identity_available', {
    p_email: email ?? null,
    p_username: username ?? null,
    p_exclude_id: null,
  });
  if (error) {
    console.error('[invite-user] identity availability check failed:', error.message);
    return { email_available: true, username_available: true };
  }
  return data ?? { email_available: true, username_available: true };
}

function isDuplicateAuthError(message) {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('already registered') ||
    m.includes('already exists') ||
    m.includes('already been registered') ||
    m.includes('user_already_exists') ||
    m.includes('duplicate key') ||
    m.includes('duplicate') ||
    m.includes('23505')
  );
}

// After a failed create, re-check which identity collided so the 409 carries
// the exact required message (GoTrue usually hides the underlying reason).
async function duplicateResponse(email, username, fallbackMessage) {
  const availability = await identityAvailability(email, username);
  if (availability.email_available === false) {
    return respond({ error: EMAIL_EXISTS_MESSAGE, detail: 'duplicate_email' }, 409);
  }
  if (availability.username_available === false) {
    return respond({ error: USERNAME_TAKEN_MESSAGE, detail: 'duplicate_username' }, 409);
  }
  return fallbackMessage ? respond(fallbackMessage, 409) : null;
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
    // Never log the body: it can contain a password.
    console.log('invite-user fields:', Object.keys(body ?? {}).join(','));

    const { email, username, password, role_id, full_name, phone, job_title, department, mode } = body;

    if (!email) {
      return respond({ error: 'Email address is required.', detail: 'Missing email field' }, 400);
    }

    if (!EMAIL_REGEX.test(String(email).trim())) {
      return respond({ error: 'Please enter a valid email address.', detail: 'Invalid email format' }, 400);
    }

    const cleanUsername = typeof username === 'string' && username.trim() ? username.trim() : null;
    if (cleanUsername && !USERNAME_REGEX.test(cleanUsername.toLowerCase())) {
      return respond({ error: 'Username must be 3-30 characters using only a-z, 0-9, ".", "_" or "-".', detail: 'Invalid username format' }, 400);
    }

    const isDirect = mode !== 'invite';
    if (isDirect && !password) {
      return respond({ error: 'Password is required to create the account.', detail: 'Missing password field' }, 400);
    }

    // Server-side uniqueness pre-check (case-insensitive).
    const availability = await identityAvailability(email, cleanUsername);
    if (availability.email_available === false) {
      return respond({ error: EMAIL_EXISTS_MESSAGE, detail: 'duplicate_email' }, 409);
    }
    if (availability.username_available === false) {
      return respond({ error: USERNAME_TAKEN_MESSAGE, detail: 'duplicate_username' }, 409);
    }

    const roleId = await resolveRoleId(role_id);
    if (!roleId) {
      return respond({ error: 'Unable to resolve the default User role.', detail: 'No matching role row found' }, 500);
    }
    const resolvedRoleName = await roleName(roleId);

    const userMetadata = {
      full_name: full_name || '',
      phone: phone || '',
      job_title: job_title || '',
      department: department || '',
      role_id: roleId,
      ...(cleanUsername ? { username: cleanUsername } : {}),
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

    if (isDirect) {
      const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: String(email).trim(),
        password,
        email_confirm: true,
        user_metadata: userMetadata,
      });

      if (createError) {
        console.error('DEBUG - Admin API Error:', createError.status ?? '', createError.message ?? '');
        const duplicate = await duplicateResponse(String(email).trim(), cleanUsername, isDuplicateAuthError(createError.message)
          ? { error: EMAIL_EXISTS_MESSAGE, detail: 'duplicate_email' }
          : null);
        if (duplicate) return duplicate;
        return respond({ error: 'Failed to create user.', detail: createError.message }, 400);
      }

      if (createData?.user) {
        await audit(user.id, {
          p_action_type: 'MEMBER_ADD',
          p_message: 'Team member added',
          p_entity_type: 'profile',
          p_entity_id: createData.user.id,
          p_details: {
            profile_id: createData.user.id,
            email: email,
            username: cleanUsername,
            role_id: roleId,
            role: resolvedRoleName,
          },
          p_new_values: { role_id: roleId, email, username: cleanUsername },
        });
      }

      return respond({ user: createData.user });
    }

    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      String(email).trim(),
      {
        data: userMetadata,
        redirectTo: `${supabaseUrl}/auth/v1/callback`,
      }
    );

    if (inviteError) {
      console.error('DEBUG - Admin API Error:', inviteError.status ?? '', inviteError.message ?? '');
      const duplicate = await duplicateResponse(String(email).trim(), cleanUsername, isDuplicateAuthError(inviteError.message)
        ? { error: EMAIL_EXISTS_MESSAGE, detail: 'duplicate_email' }
        : null);
      if (duplicate) return duplicate;
      return respond({ error: 'Invitation failed', detail: inviteError.message }, 400);
    }

    if (inviteData?.user) {
      await audit(user.id, {
        p_action_type: 'MEMBER_ADD',
        p_message: 'Team member invited',
        p_entity_type: 'profile',
        p_entity_id: inviteData.user.id,
        p_details: {
          profile_id: inviteData.user.id,
          email: email,
          username: cleanUsername,
          role_id: roleId,
          role: resolvedRoleName,
        },
        p_new_values: { role_id: roleId, email, username: cleanUsername },
      });
    }

    return respond({ user: inviteData.user });
  } catch (err) {
    console.error('Unexpected invite error', err);
    return respond({ error: 'Something went wrong. Please try again.', detail: err?.message || 'Unknown error' }, 400);
  }
});
