-- =============================================================
-- Migration: Request Management authorization -> super_admin only
--
-- Request Management (verify / approve / reject / archive / delete)
-- is now restricted to the super_admin role in the UI and in the
-- edge functions (review-project-request). This migration completes
-- the authorization change by dropping the RLS policy that allowed
-- the 'admin' role to directly update project_requests.
--
-- Super admins keep UPDATE access via the existing
-- "Super admins can update project requests" policy (auth_user_is_super_admin).
-- INSERT (clients + edge functions) and DELETE (super_admin) policies are
-- unchanged.
-- =============================================================

DROP POLICY IF EXISTS "Admins can update requests" ON public.project_requests;