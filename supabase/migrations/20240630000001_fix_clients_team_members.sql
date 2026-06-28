-- =============================================================
-- Migration: Fix clients and team_members schemas
-- - Recreates team_members with correct profile_id FK
-- - Ensures clients has proper profile_id FK and UNIQUE
-- - Adds is_admin() helper function for RLS
-- - Updates profiles RLS to allow admins read/update
-- - Adds RLS policies for team_members and clients
-- - Updates handle_new_user trigger
-- - Backfills existing data
-- =============================================================

-- 1. Create is_admin() helper (bypasses RLS, covers super_admin + admin)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = auth.uid() AND r.name IN ('super_admin', 'admin')
  );
$$;

-- 2. Update profiles RLS: allow admins (not just super_admin) to read/update
DROP POLICY IF EXISTS "Super admin can read all profiles" ON public.profiles;
CREATE POLICY "Admins can read all profiles"
  ON public.profiles
  FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Super admin can update profiles" ON public.profiles;
CREATE POLICY "Admins can update profiles"
  ON public.profiles
  FOR UPDATE
  USING (public.is_admin());

-- 3. Recreate team_members with proper schema
DROP TABLE IF EXISTS public.team_members CASCADE;

CREATE TABLE public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'on_leave')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_profile_id ON public.team_members(profile_id);
ALTER TABLE public.team_members ADD CONSTRAINT team_members_profile_id_key UNIQUE (profile_id);

-- 4. Ensure clients has proper FK and unique constraint
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_profile_id_key;
ALTER TABLE public.clients ADD CONSTRAINT clients_profile_id_key UNIQUE (profile_id);

CREATE INDEX IF NOT EXISTS idx_clients_profile_id ON public.clients(profile_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema = ccu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'clients'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.column_name = 'profile_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.clients ADD CONSTRAINT clients_profile_id_fkey
             FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE';
  END IF;
END $$;

-- 5. Enable RLS
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- 6. RLS policies for team_members
DROP POLICY IF EXISTS "Team members can read own record" ON public.team_members;
CREATE POLICY "Team members can read own record"
  ON public.team_members FOR SELECT
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins can read team members" ON public.team_members;
CREATE POLICY "Admins can read team members"
  ON public.team_members FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert team members" ON public.team_members;
CREATE POLICY "Admins can insert team members"
  ON public.team_members FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update team members" ON public.team_members;
CREATE POLICY "Admins can update team members"
  ON public.team_members FOR UPDATE
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete team members" ON public.team_members;
CREATE POLICY "Admins can delete team members"
  ON public.team_members FOR DELETE
  USING (public.is_admin());

-- 7. RLS policies for clients
DROP POLICY IF EXISTS "Clients can read own record" ON public.clients;
CREATE POLICY "Clients can read own record"
  ON public.clients FOR SELECT
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins can read clients" ON public.clients;
CREATE POLICY "Admins can read clients"
  ON public.clients FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert clients" ON public.clients;
CREATE POLICY "Admins can insert clients"
  ON public.clients FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update clients" ON public.clients;
CREATE POLICY "Admins can update clients"
  ON public.clients FOR UPDATE
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete clients" ON public.clients;
CREATE POLICY "Admins can delete clients"
  ON public.clients FOR DELETE
  USING (public.is_admin());

-- 8. Update handle_new_user trigger
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

  IF v_role_name IN ('super_admin', 'admin', 'manager') THEN
    INSERT INTO public.team_members (profile_id, status, created_at)
    VALUES (NEW.id, 'active', NOW())
    ON CONFLICT (profile_id) DO NOTHING;
  ELSIF v_role_name = 'client' THEN
    INSERT INTO public.clients (profile_id, created_at)
    VALUES (NEW.id, NOW())
    ON CONFLICT (profile_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- 9. Backfill team_members for existing admin/manager/super_admin profiles
INSERT INTO public.team_members (profile_id, status, created_at)
SELECT p.id, 'active', NOW()
FROM public.profiles p
JOIN public.roles r ON r.id = p.role_id
WHERE r.name IN ('super_admin', 'admin', 'manager')
  AND NOT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.profile_id = p.id)
ON CONFLICT (profile_id) DO NOTHING;

-- 10. Backfill clients for existing client profiles
INSERT INTO public.clients (profile_id, created_at)
SELECT p.id, NOW()
FROM public.profiles p
JOIN public.roles r ON r.id = p.role_id
WHERE r.name = 'client'
  AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.profile_id = p.id)
ON CONFLICT (profile_id) DO NOTHING;
