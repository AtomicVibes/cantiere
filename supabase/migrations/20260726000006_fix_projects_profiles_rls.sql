-- =============================================================
-- Migration: Fix projects + profiles RLS, add auth_user_is_super_admin()
--
-- Problems:
--   1. profiles SELECT policy uses USING (true) — any authenticated
--      user can enumerate all profiles, leaking personal data.
--   2. profiles UPDATE policy uses public.is_admin() — admins can
--      update any profile, but the user wants super_admin only.
--   3. projects has RLS enabled but only SELECT policies exist.
--      INSERT, UPDATE, DELETE are denied by default → all project
--      creation/editing/archiving fails with 403.
--   4. No public.auth_user_is_super_admin() function exists for
--      frontend RPC calls that need a non-recursive check.
--
-- Solution:
--   1. Create public.auth_user_is_super_admin() SECURITY DEFINER.
--   2. Profiles:
--      - "Profiles owner manage" → FOR ALL, USING auth.uid() = id
--      - "Profiles super admin manage" → FOR ALL, USING is_super_admin()
--      - "Profiles admin read" → FOR SELECT, USING is_admin()
--   3. Projects:
--      - "Admins can create projects"  → INSERT WITH CHECK is_admin()
--      - "Admins can update projects"  → UPDATE USING/WITH CHECK is_admin()
--      - "Admins can delete projects"  → DELETE USING is_admin()
--      (existing SELECT policies remain unchanged)
-- =============================================================

-- 1. Create auth_user_is_super_admin() SECURITY DEFINER
--    This is the non-recursive auth check the user specifically requested.
--    Identical to is_super_admin() but more explicitly named for frontend
--    RPC calls that should bypass RLS on profiles.
CREATE OR REPLACE FUNCTION public.auth_user_is_super_admin()
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

-- 2. Recreate profiles RLS from scratch =========================
--    Drop ALL existing policies first (from all prior migrations).
DROP POLICY IF EXISTS "Users can read own profile"              ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can read profiles"    ON public.profiles;
DROP POLICY IF EXISTS "Admins can read all profiles"            ON public.profiles;
DROP POLICY IF EXISTS "Admins can update profiles"              ON public.profiles;
DROP POLICY IF EXISTS "Super admin can read all profiles"       ON public.profiles;
DROP POLICY IF EXISTS "Super admin can update profiles"         ON public.profiles;

-- 2a. Profile owner can manage their own row (SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "Profiles owner manage"
  ON public.profiles FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 2b. Super admin can manage any profile row (bypasses RLS via SECURITY DEFINER)
CREATE POLICY "Profiles super admin manage"
  ON public.profiles FOR ALL
  USING (public.auth_user_is_super_admin())
  WITH CHECK (public.auth_user_is_super_admin());

-- 2c. Admin can read any profile (needed for team/project assignment dropdowns)
--     Note: this is a permissive policy (OR'd with the above two).
--     Admin inherits "owner manage" for their own row + "admin read" for all rows.
CREATE POLICY "Profiles admin read"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

-- 3. Add projects INSERT / UPDATE / DELETE policies ==============
--    Only admins can mutate projects. Regular users see only
--    assigned projects via the existing SELECT policies.

DROP POLICY IF EXISTS "Admins can create projects" ON public.projects;
DROP POLICY IF EXISTS "Admins can update projects" ON public.projects;
DROP POLICY IF EXISTS "Admins can delete projects" ON public.projects;

CREATE POLICY "Admins can create projects"
  ON public.projects FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update projects"
  ON public.projects FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete projects"
  ON public.projects FOR DELETE
  USING (public.is_admin());

-- 4. Re-assert SECURITY DEFINER on helpers (idempotent) ==========
--    Ensures no prior migration accidentally dropped the attribute.
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
