export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      if (pathname === '/auth/callback') {
        return handleAuthCallback(request, url, env);
      }

      if (pathname.startsWith('/api/')) {
        return handleApi(request, url, env);
      }

      return serveStaticOrSpa(request, url, env);
    } catch (err) {
      return handleError(err, pathname);
    }
  },
};

async function serveStaticOrSpa(request, url, env) {
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404) {
    return response;
  }

  return env.ASSETS.fetch(new Request(`${url.origin}/index.html`, request));
}

async function handleAuthCallback(request, url, env) {
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const supabaseKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

  const code = url.searchParams.get('code');
  if (!code) {
    return Response.redirect(new URL('/login?error=missing_code', url.origin), 302);
  }

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials');
  }

  const tokenRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=authorization_code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: supabaseKey },
    body: JSON.stringify({ code, redirect_to: url.origin + '/auth/callback' }),
  });

  if (!tokenRes.ok) {
    throw new Error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }

  const tokens = await tokenRes.json();
  const next = url.searchParams.get('next') || '/';
  const response = Response.redirect(new URL(next, url.origin), 302);

  response.headers.append(
    'Set-Cookie',
    `sb-access-token=${tokens.access_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${tokens.expires_in || 3600}`
  );
  if (tokens.refresh_token) {
    response.headers.append(
      'Set-Cookie',
      `sb-refresh-token=${tokens.refresh_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${tokens.expires_in || 3600}`
    );
  }

  return response;
}

async function handleApi(request, url, env) {
  return new Response(JSON.stringify({ error: 'Not implemented' }), {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
  });
}

function handleError(err, pathname) {
  console.error(JSON.stringify({
    level: 'error', event: 'unhandled_error',
    path: pathname, error: err.message,
  }));

  if (pathname === '/favicon.ico' || pathname === '/favicon.svg') {
    return new Response(null, { status: 204 });
  }

  return new Response('Internal Server Error', { status: 500 });
}
