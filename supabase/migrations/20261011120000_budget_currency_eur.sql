-- =============================================================
-- Budget Management: default currency EUR.
--
-- Changes ONLY the column defaults for new rows:
--   budgets.currency, budget_expenses.currency, budget_recurring.currency
-- Existing rows keep their stored currency (never rewritten, never
-- converted). No RLS, audit, or unrelated-table changes.
-- =============================================================

alter table public.budgets
  alter column currency set default 'EUR';

alter table public.budget_expenses
  alter column currency set default 'EUR';

alter table public.budget_recurring
  alter column currency set default 'EUR';

notify pgrst, 'reload schema';
