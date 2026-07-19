-- =============================================================
-- Migration: Create project_members join table
-- - Many-to-many relationship between projects and team_members
-- - RLS: admins full access, members read-only on own assignments
-- =============================================================

CREATE TABLE IF NOT EXISTS public.project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_member_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, team_member_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON public.project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_team_member_id ON public.project_members(team_member_id);

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read all project member assignments"
  ON public.project_members FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Members can read their own assignments"
  ON public.project_members FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Admins can assign members to projects"
  ON public.project_members FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can remove members from projects"
  ON public.project_members FOR DELETE
  USING (public.is_admin());
