const ASSET_EXT = /\.(js|css|png|jpg|jpeg|gif|ico|svg|webp|avif|woff2?|ttf|eot|otf|pdf|txt|xml|json|map)$/i;
const ASSET_PATHS = new Set([
  '/favicon.ico',
  '/favicon.svg',
  '/robots.txt',
  '/sitemap.xml',
  '/_headers',
  '/_redirects'
]);

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const { pathname } = url;

  // ── Early-exit for static assets (bypass all auth logic) ──
  if (ASSET_PATHS.has(pathname) || ASSET_EXT.test(pathname)) {
    console.log(JSON.stringify({
      level: 'debug',
      event: 'asset_request',
      path: pathname,
      method: request.method,
      message: `Serving static asset directly — bypassing middleware`
    }));
    return context.env.ASSETS.fetch(request);
  }

  // ── Auth callback requests ──
  if (pathname.startsWith('/auth/')) {
    console.log(JSON.stringify({
      level: 'info',
      event: 'auth_route',
      path: pathname,
      method: request.method,
      message: `Auth route hit — passing through`
    }));
    return next();
  }

  // ── Process request and catch 500s ──
  try {
    const response = await next();

    if (response.status >= 500) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'server_error',
        path: pathname,
        status: response.status,
        message: `Server error for ${pathname}`
      }));
    }

    return response;
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'unhandled_error',
      path: pathname,
      error: err.message,
      stack: err.stack,
      message: `Unhandled exception caught in middleware for ${pathname}: ${err.message}`
    }));

    return new Response('Internal Server Error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}
