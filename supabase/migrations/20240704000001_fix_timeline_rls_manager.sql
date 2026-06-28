-- =============================================================
-- Migration: Fix project_timeline RLS — allow managers to insert
-- The frontend permission canAddTimelineEntry includes 'manager'
-- but the RLS policy only checked is_admin() (super_admin + admin)
-- This caused a 403 Forbidden for manager-role users.
-- =============================================================

-- 1. Drop the old policy that only allowed admins
DROP POLICY IF EXISTS "Admins can insert timeline entries" ON public.project_timeline;

-- 2. Create a broader policy that also allows managers
DROP POLICY IF EXISTS "Team can insert timeline entries" ON public.project_timeline;
CREATE POLICY "Team can insert timeline entries"
  ON public.project_timeline FOR INSERT
  WITH CHECK (
    public.is_admin() OR
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
      WHERE p.id = auth.uid() AND r.name = 'manager'
    )
  );
