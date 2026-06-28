-- =============================================================
-- Migration: Audit profile role changes
-- Logs ROLE_UPDATE when a profile's role_id changes via DB trigger
-- Note: the frontend promote mutation also calls logAudit() for
-- immediate logging; this trigger catches direct SQL changes too.
-- =============================================================

CREATE OR REPLACE FUNCTION public.log_profile_role_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_old_role TEXT;
  v_new_role TEXT;
BEGIN
  IF OLD.role_id IS DISTINCT FROM NEW.role_id THEN
    SELECT name INTO v_old_role FROM public.roles WHERE id = OLD.role_id;
    SELECT name INTO v_new_role FROM public.roles WHERE id = NEW.role_id;

    INSERT INTO public.audit_logs (action, table_name, record_id, changed_by, details)
    VALUES (
      'ROLE_UPDATE',
      'profiles',
      NEW.id,
      auth.uid(),
      jsonb_build_object(
        'from_role', v_old_role,
        'to_role', v_new_role,
        'profile_id', NEW.id
      )
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_profile_role ON public.profiles;
CREATE TRIGGER trg_audit_profile_role
  AFTER UPDATE OF role_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.log_profile_role_changes();
