-- =============================================================
-- Migration: Enable RLS on projects table + add SELECT policy
-- - Admins see all (via existing is_admin() helper)
-- - Regular users see only projects they are assigned to
--   (via project_members join)
-- - Also fixes project_members FK to reference profiles(id)
--   so team_member_id matches auth.uid()
-- =============================================================

ALTER TABLE IF EXISTS public.project_members
  DROP CONSTRAINT IF EXISTS project_members_team_member_id_fkey;

ALTER TABLE public.project_members
  ADD CONSTRAINT project_members_team_member_id_fkey
  FOREIGN KEY (team_member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read all projects"
  ON public.projects FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Users can read assigned projects"
  ON public.projects FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members
      WHERE project_members.project_id = projects.id
        AND project_members.profile_id = auth.uid()
    )
  );
