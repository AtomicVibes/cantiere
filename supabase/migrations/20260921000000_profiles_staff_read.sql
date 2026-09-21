-- =============================================================
-- Migration: Allow staff (including managers) to read profiles
--
-- Context:
--   The profiles SELECT policy currently only exposes other
--   people's profiles to super_admins and admins ("Profiles
--   admin read" → public.is_admin()).
--
--   Managers (role 'manager') are internal staff but cannot
--   enumerate/search colleagues, so the Messaging contact
--   search returns nothing for them.
--
-- Solution:
--   1. Add public.is_staff() SECURITY DEFINER helper covering
--      super_admin / admin / manager.
--   2. Replace "Profiles admin read" with "Profiles staff read"
--      using public.is_staff() so managers can read profiles
--      too. Mutation (owner super_admin manage) is unchanged.
--
--   Security note: this only broadens READ access to profile
--   display fields for authenticated staff. Clients remain
--   limited to their own profile + message partners, and the
--   messaging surface filters client-role profiles out of
--   search results.
-- =============================================================

-- 1. SECURITY DEFINER helper: staff = super_admin | admin | manager
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = auth.uid() AND r.name IN ('super_admin', 'admin', 'manager')
  );
$$;

-- 2. Replace "Profiles admin read" with "Profiles staff read"
DROP POLICY IF EXISTS "Profiles admin read" ON public.profiles;
DROP POLICY IF EXISTS "Profiles staff read"  ON public.profiles;

CREATE POLICY "Profiles staff read"
  ON public.profiles FOR SELECT
  USING (public.is_staff());