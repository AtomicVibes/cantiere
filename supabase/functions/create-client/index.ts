import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

const CLIENT_ROLE_ID = "f3e7c0d7-d41f-486f-89fd-732d1c9cc200";

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

    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers().catch(() => ({ data: null }));
    const existing = usersData?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) {
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        existing.id,
        { user_metadata: { full_name: full_name || '', phone: phone || '', role_id: CLIENT_ROLE_ID } }
      );
      if (updateError) {
        return respond({ error: 'Failed to update existing user.', detail: updateError.message }, 400, origin);
      }

      const { error: upsertError } = await supabaseAdmin
        .from('profiles')
        .upsert({
          id: existing.id,
          email: existing.email,
          full_name: full_name || existing.user_metadata?.full_name || '',
          phone: phone || existing.user_metadata?.phone || '',
          role_id: CLIENT_ROLE_ID,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

      if (upsertError) {
        return respond({ error: 'Failed to update profile.', detail: upsertError.message }, 400, origin);
      }

      return respond({ user: existing }, 200, origin);
    }

    const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: full_name || '',
        phone: phone || '',
        role_id: CLIENT_ROLE_ID,
      },
    });

    if (createError) {
      return respond({ error: 'Failed to create user.', detail: createError.message }, 400, origin);
    }

    return respond({ user: createData.user }, 200, origin);
  } catch (err) {
    console.error('Unexpected error in create-client', err);
    return respond({ error: 'Something went wrong. Please try again.', detail: err?.message }, 400, origin);
  }
});
