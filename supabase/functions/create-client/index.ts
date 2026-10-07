import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

const CLIENT_ROLE_ID = "f3e7c0d7-d41f-486f-89fd-732d1c9cc200";

const EMAIL_EXISTS_MESSAGE = 'An account already exists with this email address.';
const USERNAME_TAKEN_MESSAGE = 'This username is already taken. Please choose another username.';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://hrtncnmmykzckemykesu.supabase.co/auth/v1/callback",
  "https://cantiere-cyb.pages.dev",
];

function getOriginHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function respond(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getOriginHeaders(origin), 'Content-Type': 'application/json' },
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

serve(async (req: { headers: { get: (arg0: string) => string; }; method: string; json: () => any; }) => {
  const origin = req.headers.get('origin') || '';

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getOriginHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return respond({ error: 'Method not allowed' }, 405, origin);
  }

  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return respond({ error: 'Invalid request body.', detail: 'Failed to parse JSON' }, 400, origin);
    }

    const { email, password, full_name, phone } = body;

    if (!email) {
      return respond({ error: 'Email address is required.' }, 400, origin);
    }

    if (!EMAIL_REGEX.test(String(email).trim())) {
      return respond({ error: 'Please enter a valid email address.', detail: 'Invalid email format' }, 400, origin);
    }

    if (!password) {
      return respond({ error: 'Password is required.' }, 400, origin);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return respond({ error: 'Authentication required' }, 400, origin);
    }

    const token = authHeader.replace('Bearer ', '');

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return respond({ error: 'Session expired. Please log in again.', detail: userError?.message }, 400, origin);
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role_id, roles!inner(name)')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return respond({ error: 'Your profile was not found.' }, 400, origin);
    }

    if (!['super_admin', 'admin'].includes(profile.roles.name)) {
      return respond(
        { error: 'You do not have permission to create clients.', detail: `User role '${profile.roles.name}' is not allowed.` },
        400,
        origin
      );
    }

    // Case-insensitive duplicate pre-check. Never adopt an existing Auth user:
    // a duplicate email is rejected with 409 and the exact required message.
    const cleanEmail = String(email).trim();
    const { data: availability, error: availabilityError } = await supabaseAdmin.rpc('account_identity_available', {
      p_email: cleanEmail,
      p_username: null,
      p_exclude_id: null,
    });
    if (availabilityError) {
      console.error('[create-client] identity availability check failed:', availabilityError.message);
    }
    if (availability && availability.email_available === false) {
      return respond({ error: EMAIL_EXISTS_MESSAGE, detail: 'duplicate_email' }, 409, origin);
    }
    if (availability && availability.username_available === false) {
      return respond({ error: USERNAME_TAKEN_MESSAGE, detail: 'duplicate_username' }, 409, origin);
    }

    const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: full_name || '',
        phone: phone || '',
        role_id: CLIENT_ROLE_ID,
      },
    });

    if (createError) {
      const message = String(createError.message || '');
      const lower = message.toLowerCase();
      const looksDuplicate =
        lower.includes('already registered') ||
        lower.includes('already exists') ||
        lower.includes('user_already_exists') ||
        lower.includes('duplicate') ||
        lower.includes('23505');
      if (looksDuplicate) {
        return respond({ error: EMAIL_EXISTS_MESSAGE, detail: 'duplicate_email' }, 409, origin);
      }
      return respond({ error: 'Failed to create user.', detail: createError.message }, 400, origin);
    }

    if (createData?.user) {
      await audit(user.id, {
        p_action_type: 'CLIENT_CREATE',
        p_message: 'Client account created',
        p_entity_type: 'profile',
        p_entity_id: createData.user.id,
        p_details: {
          email: email,
          profile_id: createData.user.id,
          role_id: CLIENT_ROLE_ID,
          role: 'client',
        },
        p_new_values: { role_id: CLIENT_ROLE_ID, email },
      });
    }

    return respond({ user: createData.user }, 200, origin);
  } catch (err) {
    console.error('Unexpected error in create-client', err);
    return respond({ error: 'Something went wrong. Please try again.', detail: err?.message }, 400, origin);
  }
});
