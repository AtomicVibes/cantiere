import { supabase } from './supabase';

export async function fetchProjectAssignments(profileId) {
  const { data, error } = await supabase
    .from('project_members')
    .select('project_id')
    .eq('profile_id', profileId);

  if (error) throw error;
  return (data ?? []).map(row => row.project_id);
}

export async function fetchAllProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name')
    .order('name');

  if (error) throw error;
  return data ?? [];
}

export async function syncProjectAssignments(profileId, projectIds) {
  const { data: existing } = await supabase
    .from('project_members')
    .select('project_id')
    .eq('profile_id', profileId);

  const existingIds = (existing ?? []).map(row => row.project_id);

  const toInsert = projectIds.filter(id => !existingIds.includes(id));
  const toRemove = existingIds.filter(id => !projectIds.includes(id));

  if (toRemove.length > 0) {
    const { error: delErr } = await supabase
      .from('project_members')
      .delete()
      .eq('profile_id', profileId)
      .in('project_id', toRemove);
    if (delErr) throw delErr;
  }

  if (toInsert.length > 0) {
    const { error: insErr } = await supabase
      .from('project_members')
      .insert(toInsert.map(projectId => ({
        project_id: projectId,
        profile_id: profileId,
        team_member_id: profileId,
      })));
    if (insErr) throw insErr;
  }
}
