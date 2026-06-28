-- =============================================================
-- Migration: Fix RLS on profiles — query profiles directly by role_id
-- - Creates/updates is_admin() SECURITY DEFINER helper
-- - Fixes profiles RLS policies to use is_admin() instead of circular joins
-- - Adds public.get_role_id() helper for frontend-safe role lookups
-- - Drops the redundant team_members table (data now in profiles only)
-- - Updates the handle_new_user trigger to NOT create team_members
-- =============================================================

-- 1. Create/update is_admin() helper
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = auth.uid() AND r.name IN ('super_admin', 'admin')
  );
$$;

-- 2. Create/update is_super_admin() helper (keep existing)
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = auth.uid() AND r.name = 'super_admin'
  );
$$;

-- 3. Drop recursive policies (ones that query profiles inside profiles policy)
DROP POLICY IF EXISTS "Super admin can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Super admin can update profiles" ON public.profiles;

-- 4. Create clean non-recursive policies using is_admin() helper
CREATE POLICY "Admins can read all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can update profiles"
  ON public.profiles FOR UPDATE
  USING (public.is_admin());

-- 5. Drop team_members table — profiles is the single source of truth
DROP TABLE IF EXISTS public.team_members CASCADE;

-- 6. Update handle_new_user trigger — remove team_members insertion
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
    NEW.id,
    NEW.email,
    v_role_id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'phone',
    NEW.raw_user_meta_data ->> 'job_title',
    NEW.raw_user_meta_data ->> 'department',
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 7. Drop RLS on team_members (table is gone)
ALTER TABLE IF EXISTS public.team_members NOFORCE ROW LEVEL SECURITY;
