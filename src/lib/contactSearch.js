// Pure contact-search helpers (dependency-free so they are unit-testable).
// The profiles query itself lives in src/hooks/useProfileContactSearch.js.

export const CONTACT_SEARCH_LIMIT = 30;
export const CONTACT_SEARCH_MIN_LENGTH = 1;
export const CONTACT_SEARCH_DEBOUNCE_MS = 300;

export const CONTACT_SEARCH_FIELDS = ['full_name', 'email', 'job_title', 'department', 'role'];

export const CONTACT_SELECT_FIELDS =
  'id, full_name, email, avatar_url, job_title, department, role, status, roles(name)';

// Escapes PostgREST ILIKE wildcards so user input is matched literally.
export function escapeIlikePattern(raw) {
  return String(raw ?? '').replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

// Builds the PostgREST `.or()` filter for a raw search string.
// Returns null when there is nothing searchable (callers must not query).
export function buildContactSearchOrFilter(raw) {
  const q = String(raw ?? '').trim();
  if (!q) return null;
  const pattern = `%${escapeIlikePattern(q)}%`;
  return CONTACT_SEARCH_FIELDS.map((f) => `${f}.ilike.${pattern}`).join(',');
}

// Primary display name: full_name, falling back to email (user data is
// never translated).
export function getContactDisplayName(profile) {
  const name = String(profile?.full_name ?? '').trim();
  if (name) return name;
  const email = String(profile?.email ?? '').trim();
  return email || 'Unknown';
}

// Restricts a profiles row to messaging UI fields (no phone numbers,
// no notification settings, no role ids, no security internals).
// Role label prefers the human-readable `role` text column, falling back
// to the joined roles table entry when present.
export function normalizeContactProfile(row) {
  if (!row) return null;
  const joined = Array.isArray(row.roles)
    ? row.roles.find((r) => r?.name)?.name
    : row.roles?.name;
  return {
    id: row.id,
    full_name: row.full_name || '',
    email: row.email || '',
    avatar_url: row.avatar_url || '',
    job_title: row.job_title || '',
    department: row.department || '',
    role: row.role || joined || '',
    status: row.status || 'active',
  };
}
