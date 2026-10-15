-- =============================================================
-- Security hardening 1.2: block role_id self-elevation on public.profiles
--
-- RLS ("profiles_isolation_modify") lets every authenticated user UPDATE
-- their own row, including role_id, so any account could promote itself.
-- This BEFORE UPDATE trigger refuses every role_id change unless the
-- caller is:
--   * service_role (edge functions), or
--   * direct database access (no JWT claim AND session_user <> 'authenticator'
--     - PostgREST API traffic always connects as 'authenticator'), or
--   * the super admin (rank-based, roles.name = 'super_admin') changing
--     SOMEONE ELSE'S row.
-- Updates that do not change role_id (name, avatar, preferences, ...)
-- are never touched.
-- Idempotent: DROP TRIGGER IF EXISTS only for the trigger created here.
-- =============================================================

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

DROP TRIGGER IF EXISTS enforce_profile_role_guard ON public.profiles;
CREATE TRIGGER enforce_profile_role_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profile_role_guard();

-- NOTE: no REVOKE UPDATE (role_id) FROM authenticated was added.
-- PostgREST enforces column-level privileges, so revoking would break the
-- one legitimate client-side role assignment left (the super admin editing
-- another member via EditMemberDialog), replacing the trigger's clear
-- error with an opaque permission error. The trigger is the guard.

NOTIFY pgrst, 'reload schema';
