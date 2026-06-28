-- =============================================================
-- Migration: Audit Logging System
-- - Creates audit_logs table (if not exists, adds missing cols)
-- - RLS: super_admin only for SELECT; authenticated users for INSERT
-- - DB triggers on projects and project_timeline tables
-- =============================================================

-- 1. Create the audit_logs table (no-op if already exists)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1b. Add columns if the table existed without them (schema convergence)
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS action TEXT;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS table_name TEXT;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS record_id UUID;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}';
ALTER TABLE public.audit_logs ALTER COLUMN created_at SET DEFAULT NOW();

-- 2. Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 3. RLS policies
-- Only super_admin can SELECT (view) audit logs
CREATE POLICY "Super admin can view audit logs"
  ON public.audit_logs FOR SELECT
  USING (public.is_super_admin());

-- Only super_admin can DELETE (purge) audit logs
CREATE POLICY "Super admin can delete audit logs"
  ON public.audit_logs FOR DELETE
  USING (public.is_super_admin());

-- Authenticated users can INSERT (triggers and frontend both need this)
CREATE POLICY "Authenticated users can insert audit logs"
  ON public.audit_logs FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- 4. Trigger function — log project changes
CREATE OR REPLACE FUNCTION public.log_project_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_action TEXT;
  v_details JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'PROJECT_CREATE';
    v_details := jsonb_build_object('name', NEW.name, 'budget', NEW.budget, 'status', NEW.status);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'PROJECT_UPDATE';
    v_details := jsonb_build_object('name', NEW.name, 'budget', NEW.budget, 'status', NEW.status);
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'PROJECT_DELETE';
    v_details := jsonb_build_object('name', OLD.name);
  END IF;

  INSERT INTO public.audit_logs (action, table_name, record_id, changed_by, details)
  VALUES (v_action, 'projects', COALESCE(NEW.id, OLD.id), auth.uid(), v_details);
  RETURN NULL;
END;
$$;

-- 5. Trigger function — log timeline changes
CREATE OR REPLACE FUNCTION public.log_timeline_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_action TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'TIMELINE_CREATE';
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'TIMELINE_UPDATE';
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'TIMELINE_DELETE';
  END IF;

  INSERT INTO public.audit_logs (action, table_name, record_id, changed_by, details)
  VALUES (v_action, 'project_timeline', COALESCE(NEW.id, OLD.id), auth.uid(),
    jsonb_build_object('title', COALESCE(NEW.title, OLD.title), 'project_id', COALESCE(NEW.project_id, OLD.project_id)));
  RETURN NULL;
END;
$$;

-- 6. Attach triggers (drop first to avoid duplicates on re-run)
DROP TRIGGER IF EXISTS trg_audit_projects ON public.projects;
CREATE TRIGGER trg_audit_projects
  AFTER INSERT OR UPDATE OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.log_project_changes();

DROP TRIGGER IF EXISTS trg_audit_timeline ON public.project_timeline;
CREATE TRIGGER trg_audit_timeline
  AFTER INSERT OR UPDATE OR DELETE ON public.project_timeline
  FOR EACH ROW EXECUTE FUNCTION public.log_timeline_changes();
