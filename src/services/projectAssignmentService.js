import { supabase } from './supabase';
import { toast } from 'sonner';

export async function handleAssignProject(userId, projectId, userRole, queryClient) {
  if (userRole !== 'super_admin') {
    toast.error('Access Denied: Only Super Admins can assign projects.');
    return;
  }

  try {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('job_title')
      .eq('id', userId)
      .single();

    if (profileError) throw profileError;

    if (!profile?.job_title) {
      toast.error('Please assign a Job Title to this user before adding them to a project.');
      return;
    }

    const { error: insertError } = await supabase
      .from('project_members')
      .insert([{
        project_id: projectId,
        team_member_id: userId,
        profile_id: userId,
      }]);

    if (insertError) throw insertError;

    toast.success('Project assigned successfully!');
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['project-members'] });
  } catch (err) {
    toast.error(err.message);
  }
}
