-- Migration: Add archived column + UPDATE policy for audit_logs
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;

CREATE POLICY "Super admin can update audit logs"
  ON public.audit_logs FOR UPDATE
  USING (public.auth_user_is_super_admin())
  WITH CHECK (public.auth_user_is_super_admin());
