-- =============================================================
-- Migration: Auto-create clients record on signup + DELETE RLS
-- - Ensures handle_new_user inserts into clients for 'client' role
-- - Backfills profiles that have role='client' but no clients row
-- - Adds DELETE policy on project_requests for super_admin
-- =============================================================

-- 1. Re-create handle_new_user (idempotent) — inserts into profiles
--    AND clients when the role is 'client'
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_role_id UUID;
  v_default_role_id UUID;
  v_role_name TEXT;
BEGIN
  v_role_id := (NEW.raw_user_meta_data ->> 'role_id')::UUID;

  IF v_role_id IS NULL THEN
    SELECT id INTO v_default_role_id FROM public.roles WHERE name = 'client' LIMIT 1;
    v_role_id := v_default_role_id;
  END IF;

  SELECT r.name INTO v_role_name FROM public.roles r WHERE r.id = v_role_id;

  INSERT INTO public.profiles (id, email, role_id, full_name, phone, job_title, department, created_at, updated_at)
  VALUES (
    NEW.id, NEW.email, v_role_id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'phone',
    NEW.raw_user_meta_data ->> 'job_title',
    NEW.raw_user_meta_data ->> 'department',
    NOW(), NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  IF v_role_name = 'client' THEN
    INSERT INTO public.clients (profile_id, created_at, updated_at)
    VALUES (NEW.id, NOW(), NOW())
    ON CONFLICT (profile_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Backfill missing clients records for existing client-role profiles
INSERT INTO public.clients (profile_id, created_at, updated_at)
SELECT p.id, p.created_at, NOW()
FROM public.profiles p
JOIN public.roles r ON r.id = p.role_id
WHERE r.name = 'client'
  AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.profile_id = p.id)
ON CONFLICT (profile_id) DO NOTHING;

-- 3. Add DELETE policy on project_requests for super_admin
DROP POLICY IF EXISTS "Super admins can delete requests" ON public.project_requests;
CREATE POLICY "Super admins can delete requests"
  ON public.project_requests FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role_id = (SELECT id FROM public.roles WHERE name = 'super_admin')
    )
  );
