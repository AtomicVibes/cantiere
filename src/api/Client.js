import { appParams } from '@/lib/app-params';

// Lightweight local stub to replace @base44/sdk for local development.
// Provides `auth` helpers and a permissive `entities` proxy with
// create/update/delete/list/find methods returning resolved Promises.
export const base44 = {
  auth: {
    me: async () => {
      // Default to unauthenticated for local dev. Consumers handle errors.
      throw { status: 401, message: 'Not authenticated (local stub)' };
    },
    logout: (redirect) => {
      if (redirect) window.location.href = redirect;
    },
    redirectToLogin: (returnUrl) => {
      const url = `/login${returnUrl ? `?returnTo=${encodeURIComponent(returnUrl)}` : ''}`;
      window.location.href = url;
    }
  },
  // Entities: return an object with CRUD helpers for any entity name
  entities: new Proxy({}, {
    get: () => ({
      create: async (data) => Promise.resolve(data || {}),
      update: async (id, data) => Promise.resolve({ id, ...data }),
      delete: async (id) => Promise.resolve({ id }),
      list: async (opts) => Promise.resolve([]),
      find: async (id) => Promise.resolve(null),
    })
  }),
  // Generic request helper that forwards to `fetch` if needed
  request: async (path, opts) => {
    const res = await fetch(path, opts);
    if (!res.ok) throw { status: res.status, data: await res.json().catch(() => ({})) };
    return res.json().catch(() => ({}));
  }
};
