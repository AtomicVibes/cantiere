-- =============================================================
-- Migration: Fix clients table — re-add insert in trigger, backfill
-- - Updates handle_new_user to insert into clients for FK integrity
-- - Adds updated_at column to clients
-- - Backfills missing client rows from profiles
-- =============================================================

-- 1. Add updated_at to clients (consistent with profiles)
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE OR REPLACE FUNCTION public.update_clients_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_clients_updated_at ON public.clients;
CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_clients_updated_at();

-- 2. Update handle_new_user — keep profiles insert, re-add clients insert
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

  IF v_role_name = 'client' THEN
    INSERT INTO public.clients (profile_id, created_at, updated_at)
    VALUES (NEW.id, NOW(), NOW())
    ON CONFLICT (profile_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Backfill missing clients rows from existing client-role profiles
INSERT INTO public.clients (profile_id, created_at, updated_at)
SELECT p.id, p.created_at, NOW()
FROM public.profiles p
JOIN public.roles r ON r.id = p.role_id
WHERE r.name = 'client'
  AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.profile_id = p.id)
ON CONFLICT (profile_id) DO NOTHING;

-- 4. Ensure clients RLS uses is_admin() — these already exist from prior migration
-- but re-apply to be safe in case old policies remain
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
