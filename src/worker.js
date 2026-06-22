export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
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
