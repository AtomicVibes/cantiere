import { supabase } from '@/services/supabase';

export const logAudit = async ({
  action_type,
  message,
  details = {},
  document_name,
  entity_type,
  entity_id,
  project_id,
  old_values,
  new_values,
  ip_address,
  user_agent,
}) => {
  try {
    const { error } = await supabase.rpc('write_audit_log', {
      p_action_type: action_type,
      p_message: message || null,
      p_details: details,
      p_document_name: document_name || null,
      p_entity_type: entity_type || null,
      p_entity_id: entity_id || null,
      p_project_id: project_id || null,
      p_old_values: old_values || null,
      p_new_values: new_values || null,
      p_ip_address: ip_address || null,
      p_user_agent: user_agent || null,
    });

    if (error) {
      console.warn('[logAudit] write_audit_log RPC failed:', error.message, { action_type, entity_type, entity_id });
    }
  } catch (err) {
    console.warn('[logAudit] unexpected error:', err);
  }
};
