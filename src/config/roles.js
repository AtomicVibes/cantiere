let initialized = false;

export const ROLES = {
  SUPER_ADMIN: null,
  TEAM_MEMBER: null,
  ADMIN: null,
  MANAGER: null,
  CLIENT: null,
};

export async function initRoles(supabaseClient) {
  if (initialized) return;
  const { data } = await supabaseClient.from('roles').select('id, name');
  if (!data) return;
  for (const r of data) {
    switch (r.name) {
      case 'super_admin':   ROLES.SUPER_ADMIN = r.id; break;
      case 'admin':         ROLES.ADMIN = r.id; break;
      case 'manager':       ROLES.MANAGER = r.id; break;
      case 'client':        ROLES.CLIENT = r.id; break;
    }
  }
  ROLES.TEAM_MEMBER = ROLES.MANAGER || ROLES.ADMIN;
  initialized = true;
}

export function isAdmin(userRoleId) {
  if (!userRoleId || !ROLES.SUPER_ADMIN) return false;
  return userRoleId === ROLES.SUPER_ADMIN;
}
