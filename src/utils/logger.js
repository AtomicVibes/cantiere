import { supabase } from '@/services/supabase';

export const logAudit = async ({ action, table_name, record_id, details = {} }) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('audit_logs')
      .insert({
        action,
        table_name: table_name || null,
        record_id: record_id || null,
        changed_by: user.id,
        details,
      });

    if (error) {
      console.warn('audit log insert failed:', error.message);
    }
  } catch (err) {
    console.warn('audit log error:', err);
  }
};
