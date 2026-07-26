-- Migration: Add archived BOOLEAN column to project_requests and invoices
-- Also add RLS policies for super_admin management

-- 1. project_requests
ALTER TABLE public.project_requests ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;
CREATE POLICY "Super admins can update project requests"
  ON public.project_requests FOR UPDATE
  USING (public.auth_user_is_super_admin())
  WITH CHECK (public.auth_user_is_super_admin());

-- 2. invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;
