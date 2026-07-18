-- =============================================================
-- Migration: Add is_blocked to clients for super_admin block action
-- - Adds is_blocked boolean column (default false)
-- - Ensures UPDATE RLS is present (reuses existing is_admin() policy)
-- =============================================================

-- 1. Add is_blocked column (safe, idempotent)
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false;

-- 2. Ensure UPDATE RLS policy exists on clients for super_admin + admin
--    (already exists from 20240630000001 but re-applied here for safety)
DROP POLICY IF EXISTS "Admins can update clients" ON public.clients;
CREATE POLICY "Admins can update clients"
  ON public.clients FOR UPDATE
  USING (public.is_admin());
