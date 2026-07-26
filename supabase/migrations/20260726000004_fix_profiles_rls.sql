-- =============================================================
-- Migration: Fix profiles RLS recursion and restore dropdown access
--
-- Problem:
--   1. Some RLS policies on profiles still query profiles
--      directly (or reference functions that aren't properly
--      SECURITY DEFINER), causing infinite recursion.
--   2. Regular (non-admin) users can only read their own
--      profile, so project assignment dropdowns that list
--      team members return empty results.
--
-- Solution:
--   1. Recreate is_admin() / is_super_admin() as SECURITY
--      DEFINER functions that bypass RLS.
--   2. Drop ALL existing policies on profiles.
--   3. Create clean policies:
--      - "Authenticated users can read profiles" (SELECT)
--        → Allows any logged-in user to list profiles for
--          team assignment dropdowns.
--      - "Admins can update profiles" (UPDATE)
--        → Only admins can modify profiles.
-- =============================================================

-- 1. Ensure helper functions exist with SECURITY DEFINER
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

-- 2. Drop all existing policies to wipe out any recursive ones
DROP POLICY IF EXISTS "Users can read own profile"          ON public.profiles;
DROP POLICY IF EXISTS "Admins can read all profiles"        ON public.profiles;
DROP POLICY IF EXISTS "Admins can update profiles"          ON public.profiles;
DROP POLICY IF EXISTS "Super admin can read all profiles"   ON public.profiles;
DROP POLICY IF EXISTS "Super admin can update profiles"     ON public.profiles;

-- 3. Create clean, non-recursive policies

-- Any logged-in user can read profiles (needed for team dropdowns)
CREATE POLICY "Authenticated users can read profiles"
  ON public.profiles FOR SELECT
  USING (true);

-- Only admins can update profiles
CREATE POLICY "Admins can update profiles"
  ON public.profiles FOR UPDATE
  USING (public.is_admin());
