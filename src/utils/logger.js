export const logAction = async (supabase, { actionType, message, docName = null, details = {} }) => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.warn('Logger: no authenticated user, skipping log');
      return;
    }

    const { error: insertError } = await supabase
      .from('audit_logs')
      .insert({
        user_id: user.id,
        action_type: actionType,
        action_message: message,
        document_name: docName,
        details,
      });

    if (insertError) {
      console.warn('Logger: insert failed', insertError.message);
    }
  } catch (err) {
    console.warn('Logger: unexpected error', err);
  }
};
