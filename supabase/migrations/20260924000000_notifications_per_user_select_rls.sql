-- =============================================================
-- Per-user SELECT isolation for public.notifications
--
-- Audit (2026-09-24): the Notifications page listed rows through a generic
-- helper that issued `select *` with no user predicate, relying entirely on
-- RLS. RLS is already correct -- the only SELECT policy is owner-only -- but
-- this migration re-asserts that invariant explicitly and documents the
-- INSERT contract so cross-user producers keep working.
--
-- Additive / idempotent / non-destructive:
--   * enables RLS (no-op if already enabled)
--   * re-creates ONLY the owner SELECT policy with an explicit
--     `auth.uid() = user_id` predicate, bound to authenticated
--   * does NOT touch the INSERT / UPDATE / DELETE policies, the push
--     trigger, the reminder engine, indexes, or any other table
-- =============================================================

alter table public.notifications enable row level security;

-- Authoritative per-user read boundary: a user may read a notification only
-- when it is addressed to them. The frontend additionally filters by user_id,
-- but that is defense-in-depth -- RLS remains the final security boundary.
drop policy if exists "Users can view their own notifications" on public.notifications;
create policy "Users can view their own notifications"
  on public.notifications
  for select
  to authenticated
  using (auth.uid() = user_id);

-- INSERT is intentionally NOT owner-restricted. Notifications are addressed
-- TO a recipient by a different actor (message recipient, assigned project
-- member/manager, request reviewer, reminder engine, SECURITY DEFINER
-- triggers), so the existing contract is preserved verbatim:
--
--   "Users can create notifications" FOR INSERT TO authenticated
--   WITH CHECK (true)
--
-- (20260726000005_project_assignment_notifications.sql +
--  20260918000013_push_delivery_repair.sql). Tightening this to
--  auth.uid() = user_id would break every cross-user producer without adding
--  any read protection (reads stay owner-only above).

notify pgrst, 'reload schema';
