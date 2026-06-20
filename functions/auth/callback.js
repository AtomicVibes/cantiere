export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const code = url.searchParams.get('code');
  const nextParam = url.searchParams.get('next') || '/';

  if (!code) {
    return Response.redirect(new URL('/login?error=missing_code', url.origin), 302);
  }

  try {
    const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
    const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing Supabase credentials in environment');
    }

    const tokenResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=authorization_code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
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
      level: 'info',
      event: 'auth_callback_success',
      user: tokens.user?.id || tokens.user?.email || 'unknown',
      message: 'OAuth code exchanged for session successfully'
    }));

    const response = Response.redirect(new URL(nextParam, url.origin), 302);

    const cookieOptions = [
      `sb-access-token=${tokens.access_token}`,
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
      `Max-Age=${tokens.expires_in || 3600}`,
    ];

    if (tokens.refresh_token) {
      cookieOptions.push(`sb-refresh-token=${tokens.refresh_token}`);
    }

    response.headers.set('Set-Cookie', cookieOptions.join('; '));

    return response;
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'auth_callback_error',
      error: err.message,
      stack: err.stack,
      message: `Auth callback failed: ${err.message}`
    }));

    return Response.redirect(new URL('/login?error=auth_failed', url.origin), 302);
  }
}
