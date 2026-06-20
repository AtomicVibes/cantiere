const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';

const ASSET_EXT = /\.(js|css|png|jpg|jpeg|gif|ico|svg|webp|avif|woff2?|ttf|eot|otf|pdf|txt|xml|json|map)$/i;
const ASSET_PATHS = new Set([
  '/favicon.ico', '/favicon.svg', '/robots.txt', '/sitemap.xml',
  '/_headers', '/_redirects',
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || SUPABASE_URL;
    const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;

    try {
      if (pathname === '/auth/callback') {
        return handleAuthCallback(request, url, supabaseUrl, supabaseAnonKey);
      }

      if (pathname.startsWith('/api/')) {
        return proxyApi(request, url, env);
      }

      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) {
        return asset;
      }

      return env.ASSETS.fetch(new Request(`${url.origin}/index.html`, request));
    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'unhandled_error',
        path: pathname,
        error: err.message,
        stack: err?.stack,
      }));

      if (pathname === '/favicon.ico' || pathname === '/favicon.svg') {
        return new Response(null, { status: 204 });
      }

      return new Response('Internal Server Error', { status: 500 });
    }
  },
};

async function handleAuthCallback(request, url, supabaseUrl, supabaseAnonKey) {
  const code = url.searchParams.get('code');
  const nextParam = url.searchParams.get('next') || '/';

  if (!code) {
    return Response.redirect(new URL('/login?error=missing_code', url.origin), 302);
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase credentials in environment');
  }

  const tokenResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=authorization_code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify({
      code,
      redirect_to: url.origin + '/auth/callback',
    }),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorBody}`);
  }

  const tokens = await tokenResponse.json();

  console.log(JSON.stringify({
    level: 'info', event: 'auth_callback_success',
    user: tokens.user?.id || tokens.user?.email || 'unknown',
  }));

  const response = Response.redirect(new URL(nextParam, url.origin), 302);

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

async function proxyApi(request, url, env) {
  console.log(JSON.stringify({
    level: 'debug', event: 'api_proxy',
    path: url.pathname, method: request.method,
  }));
  return new Response(JSON.stringify({ error: 'Not implemented' }), {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
  });
}
