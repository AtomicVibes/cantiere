-- =============================================================
-- Security hardening 1.3: enforce a single super_admin
--
--   0. ABORTS unless exactly one profile currently holds super_admin
--      (fix the role assignments first - this migration changes no data),
--   1. adds a partial unique index so a second super_admin can never
--      exist at the database level,
--   2. supersedes the 1.2 trigger so that even service_role may not
--      ASSIGN super_admin to anyone except the current holder;
--      only postgres (migrations / owner-run data fixes) may create or
--      remove a holder.
-- Idempotent: CREATE OR REPLACE + CREATE UNIQUE INDEX IF NOT EXISTS.
-- =============================================================

-- ---------------------------------------------------------------
-- 0. Abort unless the database is in the expected single-holder state.
-- ---------------------------------------------------------------
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
   WHERE r.name = 'super_admin';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ABORT: expected exactly one super_admin profile, found %. Demote the extra accounts first (this migration changes no data).', v_count;
  END IF;
END $$;

-- ---------------------------------------------------------------
-- 1. Partial unique index: at most one super_admin profile.
--    (The role id cannot be inlined in a predicate, hence EXECUTE.)
-- ---------------------------------------------------------------
DO $$
DECLARE
  v_sa_role_id UUID;
BEGIN
  SELECT id INTO v_sa_role_id FROM public.roles WHERE name = 'super_admin' LIMIT 1;
  IF v_sa_role_id IS NULL THEN
    RAISE EXCEPTION 'ABORT: no role named "super_admin" exists';
  END IF;

  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS profiles_single_super_admin_uidx ON public.profiles (role_id) WHERE role_id = %L',
    v_sa_role_id
  );
END $$;

-- ---------------------------------------------------------------
-- 2. Trigger guard v2: never assign super_admin to a different user,
--    from any context except postgres.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_profile_role_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claim_role TEXT;
  v_session_user TEXT;
  v_direct_db BOOLEAN;
  v_uid UUID;
  v_sa_role_id UUID;
BEGIN
  -- Not a role change: never interfere.
  IF NEW.role_id IS NOT DISTINCT FROM OLD.role_id THEN
    RETURN NEW;
  END IF;

  -- The JWT claim role is set by PostgREST on every client-API request and
  -- is unset for direct database access (migrations, GoTrue's trigger path,
  -- psql/owner sessions). NOTE: inside a SECURITY DEFINER function
  -- current_user is always the owner, so it cannot be used to tell those
  -- contexts apart - the claim role can.
  v_claim_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '')
  );

  -- Unset claim alone is NOT proof of direct database access. True direct
  -- access additionally connects as a non-PostgREST user: every API request
  -- (JWT or not) authenticates as session_user 'authenticator', which can
  -- never be forged through a GUC. So direct DB access = no claim AND
  -- session_user <> 'authenticator'.
  v_session_user := session_user;
  v_direct_db := v_claim_role IS NULL AND v_session_user <> 'authenticator';

  -- Single super admin: only the CURRENT holder may keep the role. Being
  -- granted it is refused for every client-API caller - including
  -- service_role - and allowed only through direct database access
  -- (postgres/migrations/owner-run data fixes).
  SELECT id INTO v_sa_role_id FROM public.roles WHERE name = 'super_admin' LIMIT 1;
  IF v_sa_role_id IS NOT NULL
     AND NEW.role_id = v_sa_role_id
     AND OLD.role_id IS DISTINCT FROM v_sa_role_id
     AND NOT v_direct_db THEN
    RAISE EXCEPTION 'Unauthorized role modification';
  END IF;

  -- service_role (edge functions) and direct database access may change roles.
  IF v_claim_role = 'service_role' OR v_direct_db THEN
    RETURN NEW;
  END IF;

  -- The super admin may change another user's role. Nobody - including
  -- the super admin - may change their own role_id from the client API.
  v_uid := auth.uid();
  IF v_uid IS NOT NULL AND NEW.id IS DISTINCT FROM v_uid THEN
    IF EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
      WHERE p.id = v_uid
        AND r.name = 'super_admin'
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'Unauthorized role modification';
END;
$$;

NOTIFY pgrst, 'reload schema';
