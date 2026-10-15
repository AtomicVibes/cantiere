-- =============================================================
-- Security hardening 1.1: public.handle_new_user()
--
-- The live definition trusts NEW.raw_user_meta_data->>'role_id', so any
-- self-signup (or any caller of auth.admin.createUser with custom
-- metadata) can request super_admin. This version:
--   * NEVER reads role_id / role from raw_user_meta_data,
--   * always assigns the lowest-privilege default role, looked up BY NAME
--     from public.roles ('client'),
--   * raises (never falls back) when the lookup is missing or resolves to
--     a privileged role.
-- SECURITY DEFINER + fixed search_path and every other behaviour of the
-- live definition (duplicate email/username guards, profile columns,
-- clients row for the client role) are preserved exactly.
-- Idempotent: CREATE OR REPLACE only.
-- =============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_role_id UUID;
  v_default_role_id UUID;
  v_role_name TEXT;
  v_email TEXT;
  v_username TEXT;
BEGIN
  v_email := NEW.email;
  v_username := nullif(btrim(coalesce(NEW.raw_user_meta_data ->> 'username', '')), '');

  -- Default role resolved by NAME; never privileged, never guessed.
  SELECT id INTO v_default_role_id FROM public.roles WHERE name = 'client' LIMIT 1;
  IF v_default_role_id IS NULL THEN
    RAISE EXCEPTION 'Security: no default role named "client" is configured';
  END IF;

  SELECT name INTO v_role_name FROM public.roles WHERE id = v_default_role_id;
  IF v_role_name IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'Security: default role resolution produced a privileged role';
  END IF;

  v_role_id := v_default_role_id;

  -- Duplicate email: abort so the auth.users INSERT rolls back too
  -- (no orphaned Auth user is left behind).
  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE lower(p.email) = lower(v_email)
       AND p.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'An account already exists with this email address.';
  END IF;

  -- Duplicate username: same rollback guarantee.
  IF v_username IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE lower(p.username) = lower(v_username)
       AND p.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'This username is already taken. Please choose another username.';
  END IF;

  -- Column list matches the deployed public.profiles schema
  -- (no updated_at: the table does not have one).
  INSERT INTO public.profiles (id, email, username, role_id, full_name, phone, job_title, department, created_at)
  VALUES (
    NEW.id, v_email, v_username, v_role_id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'phone',
    NEW.raw_user_meta_data ->> 'job_title',
    NEW.raw_user_meta_data ->> 'department',
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  IF v_role_name = 'client' THEN
    INSERT INTO public.clients (profile_id, created_at)
    VALUES (NEW.id, NOW())
    ON CONFLICT (profile_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- The trigger itself (on_auth_user_created) is already attached to
-- auth.users; nothing to re-create here.

-- NOTE: the metadata-privilege self-test that used to live here inserted a
-- probe row into auth.users. It was removed so this migration touches no
-- data at all; run the standalone verification script against STAGING instead
-- (see "Staging verification" in the delivery report).

NOTIFY pgrst, 'reload schema';
