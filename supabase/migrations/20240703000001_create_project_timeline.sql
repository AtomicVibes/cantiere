-- =============================================================
-- Migration: Create project_timeline table with RLS
-- - FK to projects with CASCADE delete
-- - RLS: admins full access, clients read-only on own projects
-- =============================================================

-- 1. Create project_timeline table (if not exists)
CREATE TABLE IF NOT EXISTS public.project_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  date DATE,
  status TEXT DEFAULT 'pending',
  responsible_person_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_timeline_project_id ON public.project_timeline(project_id);
CREATE INDEX IF NOT EXISTS idx_project_timeline_created_at ON public.project_timeline(created_at);

-- 3. Enable RLS
ALTER TABLE public.project_timeline ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies
CREATE POLICY "Admins can read all timeline entries"
  ON public.project_timeline FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Team can insert timeline entries"
  ON public.project_timeline FOR INSERT
  WITH CHECK (
    public.is_admin() OR
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
      WHERE p.id = auth.uid() AND r.name = 'manager'
    )
  );

CREATE POLICY "Admins can update timeline entries"
  ON public.project_timeline FOR UPDATE
  USING (public.is_admin());

CREATE POLICY "Admins can delete timeline entries"
  ON public.project_timeline FOR DELETE
  USING (public.is_admin());

-- Clients can read timeline entries for projects they are linked to
-- via the clients table (project_requests.client_id -> clients.id -> profile_id)
CREATE POLICY "Clients can read timeline for own projects"
  ON public.project_timeline FOR SELECT
  USING (
    project_id IN (
      SELECT pr.project_id FROM public.project_requests pr
      JOIN public.clients c ON c.id = pr.client_id
      WHERE c.profile_id = auth.uid()
    )
  );

-- 5. Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_project_timeline_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_project_timeline_updated_at ON public.project_timeline;
CREATE TRIGGER update_project_timeline_updated_at
  BEFORE UPDATE ON public.project_timeline
  FOR EACH ROW
  EXECUTE FUNCTION public.update_project_timeline_updated_at();
