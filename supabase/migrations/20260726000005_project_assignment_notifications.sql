-- =============================================================
-- Migration: Project assignment notifications + fix INSERT RLS
--
-- Problem:
--   1. Notifications table has SELECT and UPDATE policies but
--      NO INSERT policy — client-side inserts (MessagesPage,
--      etc.) are silently blocked by RLS.
--   2. No database trigger creates a notification when a
--      project manager or team member is assigned.
--   3. The SECURITY DEFINER functions is_admin() and
--      is_super_admin() exist but may not be referenced by
--      all notification-related code paths.
--
-- Solution:
--   1. Add INSERT policy on notifications (any authenticated
--      user can create a notification for any user_id).
--   2. Trigger on project_members INSERT → creates
--      'team_assignment' notification for the assigned user.
--   3. Trigger on projects INSERT/UPDATE of manager_id →
--      creates 'project_assignment' notification for the PM.
-- =============================================================

-- 1. INSERT policy for notifications (missing from earlier migration)
CREATE POLICY "Users can create notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (true);

-- 2. Trigger: team member assigned to a project
CREATE OR REPLACE FUNCTION public.handle_team_member_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_project_name text;
BEGIN
  SELECT name INTO v_project_name FROM public.projects WHERE id = NEW.project_id;

  INSERT INTO public.notifications (user_id, type, message, url, is_read)
  VALUES (
    NEW.team_member_id,
    'team_assignment',
    'You have been assigned to project: ' || coalesce(v_project_name, 'Unknown'),
    '/projects/' || NEW.project_id,
    false
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_member_assigned ON public.project_members;
CREATE TRIGGER trg_team_member_assigned
  AFTER INSERT ON public.project_members
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_team_member_assigned();

-- 3. Trigger: project manager assigned
CREATE OR REPLACE FUNCTION public.handle_project_manager_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.manager_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.manager_id IS DISTINCT FROM NEW.manager_id) THEN
    INSERT INTO public.notifications (user_id, type, message, url, is_read)
    VALUES (
      NEW.manager_id,
      'project_assignment',
      'You have been assigned as project manager for: ' || coalesce(NEW.name, 'Unknown'),
      '/projects/' || NEW.id,
      false
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_manager_assigned ON public.projects;
CREATE TRIGGER trg_project_manager_assigned
  AFTER INSERT OR UPDATE OF manager_id ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_project_manager_assigned();
