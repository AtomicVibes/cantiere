-- Fix log_client_deletion trigger function
-- The old fallback used '00000000-0000-0000-0000-000000000000' when auth.uid() was NULL,
-- which caused a FK violation on audit_logs_user_id_fkey (references profiles(id)).
-- This happens when a profile is deleted and cascades to delete related clients.
-- Now it simply passes NULL, which satisfies the ON DELETE SET NULL constraint.

CREATE OR REPLACE FUNCTION public.log_client_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_user_id UUID := auth.uid();
BEGIN
  INSERT INTO public.audit_logs (user_id, action_type, message, details)
  VALUES (
    current_user_id,
    'DELETE',
    'Client deleted: ' || OLD.company_name,
    jsonb_build_object('client_id', OLD.id, 'company_name', OLD.company_name)
  );
  RETURN OLD;
END;
$$;
