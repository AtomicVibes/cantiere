-- =============================================================
-- Migration: fix RLS infinite recursion on public.profiles
-- The old policies queried profiles inside the USING clause,
-- which triggered RLS again → infinite loop.
-- Solution: SECURITY DEFINER helper that bypasses RLS.
-- =============================================================

-- 1. Helper function: checks if the current user is super_admin
--    Runs with SECURITY DEFINER so it bypasses RLS on profiles.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = auth.uid() AND r.name = 'super_admin'
  );
$$;

-- 2. Drop the recursive policies
DROP POLICY IF EXISTS "Super admin can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Super admin can update profiles" ON public.profiles;

-- 3. Re-create them using the helper function
CREATE POLICY "Super admin can read all profiles"
  ON public.profiles
  FOR SELECT
  USING (public.is_super_admin());

CREATE POLICY "Super admin can update profiles"
  ON public.profiles
  FOR UPDATE
  USING (public.is_super_admin());
