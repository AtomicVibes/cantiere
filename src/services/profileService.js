import { supabase } from './supabase';

export async function getProfileLanguage(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('preferred_language')
    .eq('id', userId)
    .single();

  if (error && error.code === 'PGRST116') return null;
  if (error) throw error;

  return data?.preferred_language ?? null;
}

export async function upsertProfile(userId, profileData) {
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, ...profileData }, { onConflict: 'id' });

  if (error) throw error;
}
