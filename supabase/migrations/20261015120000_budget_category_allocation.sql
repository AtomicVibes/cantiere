-- =============================================================
-- Budget Management: per-category budget allocation.
-- Source for the Reports "Budget" column: budget_categories.allocated_amount
-- (subtree sums are computed in the client via the shared resolver).
-- Additive only: one NUMERIC(14,2) column, default 0, non-negative guard.
-- Existing rows are untouched; RLS stays super_admin-only (unchanged).
-- =============================================================

alter table public.budget_categories
  add column if not exists allocated_amount numeric(14,2) not null default 0;

comment on column public.budget_categories.allocated_amount is
  'Budget envelope allocated to this category (plus its subtree) in the budget currency.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'budget_categories_allocated_amount_check'
      and conrelid = 'public.budget_categories'::regclass
  ) then
    alter table public.budget_categories
      add constraint budget_categories_allocated_amount_check
      check (allocated_amount >= 0);
  end if;
end $$;
