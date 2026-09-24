-- =============================================================
-- Projects archive restore: remember the pre-archive status.
--
-- Archiving sets status = 'archived', which erases the previous value.
-- status_before_archive preserves it so Restore returns the project to
-- its exact prior state (progress/mode/priority/timeline are untouched
-- by archiving already). Nullable, additive, no RLS change, no data
-- rewrite (existing rows stay null = restore falls back to 'draft').
-- =============================================================

alter table public.projects
  add column if not exists status_before_archive text;

comment on column public.projects.status_before_archive is
  'Status held before archiving; restore returns to it, then clears it.';

notify pgrst, 'reload schema';
