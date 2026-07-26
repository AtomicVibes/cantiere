-- =============================================================
-- Migration: Allow assigned project members to read timeline entries
--
-- Problem:
--   The project_timeline table only has an admin-level SELECT policy
--   ("Admins can read all timeline entries"). Regular users who are
--   assigned to a project (via project_members) cannot view the
--   project timeline, even though they can see the project itself
--   via the "Users can read assigned projects" policy.
--
-- Solution:
--   Add a SELECT policy that allows any user who is a member of
--   the project (exists in project_members with matching project_id
--   and their own profile_id) to read timeline entries for that
--   project.
--
--   Uses a direct subquery on project_members (no SECURITY DEFINER
--   needed because project_members RLS already allows members to
--   read their own assignments via "Members can read their own
--   assignments" USING (profile_id = auth.uid())).
-- =============================================================

DROP POLICY IF EXISTS "Project members can read timeline entries" ON public.project_timeline;

CREATE POLICY "Project members can read timeline entries"
  ON public.project_timeline FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_timeline.project_id
        AND pm.profile_id = auth.uid()
    )
  );
