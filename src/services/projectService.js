import { supabase } from '@/services/supabase';

export const projectService = {
  async getProjects() {
    const { data, error } = await supabase
      .from('projects')
      .select('*');

    if (error) {
      throw error;
    }

    return data ?? [];
  },

  async createProject(payload) {
    const { data, error } = await supabase
      .from('projects')
      .insert([payload])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }
};
