import { supabase } from '@/services/supabase';

export const logAudit = async ({ action_type, message, details = {} }) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const logData = {
      user_id: user.id,
      action_type,
      message: message || null,
      details,
    };

    const { error } = await supabase
      .from('audit_logs')
      .insert([logData]);

    if (error) {
      console.warn('audit log insert failed:', error.message, 'payload:', logData);
    }
  } catch (err) {
    console.warn('audit log error:', err);
  }
};
